/**
 * `cli` — the factory's command line (pack 04 §"Command catalogue").
 *
 * This ticket delivers the `factory db` command group (checklist 02, T-1.02).
 * The rest of the catalogue arrives with the tickets that own the commands;
 * each is added here as a new subcommand, and the table stays the single
 * place that says what exists.
 *
 * ## The two kinds of command
 *
 * The catalogue has two kinds, and they differ in **where the authority
 * comes from**:
 *
 * * **ops** commands (`db`, `events`, `projections`, `definition`) run as
 *   a Postgres role and read the database directly;
 * * **access-point** commands (`login`, `whoami`, `tasks`, `kill-switch`)
 *   run as a human with a `fac_…` token and go through the API.
 *
 * The access-point commands go through the API because pack `04` §3 says
 * every call emits an event with `actor=human:<login>` and
 * `authority.basis='human-access-point'`. A command that wrote to the
 * database directly would change the factory without leaving a trace of
 * who changed it — and for the kill switch that is exactly the trace an
 * operator most needs.
 *
 * The CLI never imports another app (pack 02 §3) — it wires packages together.
 */

import { runDbCommand } from './db.js';
import { defaultMigrationsDir } from './db.js';
import { runDefinitionCommand } from './definition.js';
import {
  buildDefinitionStore,
  parseArgs,
  refusingScmCheck,
  resolveApproval,
} from './definition-wiring.js';
import { runEventsCommand } from './events.js';
import { resolveDefinitionDirectory, resolveContractsDistDirectory, resolveSchemasDirectory } from './paths.js';
import { runProjectionsCommand, PROJECTIONS_SUBCOMMANDS } from './projections.js';
import { DEFAULT_API_URL } from './client.js';
import { runKillSwitch } from './kill-switch.js';
import {
  runLogin,
  runTasksList,
  runTasksShow,
  runWhoami,
  type AccessPointOptions,
} from './tasks.js';
import { runAuditChain, PostgresChainVerifier, type ChainVerifier } from './audit.js';
import { runDoctor } from './doctor.js';

const USAGE = `usage: factory <command> [options]

commands:
  db migrate             apply every pending migration
  db status              show which migrations are applied
  db partitions [--ensure [months]]
                         list the event-log partitions; --ensure creates the
                         monthly partitions ahead of time

  events list [count] [aggregateId]
                         show the most recent events
  events show <aggregateId>
                         show one aggregate's chain and its chain verdict
  events health          report seq gaps and aggregate-version gaps

  projections status     show the projector's cursor, row counts and staleness
  projections catch-up   run the projector until it reaches the end of the log
  projections check      compare a rebuild with what is there, changing nothing
  projections rebuild --yes
                         drop every projection and replay the log (A0.6)

  definition validate    check every definition document against its contract
  definition plan        show the structured diff against the applied version
  definition apply --sha <sha> [--approval <id>]
                         apply a definition SHA (needs a bound approval)

  doctor                 check the local environment and name every failure
                         (exit 1 if any check failed)

  login --token fac_…    store a CLI token and prove it works
  whoami                 show who the stored token is
  tasks ls [--limit N] [--state S]
                         list the tasks the API knows about
  tasks show <taskId>    show one task
  kill-switch on|off --reason <why>
                         engage or release the factory's kill switch

environment:
  FACTORY_OWNER_DATABASE_URL   connection string for the factory_owner role
  FACTORY_PROJECTOR_DATABASE_URL
                               connection string for the factory_projector role
  FACTORY_APPLIER_DATABASE_URL
                               connection string for the factory_applier role
  FACTORY_MIGRATIONS_DIR       override the migrations directory
  FACTORY_DEFINITION_DIR       override the definition directory
  FACTORY_API_URL               base URL of the access-point API
  XDG_CONFIG_HOME               where the CLI keeps its credentials
`;

export interface CliResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * The connection string the CLI uses for owner-role work.
 *
 * Only the owner role is read here. The runtime roles have their own
 * environment variables (`FACTORY_APP_DATABASE_URL` and friends) and are used
 * by the components that need them — not by the CLI's migration path.
 */
const ownerConnectionString = (
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => environment['FACTORY_OWNER_DATABASE_URL'];

/**
 * How the owner role is assumed.
 *
 * `FACTORY_DB_ROLE_MODE=assume` makes the CLI log in with the given
 * connection string and then `SET ROLE factory_owner`. The dev cluster uses
 * this: its `factory_owner` is a NOLOGIN group role, and the migration tables
 * must be owned by it. Production connects as the role directly and does not
 * set the variable.
 */
const ownerRoleMode = (
  environment: NodeJS.ProcessEnv = process.env,
): 'direct' | 'assume' =>
  environment['FACTORY_DB_ROLE_MODE'] === 'assume' ? 'assume' : 'direct';

/**
 * The base URL the access-point commands use.
 *
 * `FACTORY_API_URL`, defaulting to the loopback. The default is the
 * loopback because the API is a private access point — a CLI that
 * defaulted to a public host would be a foot-gun.
 */
const apiUrl = (environment: NodeJS.ProcessEnv = process.env): string =>
  environment['FACTORY_API_URL'] ?? DEFAULT_API_URL;

/**
 * The options the access-point commands read.
 */
const accessPointOptions = (
  environment: NodeJS.ProcessEnv = process.env,
): AccessPointOptions => ({
  apiUrl: apiUrl(environment),
  environment,
});

/**
 * The schemas directory the doctor compares the export against.
 */
const schemasDir = (
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => resolveSchemasDirectory(environment);

/**
 * The contracts' compiled output — what the export is compared against.
 */
const contractsDistDir = (
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => resolveContractsDistDirectory(environment);

/**
 * Build the chain verifier the `audit chain` command uses.
 *
 * The **Postgres** verifier is the real one — it wraps
 * `PostgresEventLog.verifyChain`. It needs a connection string; without
 * one the command has nothing to verify, and it says so rather than
 * reporting an empty chain as intact.
 */
const buildChainVerifier = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ChainVerifier | undefined> => {
  const connectionString =
    environment['FACTORY_PROJECTOR_DATABASE_URL'] ??
    environment['FACTORY_OWNER_DATABASE_URL'];
  if (connectionString === undefined) {
    return undefined;
  }
  const { PostgresEventLog } = await import('@factory/eventlog');
  const { createDatabase, destroyDatabase } = await import('@factory/db');
  const db = createDatabase({
    connectionString,
    role: 'factory_projector',
    mode: ownerRoleMode(environment),
    max: 2,
  });
  const log = new PostgresEventLog({ db });
  const verifier = new PostgresChainVerifier(log);
  return {
    verify: async (aggregate) => {
      try {
        return await verifier.verify(aggregate);
      } finally {
        await destroyDatabase(db);
      }
    },
  };
};

/**
 * Run the CLI with an argument vector (without `node` and the script path).
 */
export const run = async (
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CliResult> => {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return { lines: USAGE.trimEnd().split('\n'), exitCode: command === undefined ? 2 : 0 };
  }

  if (command === 'db') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory db migrate | status | partitions'],
        exitCode: 2,
      };
    }
    const connectionString = ownerConnectionString(environment);
    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_OWNER_DATABASE_URL is not set.',
          'The db commands run as the owner role (it owns the schema and may create partitions).',
        ],
        exitCode: 2,
      };
    }
    return runDbCommand(
      subcommand,
      {
        connectionString,
        migrationsDir: defaultMigrationsDir(environment),
        mode: ownerRoleMode(environment),
      },
      subArgs,
    );
  }

  if (command === 'events') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory events list | show | health'],
        exitCode: 2,
      };
    }
    // The event log is read through the **projector** role: it may read the
    // log and may not write it. Using it here means the CLI exercises the
    // same privilege boundary the running system does.
    const connectionString =
      environment['FACTORY_PROJECTOR_DATABASE_URL'] ??
      environment['FACTORY_OWNER_DATABASE_URL'];
    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_PROJECTOR_DATABASE_URL is not set.',
          'The events commands read the log through the factory_projector role.',
        ],
        exitCode: 2,
      };
    }
    return runEventsCommand(
      subcommand,
      {
        connectionString,
        mode: ownerRoleMode(environment),
        role: 'factory_projector',
      },
      subArgs,
    );
  }

  if (command === 'projections') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory projections status | catch-up | check | rebuild --yes'],
        exitCode: 2,
      };
    }
    // The subcommand is checked **before** the connection string, because
    // a typo in the subcommand is the operator's mistake and the error
    // must name it — not send them off to configure a database for a
    // command that does not exist.
    if (!PROJECTIONS_SUBCOMMANDS.includes(subcommand)) {
      return {
        lines: [
          `unknown subcommand \`factory projections ${subcommand}\``,
          'usage: factory projections status | catch-up | check | rebuild --yes',
        ],
        exitCode: 2,
      };
    }
    // The projector reads the log and writes only its own views, so the
    // command runs through the **projector** role — the same role the
    // running projector uses.
    const connectionString =
      environment['FACTORY_PROJECTOR_DATABASE_URL'] ??
      environment['FACTORY_OWNER_DATABASE_URL'];
    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_PROJECTOR_DATABASE_URL is not set.',
          'The projections commands run as the factory_projector role.',
        ],
        exitCode: 2,
      };
    }
    return runProjectionsCommand(
      subcommand,
      {
        connectionString,
        mode: ownerRoleMode(environment),
        role: 'factory_projector',
      },
      subArgs,
    );
  }

  if (command === 'definition') {    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory definition validate | plan | apply'],
        exitCode: 2,
      };
    }

    const parsed = parseArgs(subArgs);
    const sha = typeof parsed.flags['sha'] === 'string' ? parsed.flags['sha'] : undefined;
    const approvalId =
      typeof parsed.flags['approval'] === 'string' ? parsed.flags['approval'] : undefined;

    // The applier needs the **applier** role, so the connection string is
    // the applier's. The owner role is accepted as a fallback for the dev
    // cluster, where the roles are group roles assumed over one connection.
    const connectionString =
      environment['FACTORY_APPLIER_DATABASE_URL'] ??
      environment['FACTORY_OWNER_DATABASE_URL'];

    const definitionRoot = resolveDefinitionDirectory(environment);

    const { store, approvals, destroy } = buildDefinitionStore({
      definitionRoot,
      connectionString,
      mode: ownerRoleMode(environment),
      appliedBy: environment['FACTORY_OWNER_LOGIN'],
      approvalId,
      sha,
    });

    try {
      return await runDefinitionCommand(
        subcommand,
        {
          definitionRoot,
          scm: refusingScmCheck(),
          store,
          approval: await resolveApproval(approvalId, approvals),
          appliedBy: environment['FACTORY_OWNER_LOGIN'] ?? 'unknown',
          sha,
        },
      );
    } finally {
      await destroy();
    }
  }

  if (command === 'doctor') {
    // The doctor needs a database, but it says so **before** it fails:
    // "no connection string" and "the database is unreachable" are
    // different problems, and the operator needs to be told which one
    // they have.
    const connectionString = ownerConnectionString(environment);
    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_OWNER_DATABASE_URL is not set.',
          'The doctor checks the database, the migrations, the event log,',
          'the hash chains and the schema export, so it needs a database.',
        ],
        exitCode: 2,
      };
    }

    const { buildDoctorChecks } = await import('./doctor-checks.js');
    const resolvedSchemasDir = schemasDir(environment);
    const resolvedContractsDist = contractsDistDir(environment);
    return runDoctor({
      checks: buildDoctorChecks({
        connectionString,
        migrationsDir: defaultMigrationsDir(environment),
        mode: ownerRoleMode(environment),
        ...(resolvedSchemasDir === undefined
          ? {}
          : { schemasDir: resolvedSchemasDir }),
        ...(resolvedContractsDist === undefined
          ? {}
          : { contractsDistDir: resolvedContractsDist }),
      }),
    });
  }

  // ---- the access-point commands ---------------------------------------
  //
  // These run as a human with a `fac_…` token and go through the API,
  // so every change they make is recorded with the caller's authority.

  if (command === 'login') {
    const parsed = parseArgs(rest);
    const token = typeof parsed.flags['token'] === 'string' ? parsed.flags['token'] : undefined;
    return runLogin(token, accessPointOptions(environment));
  }

  if (command === 'whoami') {
    return runWhoami(accessPointOptions(environment));
  }

  if (command === 'tasks') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return { lines: ['usage: factory tasks ls | show <taskId>'], exitCode: 2 };
    }
    if (subcommand === 'ls' || subcommand === 'list') {
      const parsed = parseArgs(subArgs);
      const limit =
        typeof parsed.flags['limit'] === 'string' ? Number(parsed.flags['limit']) : undefined;
      const state = typeof parsed.flags['state'] === 'string' ? parsed.flags['state'] : undefined;
      return runTasksList({
        ...accessPointOptions(environment),
        ...(limit === undefined ? {} : { limit }),
        ...(state === undefined ? {} : { state }),
      });
    }
    if (subcommand === 'show') {
      return runTasksShow(subArgs[0], accessPointOptions(environment));
    }
    return {
      lines: [`unknown subcommand \`factory tasks ${subcommand}\``, 'usage: factory tasks ls | show <taskId>'],
      exitCode: 2,
    };
  }

  if (command === 'kill-switch') {
    const [state, ...subArgs] = rest;
    const parsed = parseArgs(subArgs);
    const reason = typeof parsed.flags['reason'] === 'string' ? parsed.flags['reason'] : undefined;
    return runKillSwitch(state, reason, accessPointOptions(environment));
  }

  if (command === 'audit') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand !== 'chain') {
      return {
        lines: [
          `unknown subcommand \`factory audit ${subcommand ?? ''}\``,
          'usage: factory audit chain <taskId>',
        ],
        exitCode: 2,
      };
    }
    const verifier = await buildChainVerifier(environment);
    if (verifier === undefined) {
      return {
        lines: [
          'FACTORY_PROJECTOR_DATABASE_URL is not set.',
          'The audit chain command verifies the event log, so it needs a database.',
          'It reads the log through the factory_projector role.',
        ],
        exitCode: 2,
      };
    }
    return runAuditChain(subArgs[0], verifier);
  }

  return {
    lines: [`unknown command \`factory ${command}\``, '', USAGE.trimEnd()],
    exitCode: 2,
  };
};

/**
 * The process entry point.
 */
export const main = async (): Promise<void> => {
  const result = await run(process.argv.slice(2));
  for (const line of result.lines) {
    console.log(line);
  }
  process.exitCode = result.exitCode;
};
