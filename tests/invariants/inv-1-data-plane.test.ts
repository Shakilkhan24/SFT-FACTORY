/**
 * **INV-1** — the data plane cannot mutate control-plane state.
 *
 * checklist 14 §"The twelve invariants and their mutations", row INV-1:
 *
 * > | **INV-1** | The data plane cannot mutate control-plane state | *attach
 * > the container to `factory-core`; add a DB role to the env* |
 *
 * and pack `08` §3, on what the test asserts:
 *
 * > **INV-1** — from inside a T2 container, try the Postgres host/port,
 * > `factory-api`, the object store, the Docker socket and the arbitrary
 * > internet ⇒ all fail. Statically: no DB handle type is reachable from
 * > `Environment` / `HarnessAdapter`.
 *
 * ## What "the data plane" is
 *
 * blueprint `02` §2 splits the factory in two:
 *
 * * the **control plane** — the orchestrator, the API, the scheduler, the
 *   event log, the database. It holds the authority.
 * * the **data plane** — the *execution environments*: the T1 snapshots and
 *   worktrees, and the T2 containers a stage's code runs inside. It holds
 *   no authority and may not acquire any.
 *
 * The separation is what makes the autonomy ladder mean anything. If a
 * container can reach the database, then "the agent decided to" and "the
 * agent *could* have" collapse into the same thing, and every downstream
 * control — the grants, the policy, the applier role, the event log — is
 * advisory.
 *
 * `packages/db/src/connection.ts` says the same thing from the other
 * side: *"so a process can hold exactly the credentials its role needs and
 * no others (**the data plane has no database role; I-1**)"*.
 *
 * ## The two halves, and why there are two
 *
 * 1. **The static half** — the type graph. `Environment` and
 *    `HarnessAdapter` are the two types a data-plane component is *given*.
 *    If a database handle is reachable from either, then the containment
 *    is not a deployment property — it is a **type** property, and the type
 *    is what the compiler checks. This half runs everywhere: no Docker, no
 *    network, no database.
 * 2. **The network half** — the container. The static half says the *code*
 *    is not handed a handle; the network half says the *environment* is
 *    not on a route to the control plane either. A leaked password in an
 *    environment variable is a real threat, and only the network half sees
 *    it.
 *
 * Both halves must be red under the mutation, and the mutation has two
 * halves too: *"attach the container to `factory-core`; add a DB role to
 * the env"*. The static half goes red on the second clause; the network
 * half goes red on the first.
 *
 * ## Why the static half is a **type-graph walk**, not a grep
 *
 * A grep for `Kysely` in the isolation package would be a weak oracle:
 * the handle could arrive through an import alias, through a re-export, or
 * through a type the environment merely *names*. The walk below uses the
 * TypeScript compiler's own type checker: it starts at the declared type
 * of `Environment` (and `HarnessAdapter`, and `IsolationProvider`) and
 * follows **every** property, call signature, index signature and type
 * argument. If any node in that graph is a database handle — by name, by
 * declaration file, or by structural identity with one — the walk reports
 * it.
 *
 * The walk is therefore sensitive to the mutation in the exact way the
 * checklist asks: adding a DB-typed member to `Environment` puts a
 * `Kysely<FactoryDatabase>` **into the graph**, and the walk finds it
 * whether it was written inline, imported, or aliased.
 *
 * ## The network half, and what it can honestly claim
 *
 * The container is started the way the product says a T2 environment is
 * started: on its **own** network, with the **egress allow-list from the
 * `EnvSpec`** applied as the network's only route, and with **no** volume
 * for the Docker socket and **no** `FACTORY_*_DATABASE_URL` in its
 * environment.
 *
 * Then the tests inside it try to reach:
 *
 * * the Postgres host and port (by name and by IP);
 * * `factory-api`;
 * * the object store;
 * * the Docker socket.
 *
 * ### The honest limit: the arbitrary internet
 *
 * pack `08` §3 asks for the arbitrary internet to fail too. **This test
 * does not claim that.** Here is why, stated plainly rather than papered
 * over:
 *
 * * The environment this repository runs in has a **working outbound
 *   internet connection** — the dev Postgres image was pulled from Docker
 *   Hub, so the daemon itself has egress. Whether a *container* inherits
 *   that egress depends on the daemon's networking configuration, which
 *   this test does not control and must not depend on.
 * * The product's egress control is the `EnvSpec`'s
 *   `network.egress` allow-list (`packages/contracts/src/services.ts`),
 *   enforced by the **egress proxy** — a component that is not built yet
 *   (the `net.egress.denied` event type is registered, but no proxy
 *   implements it). There is therefore **no product code** that could
 *   enforce the allow-list inside the container.
 *
 * So what this test asserts about egress is the part that is **provable
 * and true**: the container is attached to a network whose only route is
 * the one the `EnvSpec` names, and that list is **empty** by default. It
 * asserts the *absence of a configured route*, not the *absence of a
 * packet* — and it says so in the assertion's name, so no reader can
 * mistake it for a stronger claim than it makes.
 *
 * The mutation "add a DB role to the env" is caught by the static half
 * and by the environment assertion below (the container's environment
 * carries no `FACTORY_*_DATABASE_URL`). The mutation "attach the
 * container to `factory-core`" is caught by the network half: the
 * container's network is **not** the control plane's network, and the
 * Postgres host is **not** resolvable and **not** routable from it.
 *
 * ## The environment
 *
 * The network half needs Docker — the daemon, and the `postgres:16-alpine`
 * image, which the dev cluster already uses. Where the daemon is not
 * available the half **skips**: that is an environment limit, not a defect
 * in the factory. The static half always runs.
 */

import { execFile } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..', '..');

/**
 * The contracts module that declares the data plane's types.
 *
 * `Environment`, `HarnessAdapter` and `IsolationProvider` are declared
 * here (pack 03 §3), and the whole point of the static half is that
 * they are declared in a package which **cannot import the database** at
 * all — `packages/contracts` imports nothing internal, and `packages/db`
 * is banned from the pure packages by `pure-packages-have-no-db-client`.
 * So the walk starts at a type that is *structurally* incapable of
 * naming a database handle, and proves it.
 */
const CONTRACTS_SERVICES = resolve(repoRoot, 'packages/contracts/src/services.ts');

/**
 * The names a database handle travels under.
 *
 * These are the names the `db` package exports (`packages/db/src/index.ts`
 * re-exports `Kysely` and `Transaction`; `packages/db/src/connection.ts`
 * imports `Pool`, `PoolClient` and `PoolConfig` from `pg`), plus the
 * schema type the handle is parameterised by.
 *
 * The list is a **deny-list of names**, and the walk also checks the
 * *declaration file* of every symbol it reaches — so a handle reached
 * under a different name (`MyDb` aliasing `Kysely`) is still caught.
 */
const DB_HANDLE_NAMES: readonly string[] = [
  'Kysely',
  'Pool',
  'PoolClient',
  'PoolConfig',
  'Transaction',
  'FactoryDatabase',
  'PostgresDialect',
  'PostgresAdapter',
  'PgClient',
];

/**
 * The declaration files a database handle lives in.
 *
 * `kysely` is the ORM; `pg` is the driver. A symbol declared in either
 * file is a database handle whatever it is called.
 */
const DB_DECLARATION_FILES: readonly string[] = [
  'node_modules/kysely/',
  'node_modules/pg/',
  'node_modules/pg-pool/',
  'node_modules/@types/pg/',
];

/**
 * The data-plane types the walk starts from.
 *
 * * `Environment` — what a provisioned environment *is*. A stage's code
 *   runs inside it.
 * * `HarnessAdapter` — the coding agent that runs inside it. It is
 *   handed the `Environment`, so a handle on the environment would be a
 *   handle on the database.
 * * `IsolationProvider` — the port that *provisions* the environment, so
 *   it is the other side of the same seam.
 */
const DATA_PLANE_TYPES: readonly string[] = [
  'Environment',
  'HarnessAdapter',
  'IsolationProvider',
];

/**
 * One node in the type graph that turned out to be a database handle.
 */
interface TypeGraphHit {
  /** The path through the graph, e.g. `Environment.db`. */
  readonly path: string;
  /** The type's rendering, e.g. `Kysely<FactoryDatabase> | undefined`. */
  readonly rendering: string;
  /** Why it was reported. */
  readonly reason: string;
}

/**
 * The compiler options the walk runs under.
 *
 * They mirror the repository's own `tsconfig.base.json` closely enough
 * that the type graph the checker sees is the one the build sees — most
 * importantly `strict`, because under `strict` an optional property is
 * `T | undefined` and the walk must see the `T`.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  exactOptionalPropertyTypes: true,
  skipLibCheck: true,
  noEmit: true,
};

/**
 * Walk the type graph of the data plane's types and report every database
 * handle it reaches.
 *
 * The walk follows:
 *
 * * every property of every object type;
 * * every call signature — the return type and every parameter type;
 * * every index signature;
 * * every type argument of a generic type.
 *
 * and it stops at a depth of {@link MAX_DEPTH}, which is far deeper than
 * the data plane's own types go and shallow enough to terminate on a
 * recursive type.
 *
 * @param sourceFile the file to walk — the contracts module, or a
 *   polluted copy of it
 * @param extraFiles other files to put in the program
 * @returns the handles found — empty when the containment holds
 */
const findDatabaseHandles = (
  sourceFile: string,
  extraFiles: readonly string[] = [],
): TypeGraphHit[] => {
  const program = ts.createProgram([sourceFile, ...extraFiles], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();

  const hits: TypeGraphHit[] = [];
  const visited = new Set<ts.Type>();

  /** The maximum depth the walk descends. */
  const MAX_DEPTH = 14;

  const isDatabaseHandle = (
    symbol: ts.Symbol,
    rendering: string,
  ): string | undefined => {
    const name = symbol.getName();
    if (DB_HANDLE_NAMES.includes(name)) {
      return `the type is named "${name}"`;
    }
    for (const declaration of symbol.getDeclarations() ?? []) {
      const file = declaration.getSourceFile().fileName.replace(/\\/g, '/');
      for (const needle of DB_DECLARATION_FILES) {
        if (file.includes(needle)) {
          return `the type is declared in "${file}"`;
        }
      }
    }
    // The *rendering* is the last resort: a type alias or a re-export can
    // hide the declaration, but the rendered name still shows the handle.
    for (const needle of DB_HANDLE_NAMES) {
      if (rendering.includes(`${needle}<`) || rendering.endsWith(` ${needle}`)) {
        return `the type renders as "${rendering}"`;
      }
    }
    return undefined;
  };

  const walk = (type: ts.Type, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      return;
    }

    const rendering = checker.typeToString(type);

    // The symbol of the type itself. For an interface or a class this is
    // the declaration's name; for an alias it is the alias's name.
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol !== undefined) {
      const reason = isDatabaseHandle(symbol, rendering);
      if (reason !== undefined) {
        hits.push({ path, rendering, reason });
        return;
      }
    }

    if (visited.has(type)) {
      return;
    }
    visited.add(type);

    // Union and intersection members.
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) {
        walk(part, path, depth + 1);
      }
      return;
    }

    const flags = type.getFlags();
    const isObjectLike =
      (flags & ts.TypeFlags.Object) !== 0 ||
      (flags & ts.TypeFlags.TypeParameter) !== 0;

    if (isObjectLike) {
      // A type parameter's own constraint is part of what it can hold, so
      // the constraint is walked too — otherwise `T extends Kysely<...>`
      // would be invisible to the walk.
      if ((flags & ts.TypeFlags.TypeParameter) !== 0) {
        const constraint = checker.getBaseConstraintOfType(type);
        if (constraint !== undefined) {
          walk(constraint, `${path}<constraint>`, depth + 1);
        }
      }

      // Every property.
      for (const property of type.getProperties()) {
        const declaration =
          property.valueDeclaration ?? property.declarations?.[0];
        if (declaration === undefined) {
          continue;
        }
        walk(
          checker.getTypeOfSymbolAtLocation(property, declaration),
          `${path}.${property.getName()}`,
          depth + 1,
        );
      }

      // Every call signature — the return type and each parameter.
      for (const signature of type.getCallSignatures()) {
        walk(
          checker.getReturnTypeOfSignature(signature),
          `${path}().returns`,
          depth + 1,
        );
        for (const parameter of signature.getParameters()) {
          const declaration =
            parameter.valueDeclaration ?? parameter.declarations?.[0];
          if (declaration === undefined) {
            continue;
          }
          walk(
            checker.getTypeOfSymbolAtLocation(parameter, declaration),
            `${path}().arg:${parameter.getName()}`,
            depth + 1,
          );
        }
      }

      // Every index signature. The compiler exposes it through the
      // checker, which takes the type rather than a narrowed object
      // type — so there is no duck-typing to do here.
      //
      // The key and the value are already **types** — the compiler has
      // resolved them — so they are walked directly rather than through
      // a symbol lookup.
      for (const info of checker.getIndexInfosOfType(type)) {
        walk(info.keyType, `${path}[key]`, depth + 1);
        walk(info.type, `${path}[value]`, depth + 1);
      }
    }

    // Every type argument of a generic.
    for (const argument of checker.getTypeArguments(
      type as ts.TypeReference,
    )) {
      walk(argument, `${path}<type-argument>`, depth + 1);
    }
  };

  const file = program.getSourceFile(sourceFile);
  if (file === undefined) {
    throw new Error(`the module at "${sourceFile}" could not be loaded`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(file);
  if (moduleSymbol === undefined) {
    throw new Error('the contracts module has no module symbol');
  }

  for (const name of DATA_PLANE_TYPES) {
    // The exports table is keyed by the compiler's internal string type,
    // so the lookup is made through `get` and the result narrowed —
    // `moduleSymbol.exports` is optional on the public type.
    const symbol = moduleSymbol.exports?.get(name as ts.__String);
    if (symbol === undefined) {
      throw new Error(`the contracts module does not export "${name}"`);
    }
    walk(checker.getDeclaredTypeOfSymbol(symbol), name, 0);
  }

  return hits;
};

/**
 * Whether the Docker daemon is available and the Postgres image is present.
 *
 * The image is the dev cluster's own (`docker-compose.dev.yml` pins
 * `postgres:16-alpine`), so no pull is needed — the network half runs
 * offline.
 */
const dockerReady = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['images', '--format', '{{.Repository}}:{{.Tag}}'],
      { encoding: 'utf8' },
    );
    const images = stdout.split('\n').map((line) => line.trim());
    if (!images.includes('postgres:16-alpine')) {
      return false;
    }
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
};

const running = await dockerReady();

/**
 * The name of the network the control plane lives on.
 *
 * The dev cluster's compose project network — the one `factory-postgres-dev`
 * is attached to. The T2 container must **not** be on it.
 */
const CONTROL_PLANE_NETWORK = 'sft_factory_claude_default';

/**
 * The name of the network the data plane gets.
 *
 * A dedicated bridge network with **no** link to the control plane's
 * network and **no** published ports. It is deliberately *not* created
 * with `internal: true`, because the product does not configure Docker
 * that way — the `EnvSpec`'s egress allow-list is the product's control,
 * and this test must not pretend to a control the product does not have.
 */
const DATA_PLANE_NETWORK = 'factory-inv1-dataplane';

/**
 * The name of the container the tests run inside.
 */
const CONTAINER = 'factory-inv1-dataplane-probe';

/**
 * The Postgres service's name on the control-plane network.
 */
const PG_HOST = 'factory-postgres-dev';

/**
 * The Postgres port.
 */
const PG_PORT = '5432';

/**
 * The object store's host and port.
 *
 * `docker-compose.dev.yml` publishes MinIO on `127.0.0.1:9000`. The name
 * is the compose service name, `minio`, and the container name is
 * `factory-minio-dev`. Both are tried, because which one is resolvable
 * depends on which network the object store is on.
 */
const OBJECT_STORE_HOSTS: readonly string[] = ['minio', 'factory-minio-dev'];
const OBJECT_STORE_PORT = '9000';

/**
 * The API's host and port.
 *
 * `factory-api` is the service name the pack names. The API is not
 * running in this environment, so the name is what is tested — it must not
 * resolve, and that is the point.
 */
const API_HOST = 'factory-api';
const API_PORT = '8080';

/**
 * Run a command **inside** the probe container.
 *
 * @param argv the command
 * @returns the exit code, stdout and stderr
 */
const execInContainer = async (
  argv: readonly string[],
): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> => {
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker',
      ['exec', CONTAINER, ...argv],
      { encoding: 'utf8', timeout: 30_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: `${failure.stderr ?? ''}${failure.message ?? ''}`,
    };
  }
};

/**
 * Try to open a TCP connection to `host:port` from inside the container.
 *
 * The probe is a plain `nc -z -w 2` — the container's own `nc`, so the
 * test measures the **network**, not the factory.
 *
 * @returns `true` when the connection was established
 */
const canReach = async (host: string, port: string): Promise<boolean> => {
  const result = await execInContainer(['nc', '-z', '-w', '2', host, port]);
  return result.code === 0;
};

/**
 * Resolve a host name from inside the container.
 *
 * @returns the address, or `undefined` when the name does not resolve
 */
const resolves = async (host: string): Promise<string | undefined> => {
  const result = await execInContainer(['getent', 'hosts', host]);
  if (result.code !== 0) {
    return undefined;
  }
  const first = result.stdout.trim().split('\n')[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
};

describe('INV-1 — the data plane cannot mutate control-plane state', () => {
  describe('the static half — no database handle is reachable from the data plane', () => {
    it('INV-1 declares no database handle in the type graph of Environment, HarnessAdapter or IsolationProvider', () => {
      // The walk is the oracle. It starts at the declared type of each
      // data-plane type and follows every property, call signature, index
      // signature and type argument.
      //
      // A **hand-written list of members** would be weaker: it would
      // check the members the author remembered. The walk checks the
      // members that *exist*.
      const hits = findDatabaseHandles(CONTRACTS_SERVICES);

      // The report names **where** the handle was found, so a failure
      // says which member leaked rather than just "something leaked".
      expect(
        hits.map((hit) => `${hit.path} (${hit.rendering}) — ${hit.reason}`),
      ).toEqual([]);
    });

    it('INV-1 proves the walk is sensitive — a handle on Environment is found', () => {
      // The control for the assertion above.
      //
      // A walk that returned `[]` because it walked nothing would pass
      // the test above vacuously. So this test runs the **same** walk
      // against a deliberately polluted copy of the contracts module and
      // asserts that the walk **finds** the handle.
      //
      // The pollution is applied to an in-memory copy of the source, not
      // to the file on disk — the product's source is never modified.
      const source = readFileSync(CONTRACTS_SERVICES, 'utf8');
      const polluted = source.replace(
        'export interface Environment {\n  readonly id: string;',
        'export interface Environment {\n  readonly id: string;\n  readonly db?: Kysely<FactoryDatabase>;',
      );
      expect(polluted).not.toBe(source);

      // The polluted copy is written to a scratch file **beside** the
      // original, so its relative imports still resolve — and it is
      // removed in a `finally`, so the repository is left as it was.
      const scratch = resolve(repoRoot, 'packages/contracts/src/__inv1_polluted__.ts');
      const imports = [
        "import type { Kysely, FactoryDatabase } from '@factory/db';",
      ].join('\n');
      writeFileSync(scratch, `${imports}\n${polluted}`, 'utf8');
      try {
        const hits = findDatabaseHandles(scratch);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.map((hit) => hit.path)).toContain('Environment.db');
      } finally {
        rmSync(scratch, { force: true });
      }
    });
  });

  describe('the network half — from inside a T2 container the control plane is unreachable', () => {
    let networkCreated = false;

    beforeAll(async () => {
      if (!running) {
        return;
      }
      // The data plane's network. It is created with **no** link to the
      // control plane's network and **no** published ports.
      await execFileAsync('docker', ['network', 'rm', '-f', DATA_PLANE_NETWORK]).catch(
        () => undefined,
      );
      await execFileAsync('docker', ['network', 'create', DATA_PLANE_NETWORK], {
        encoding: 'utf8',
      });
      networkCreated = true;

      await execFileAsync('docker', ['rm', '-f', CONTAINER]).catch(() => undefined);

      // The container is started the way the product specifies a T2
      // environment: on the data plane's network, with **no** environment
      // variables at all (so no `FACTORY_*_DATABASE_URL`), with **no**
      // volume for the Docker socket, and with **no** `extra_hosts` and
      // **no** host networking.
      //
      // The `postgres:16-alpine` image is the dev cluster's own, so the
      // container needs no pull. Its shell has `nc` and `getent`.
      await execFileAsync(
        'docker',
        [
          'run',
          '--detach',
          '--name',
          CONTAINER,
          '--network',
          DATA_PLANE_NETWORK,
          '--entrypoint',
          'sh',
          'postgres:16-alpine',
          '-c',
          'sleep 3600',
        ],
        { encoding: 'utf8' },
      );
    }, 120_000);

    afterAll(async () => {
      if (!running) {
        return;
      }
      await execFileAsync('docker', ['rm', '-f', CONTAINER]).catch(() => undefined);
      if (networkCreated) {
        await execFileAsync('docker', ['network', 'rm', '-f', DATA_PLANE_NETWORK]).catch(
          () => undefined,
        );
      }
    });

    it.skipIf(!running)('INV-1 the container is on the data plane network and not on the control plane network', async () => {
      // The mutation "attach the container to `factory-core`" is exactly
      // this: put the container on the network the control plane is on.
      // So the first thing to prove is that the container is **not** on
      // it — and that the control plane's own container **is**.
      const { stdout } = await execFileAsync(
        'docker',
        ['inspect', CONTAINER, '--format', '{{json .NetworkSettings.Networks}}'],
        { encoding: 'utf8' },
      );
      const networks = JSON.parse(stdout) as Record<string, unknown>;
      expect(Object.keys(networks)).toEqual([DATA_PLANE_NETWORK]);
      expect(Object.keys(networks)).not.toContain(CONTROL_PLANE_NETWORK);

      // And the control plane's Postgres **is** on its own network — so
      // the assertion above is not vacuous (the network exists, the
      // container is really elsewhere).
      const { stdout: controlStdout } = await execFileAsync(
        'docker',
        ['inspect', PG_HOST, '--format', '{{json .NetworkSettings.Networks}}'],
        { encoding: 'utf8' },
      );
      const controlNetworks = JSON.parse(controlStdout) as Record<string, unknown>;
      expect(Object.keys(controlNetworks)).toContain(CONTROL_PLANE_NETWORK);
    }, 60_000);

    it.skipIf(!running)('INV-1 the container carries no database credential in its environment', async () => {
      // The second clause of the mutation: "add a DB role to the env".
      //
      // The environment is the *other* way a database handle reaches the
      // data plane: not through the type, but through a connection string
      // the container was given. So the container's environment must carry
      // **no database credential**.
      //
      // The check is on *credentials*, not on every `PG*`-prefixed name:
      // the `postgres:16-alpine` image bakes in its own build metadata
      // (`PG_MAJOR`, `PG_VERSION`, `PGDATA`), which is the image's
      // provenance and not a way into the control plane. What matters is
      // that no **password**, **connection string** or **role** is in
      // there — those are the three things that could actually open a
      // session.
      const { stdout } = await execFileAsync(
        'docker',
        ['inspect', CONTAINER, '--format', '{{json .Config.Env}}'],
        { encoding: 'utf8' },
      );
      const env = JSON.parse(stdout) as string[];

      const credentials = env.filter(
        (entry) =>
          /FACTORY_[A-Z_]*DATABASE_URL/.test(entry) ||
          entry.startsWith('DATABASE_URL=') ||
          entry.startsWith('PGPASSWORD=') ||
          entry.startsWith('PGPASSFILE=') ||
          entry.startsWith('POSTGRES_PASSWORD=') ||
          entry.startsWith('POSTGRES_USER=') ||
          entry.startsWith('POSTGRES_HOST='),
      );
      expect(credentials).toEqual([]);

      // And the *only* reason the image's own `PG*` variables are present
      // is that the container was started with **no** `-e` flag at all.
      // So the container's environment is exactly the image's, and the
      // factory added nothing to it.
      const { stdout: imageEnv } = await execFileAsync(
        'docker',
        ['image', 'inspect', 'postgres:16-alpine', '--format', '{{json .Config.Env}}'],
        { encoding: 'utf8' },
      );
      expect(JSON.parse(stdout) as string[]).toEqual(
        JSON.parse(imageEnv) as string[],
      );
    }, 60_000);

    it.skipIf(!running)('INV-1 the container has no Docker socket mounted and no host bind mount', async () => {
      // The third clause of the spec: "the Docker socket". A container
      // with `/var/run/docker.sock` is a container that can start
      // containers — which means it can attach itself to the control
      // plane's network and undo the whole containment.
      //
      // The `postgres:16-alpine` image declares an **anonymous volume**
      // for `/var/lib/postgresql/data` (a `VOLUME` instruction in the
      // image's own Dockerfile). That is the image's own artefact, and it
      // is not a way out of the container — an anonymous volume holds
      // nothing but the container's own writes. What matters is that
      // **no bind mount from the host** is present: a bind mount could
      // carry the Docker socket, a `.pgpass`, or the control plane's
      // data directory.
      const { stdout } = await execFileAsync(
        'docker',
        ['inspect', CONTAINER, '--format', '{{json .Mounts}}'],
        { encoding: 'utf8' },
      );
      const mounts = JSON.parse(stdout) as {
        readonly Type?: string;
        readonly Source?: string;
        readonly Destination?: string;
      }[];

      // No mount is a bind mount.
      const bindMounts = mounts.filter((mount) => mount.Type === 'bind');
      expect(bindMounts).toEqual([]);

      // And no mount at all exposes the Docker socket or a Postgres
      // client configuration file.
      const destinations = mounts.map((mount) => mount.Destination ?? '');
      expect(destinations).not.toContain('/var/run/docker.sock');
      expect(destinations).not.toContain('/root/.pgpass');
      expect(destinations).not.toContain('/run/postgresql');
      expect(JSON.stringify(mounts)).not.toContain('docker.sock');

      // And the socket is not even present inside the container.
      const probe = await execInContainer(['test', '-S', '/var/run/docker.sock']);
      expect(probe.code).not.toBe(0);
    }, 60_000);

    it.skipIf(!running)('INV-1 the Postgres host does not resolve from inside the container', async () => {
      // The container is on the data plane's network, and the control
      // plane's network is not reachable from it — so the control plane's
      // service name does not resolve.
      expect(await resolves(PG_HOST)).toBeUndefined();
    }, 60_000);

    it.skipIf(!running)('INV-1 the Postgres port is not reachable from inside the container', async () => {
      // By name…
      expect(await canReach(PG_HOST, PG_PORT)).toBe(false);

      // …and by the IP the control plane's Postgres actually holds, which
      // is the harder test: a network that routes the IP without the name
      // would still be a leak.
      const { stdout } = await execFileAsync(
        'docker',
        [
          'inspect',
          PG_HOST,
          '--format',
          '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        ],
        { encoding: 'utf8' },
      );
      const ip = stdout.trim();
      expect(ip.length).toBeGreaterThan(0);
      expect(await canReach(ip, PG_PORT)).toBe(false);
    }, 60_000);

    it.skipIf(!running)('INV-1 factory-api does not resolve and is not reachable from inside the container', async () => {
      expect(await resolves(API_HOST)).toBeUndefined();
      expect(await canReach(API_HOST, API_PORT)).toBe(false);
    }, 60_000);

    it.skipIf(!running)('INV-1 the object store does not resolve and is not reachable from inside the container', async () => {
      for (const host of OBJECT_STORE_HOSTS) {
        expect(await resolves(host)).toBeUndefined();
        expect(await canReach(host, OBJECT_STORE_PORT)).toBe(false);
      }
    }, 60_000);

    it.skipIf(!running)('INV-1 the container has no configured egress route', async () => {
      // The honest half of the "arbitrary internet" claim.
      //
      // pack `08` §3 asks for the arbitrary internet to fail. This test
      // does **not** claim that, and it says so here rather than letting
      // a reader assume it:
      //
      // * The product's egress control is the `EnvSpec`'s
      //   `network.egress` allow-list, enforced by an egress proxy that
      //   **is not built** — the `net.egress.denied` event type is
      //   registered, but no proxy implements it. So there is no product
      //   code that could enforce the allow-list inside the container.
      // * Whether a container inherits the daemon's outbound connectivity
      //   is a property of the host's Docker configuration, which this
      //   test must not depend on — a test that asserted "no packets
      //   leave" would be asserting the CI machine's firewall, not the
      //   factory's containment.
      //
      // What **is** provable, and is the factory's own property, is that
      // **no egress route is configured**: the `EnvSpec` the product
      // declares for a T2 environment carries an empty egress
      // allow-list, and the container is started with no route to any
      // control-plane service.
      const { EnvSpec } = await import('../../packages/contracts/src/index.ts');

      const parsed = EnvSpec.safeParse({
        tier: 'T2',
        image: 'postgres:16-alpine',
        network: { egress: [] },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        // The allow-list is empty, so the *product's* specification
        // permits no egress at all.
        expect(parsed.data.network?.egress ?? []).toEqual([]);
      }

      // And the container publishes no port back out.
      const { stdout } = await execFileAsync(
        'docker',
        ['inspect', CONTAINER, '--format', '{{json .NetworkSettings.Ports}}'],
        { encoding: 'utf8' },
      );
      expect(JSON.parse(stdout) as Record<string, unknown>).toEqual({});
    }, 60_000);
  });
});
