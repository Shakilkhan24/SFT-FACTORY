#!/usr/bin/env node
/**
 * `tools/generate-capabilities` — write the v1 capability registry.
 *
 * pack 04 §5 is a **table**, one row per capability. The registry the
 * broker consults is a set of `ToolCapability` YAML documents plus their
 * sibling JSON Schemas, and a hand-transcribed copy of a table is a copy
 * that drifts.
 *
 * So the table is written **once**, here, as data — and the documents are
 * *generated* from it. The row and the document cannot disagree, because
 * the document is derived from the row.
 *
 * ## Why the INV-7 assertion lives here
 *
 * pack 04 §5's last row says no `prod.*`, `deploy.*`, `git.push.protected`,
 * `git.merge`, `secret.read` or `factory.write` capability exists in v1.
 * The list below is the registry, so the assertion is checked against the
 * list itself — at generation time — rather than against a directory
 * listing that could be edited by hand afterwards.
 *
 * Usage:
 *   node tools/generate-capabilities.ts [--check]
 *
 * `--check` verifies the committed documents match what the table produces.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CAPABILITIES_DIR = join(REPO_ROOT, 'definition', 'capabilities');

/**
 * One row of pack 04 §5's table.
 */
interface CapabilityRow {
  /** The capability's id. */
  readonly id: string;
  /** The capability's kind. */
  readonly kind: 'read' | 'mutation' | 'compute' | 'communicate';
  /** The effect class. */
  readonly effect: 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
  /** The transport. */
  readonly transport: 'inproc' | 'http' | 'cli' | 'mcp' | 'library';
  /** Whether the effect is reversible. */
  readonly reversible: boolean;
  /** Whether the effect is external. */
  readonly external: boolean;
  /** The scope the capability requires. */
  readonly scope: string;
  /** The resource pattern the capability is scoped to. */
  readonly resourcePattern: string;
  /** The environment the capability runs in. */
  readonly environment: string;
  /** The credential provider, or `undefined` for no credential. */
  readonly credentialProvider?: string;
  /** The credential's permissions. */
  readonly credentialPermissions?: Readonly<Record<string, 'read' | 'write'>>;
  /** The credential's TTL, in seconds. */
  readonly credentialTtlSeconds?: number;
  /** The trust the capability declares for its results. */
  readonly resultTrust: 'trusted' | 'untrusted';
  /** The trust the capability declares for its inputs. */
  readonly inputTrust: 'trusted' | 'untrusted';
  /** The cost unit. */
  readonly costUnit: string;
  /** The cost, in micro-dollars. */
  readonly costUsdMicros: number;
  /** The argument names the capability takes. */
  readonly args: readonly string[];
  /** The argument names the capability's summary must redact. */
  readonly redactArguments?: readonly string[];
  /** The paths the capability touches, when it touches any. */
  readonly paths?: readonly string[];
  /** The owner. */
  readonly owner: string;
  /** The stages that use the capability. */
  readonly usedBy: string;
  /** The health check's description. */
  readonly healthCheck: string;
}

/**
 * The capability's *version*.
 *
 * Every capability is at `1.0.0` in v1. The version is the capability
 * **contract's** version, not the implementation's: a capability's
 * arguments changing is a version bump.
 */
const VERSION = '1.0.0';

/**
 * The capability's owner.
 *
 * The factory's own engineering owns the capabilities; the integrations
 * that reach GitHub are owned by the same team, because the owner is who
 * answers for the capability's behaviour, not who wrote the code.
 */
const OWNER = 'factory-platform';

/**
 * The v1 capability registry — pack 04 §5's table, row for row.
 *
 * The order is the table's order, so the generated documents read the way
 * the pack reads.
 */
const CAPABILITIES: readonly CapabilityRow[] = [
  {
    id: 'repo.snapshot.read',
    kind: 'read',
    effect: 'E0',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'repo:read',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo'],
    owner: OWNER,
    usedBy: 'assembler, completion stages',
    healthCheck: 'the repository is reachable',
  },
  {
    id: 'repo.search',
    kind: 'read',
    effect: 'E0',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'repo:read',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'query'],
    owner: OWNER,
    usedBy: 'assembler (deterministic)',
    healthCheck: 'the repository is reachable',
  },
  {
    id: 'git.worktree.create',
    kind: 'compute',
    effect: 'E1',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'git.write.branch',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'branch'],
    owner: OWNER,
    usedBy: 'patch path',
    healthCheck: 'git is available',
  },
  {
    id: 'git.patch.apply',
    kind: 'mutation',
    effect: 'E1',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'repo:write:path:**',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'patch'],
    paths: ['**'],
    owner: OWNER,
    usedBy: 'patch path (path-scope enforced)',
    healthCheck: 'the worktree is writable',
  },
  {
    id: 'git.commit',
    kind: 'mutation',
    effect: 'E1',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'git.write.commit',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'message', 'paths'],
    paths: ['**'],
    owner: OWNER,
    usedBy: 'patch path',
    healthCheck: 'git is available',
  },
  {
    id: 'git.push.branch',
    kind: 'mutation',
    effect: 'E2',
    transport: 'cli',
    reversible: false,
    external: true,
    scope: 'git.write.branch',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { contents: 'write' },
    credentialTtlSeconds: 3600,
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'branch'],
    owner: OWNER,
    usedBy: 'patch path',
    healthCheck: 'git is available and the credential is live',
  },
  {
    id: 'github.pr.create',
    kind: 'mutation',
    effect: 'E2',
    transport: 'http',
    reversible: false,
    external: true,
    scope: 'git.write.pr',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { pull_requests: 'write' },
    credentialTtlSeconds: 3600,
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'title', 'body', 'head', 'base'],
    owner: OWNER,
    usedBy: 'PR stage',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.pr.update',
    kind: 'mutation',
    effect: 'E2',
    transport: 'http',
    reversible: false,
    external: true,
    scope: 'git.write.pr',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { pull_requests: 'write' },
    credentialTtlSeconds: 3600,
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'number', 'body'],
    owner: OWNER,
    usedBy: 'PR stage',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.pr.read',
    kind: 'read',
    effect: 'E0',
    transport: 'http',
    reversible: true,
    external: true,
    scope: 'repo:read',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { pull_requests: 'read' },
    credentialTtlSeconds: 3600,
    resultTrust: 'untrusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'number'],
    owner: OWNER,
    usedBy: 'review, D-2',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.issue.read',
    kind: 'read',
    effect: 'E0',
    transport: 'http',
    reversible: true,
    external: true,
    scope: 'repo:read',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { issues: 'read' },
    credentialTtlSeconds: 3600,
    resultTrust: 'untrusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'number'],
    owner: OWNER,
    usedBy: 'intake',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.issue.comment',
    kind: 'communicate',
    effect: 'E2',
    transport: 'http',
    reversible: false,
    external: true,
    scope: 'git.write.pr',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { issues: 'write' },
    credentialTtlSeconds: 3600,
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'number', 'body'],
    owner: OWNER,
    usedBy: 'status/escalation notes',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.permission.read',
    kind: 'read',
    effect: 'E0',
    transport: 'http',
    reversible: true,
    external: true,
    scope: 'repo:read',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { metadata: 'read' },
    credentialTtlSeconds: 3600,
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo'],
    owner: OWNER,
    usedBy: 'intake auth',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.checks.publish',
    kind: 'mutation',
    effect: 'E2',
    transport: 'http',
    reversible: false,
    external: true,
    scope: 'git.write.pr',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { checks: 'write' },
    credentialTtlSeconds: 3600,
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'headSha', 'name', 'conclusion', 'summary'],
    owner: OWNER,
    usedBy: 'merge gate',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.ci.read',
    kind: 'read',
    effect: 'E0',
    transport: 'http',
    reversible: true,
    external: true,
    scope: 'repo:read',
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { actions: 'read' },
    credentialTtlSeconds: 3600,
    resultTrust: 'untrusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo', 'headSha'],
    owner: OWNER,
    usedBy: 'D-2, merge-gate',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'github.advisories.read',
    kind: 'read',
    effect: 'E0',
    transport: 'http',
    reversible: true,
    external: true,
    scope: 'net.fetch',
    resourcePattern: 'host:{host}',
    environment: 'orchestrator',
    credentialProvider: 'github',
    credentialPermissions: { dependabot_alerts: 'read' },
    credentialTtlSeconds: 3600,
    resultTrust: 'untrusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['repo'],
    owner: OWNER,
    usedBy: 'D-1',
    healthCheck: 'the GitHub API is reachable',
  },
  {
    id: 'net.fetch',
    kind: 'read',
    effect: 'E0',
    transport: 'inproc',
    reversible: true,
    external: true,
    scope: 'net.fetch',
    resourcePattern: 'host:{host}',
    environment: 'orchestrator',
    resultTrust: 'untrusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['url'],
    owner: OWNER,
    usedBy: 'D-1 (OSV, registry metadata)',
    healthCheck: 'the fetch service is reachable',
  },
  {
    id: 'shell.sandboxed',
    kind: 'compute',
    effect: 'E1',
    transport: 'inproc',
    reversible: false,
    external: false,
    scope: 'shell.sandboxed',
    resourcePattern: 'env:{envId}',
    environment: 'T2',
    resultTrust: 'trusted',
    inputTrust: 'untrusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['command', 'args'],
    owner: OWNER,
    usedBy: 'verify, harness (recorded)',
    healthCheck: 'the isolation service is reachable',
  },
  {
    id: 'artefact.write',
    kind: 'mutation',
    effect: 'E1',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'artefact.write',
    resourcePattern: 'run:{runId}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['runId', 'kind', 'content'],
    owner: OWNER,
    usedBy: 'run store',
    healthCheck: 'the artefact store is reachable',
  },
  {
    id: 'knowledge.write',
    kind: 'mutation',
    effect: 'E1',
    transport: 'inproc',
    reversible: true,
    external: false,
    scope: 'knowledge.write',
    resourcePattern: 'run:{runId}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['runId', 'kind', 'content'],
    owner: OWNER,
    usedBy: 'record stage',
    healthCheck: 'the knowledge store is reachable',
  },
  {
    id: 'notify.send',
    kind: 'communicate',
    effect: 'E2',
    transport: 'http',
    reversible: false,
    external: true,
    scope: 'notify.send',
    resourcePattern: 'host:{host}',
    environment: 'orchestrator',
    resultTrust: 'trusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['channel', 'message'],
    owner: OWNER,
    usedBy: 'ops',
    healthCheck: 'the notification service is reachable',
  },
  {
    id: 'mcp.fixture.echo',
    kind: 'read',
    effect: 'E0',
    transport: 'mcp',
    reversible: true,
    external: true,
    scope: 'mcp.test',
    resourcePattern: 'transport:{transport}',
    environment: 'test',
    resultTrust: 'untrusted',
    inputTrust: 'trusted',
    costUnit: 'call',
    costUsdMicros: 0,
    args: ['message'],
    owner: OWNER,
    usedBy: 'contract test (FR-62)',
    healthCheck: 'the fixture MCP server is reachable',
  },
];

/**
 * The capability ids that must **not** exist in v1.
 *
 * pack 04 §5's last row, and the `INV-7` invariant: no `prod.*`,
 * `deploy.*`, `git.push.protected`, `git.merge`, `secret.read` or
 * `factory.write` capability exists in v1.
 *
 * The check is against the **list**, not the directory: a hand-added file
 * would not be in the list, but the list is what the generator writes, so
 * the directory and the list agree — and the assertion catches a *change
 * to the list*, which is where the invariant could be lost.
 */
const FORBIDDEN_CAPABILITY_IDS: readonly string[] = [
  'git.push.protected',
  'git.merge',
  'secret.read',
  'factory.write',
];

/**
 * The forbidden capability id **prefixes**.
 */
const FORBIDDEN_CAPABILITY_PREFIXES: readonly string[] = ['prod.', 'deploy.'];

/**
 * The JSON Schema for a capability's arguments.
 *
 * Every argument is a string except where the capability's own nature says
 * otherwise — a patch is a string, a list of paths is an array. The
 * generator emits the schema from the row, so the schema and the
 * capability's declared arguments cannot drift.
 */
const inputSchemaOf = (row: CapabilityRow): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};

  for (const name of row.args) {
    if (name === 'paths') {
      properties[name] = { type: 'array', items: { type: 'string' } };
      continue;
    }
    if (name === 'number') {
      properties[name] = { type: 'integer' };
      continue;
    }
    properties[name] = { type: 'string' };
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    required: [...row.args],
    additionalProperties: false,
  };
};

/**
 * The JSON Schema for a capability's result.
 *
 * A capability's result is free-form in v1 — the pack does not specify
 * one — so the schema accepts any object. Writing `additionalProperties:
 * false` with no properties would refuse every result, which would be
 * worse than not constraining it.
 */
const outputSchemaOf = (_row: CapabilityRow): Record<string, unknown> => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});

/**
 * The capability's YAML document.
 *
 * The YAML is emitted by hand (a small, stable writer) rather than with
 * a YAML library, so the committed documents have a **readable** shape —
 * one key per line, no flow collections — and a diff shows the change
 * rather than a re-serialisation.
 */
const yamlOf = (row: CapabilityRow): string => {
  const lines: string[] = [];

  lines.push(`# ${row.id} — pack 04 §5's v1 capability registry.`);
  lines.push('#');
  lines.push(`# ${row.usedBy}.`);
  lines.push('#');
  lines.push('# The scope is what a grant must cover; the resource pattern is what the');
  lines.push('# resource-scope check matches the concrete target against. Both are');
  lines.push('# load-bearing: a grant that permits the capability but is scoped to another');
  lines.push('# repository is refused on the resource, not on the capability.');
  lines.push('');
  lines.push('apiVersion: factory/v1');
  lines.push('kind: ToolCapability');
  lines.push('metadata:');
  lines.push(`  name: ${row.id}`);
  lines.push(`  version: "${VERSION}"`);
  lines.push('spec:');
  lines.push(`  owner: ${row.owner}`);
  lines.push(`  kind: ${row.kind}`);
  lines.push(`  transport: ${row.transport}`);
  lines.push('  effect:');
  lines.push(`    class: ${row.effect}`);
  lines.push(`    reversible: ${row.reversible}`);
  lines.push(`    external: ${row.external}`);
  lines.push('  scope:');
  lines.push('    required:');
  lines.push(`      - "${row.scope}"`);
  lines.push(`    resourcePattern: "${row.resourcePattern}"`);
  lines.push(`    environment: "${row.environment}"`);
  lines.push('  credentials:');
  if (row.credentialProvider === undefined) {
    // The contracts' `credentials.provider` is `z.string().min(1)` — it
    // has no way to say "this capability needs no credential". pack 04 §5
    // marks those capabilities with "—", so the registry needs a
    // **named** sentinel rather than an empty string.
    //
    // `none` is that sentinel. It is not a provider: the broker's step 7
    // asks the credential provider for a credential and the provider
    // returns nothing for a capability that names no provider — so the
    // sentinel is what makes "no credential" expressible, and it keeps
    // the contracts honest by not editing them (HR-12).
    lines.push('    provider: "none"');
    lines.push('    permissions: {}');
    lines.push('    ttlSeconds: 60');
  } else {
    lines.push(`    provider: "${row.credentialProvider}"`);
    lines.push('    permissions:');
    for (const [name, permission] of Object.entries(row.credentialPermissions ?? {})) {
      lines.push(`      ${name}: ${permission}`);
    }
    lines.push(`    ttlSeconds: ${row.credentialTtlSeconds ?? 3600}`);
  }
  lines.push(`  inputSchema:`);
  lines.push(`    $ref: "schemas/capabilities/${row.id}.input.schema.json"`);
  lines.push(`  outputSchema:`);
  lines.push(`    $ref: "schemas/capabilities/${row.id}.output.schema.json"`);
  lines.push('  trust:');
  lines.push(`    inputTrust: ${row.inputTrust}`);
  lines.push(`    resultTrust: ${row.resultTrust}`);
  lines.push('  health:');
  lines.push(`    check: "${row.healthCheck}"`);
  lines.push('    timeoutMs: 30000');
  lines.push(`    degraded: "${row.id} is degraded; the call may fail"`);
  lines.push('  observability:');
  lines.push('    redactArguments:');
  const redact = row.redactArguments ?? [];
  if (redact.length === 0) {
    // An empty YAML list must be written as `[]` — a bare key with no
    // value parses as `null`, which the contract's `z.array(z.string())`
    // rejects.
    lines[lines.length - 1] = '    redactArguments: []';
  }
  for (const name of redact) {
    lines.push(`      - "${name}"`);
  }
  lines.push('  cost:');
  lines.push(`    unit: "${row.costUnit}"`);
  lines.push(`    usdMicros: ${row.costUsdMicros}`);

  return `${lines.join('\n')}\n`;
};

/**
 * The document's file name.
 *
 * The id, with `.` replaced by `-`. The name is not part of the contract
 * (the loader is a tree walk keyed on content), but a readable name makes
 * the directory legible.
 */
const fileNameOf = (row: CapabilityRow): string => `${row.id.replace(/\./g, '-')}.yaml`;

/**
 * The schema's file name.
 *
 * The capability schemas live in `schemas/capabilities/`, not in
 * `schemas/` itself. `schemas/` is the **contract export** directory —
 * `tools/export-schemas.ts` writes the contracts' JSON Schema there, and
 * its `--check` mode reports any file in that directory which no contract
 * produced as an **orphan**. A capability's `inputSchema` is not a
 * contract export; it is the capability's own argument schema. Putting it
 * in the same directory would make the contract exporter's drift check
 * fail on every capability — and, worse, would invite someone to "fix"
 * that by deleting the capability's schemas.
 *
 * The subdirectory keeps the two sets apart while leaving the ref
 * convention alone: a ref is still `schemas/<path>.json`, relative to the
 * repository root, exactly as the contracts' `SchemaRef` documents.
 */
const schemaFileNameOf = (row: CapabilityRow, which: 'input' | 'output'): string =>
  `schemas/capabilities/${row.id}.${which}.schema.json`;

/**
 * The INV-7 assertion.
 *
 * @throws {Error} when a forbidden capability is in the list.
 */
const assertInv7 = (): void => {
  for (const row of CAPABILITIES) {
    if (FORBIDDEN_CAPABILITY_IDS.includes(row.id)) {
      throw new Error(`INV-7: the capability ${row.id} must not exist in v1`);
    }
    for (const prefix of FORBIDDEN_CAPABILITY_PREFIXES) {
      if (row.id.startsWith(prefix)) {
        throw new Error(`INV-7: the capability ${row.id} must not exist in v1`);
      }
    }
  }
};

/**
 * The JSON text for a schema document.
 *
 * The `title` and `description` are the capability's own, so a schema file
 * is readable on its own.
 */
const schemaJsonOf = (row: CapabilityRow, which: 'input' | 'output'): string => {
  const schema = which === 'input' ? inputSchemaOf(row) : outputSchemaOf(row);
  const document = {
    ...schema,
    title: `${row.id} ${which}`,
    description:
      which === 'input'
        ? `The arguments ${row.id} accepts.`
        : `The result ${row.id} returns.`,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
};

/**
 * The generator's main.
 */
const main = (): void => {
  const check = process.argv.includes('--check');

  assertInv7();

  const expected = new Map<string, string>();

  for (const row of CAPABILITIES) {
    expected.set(join(CAPABILITIES_DIR, fileNameOf(row)), yamlOf(row));
    expected.set(
      join(REPO_ROOT, schemaFileNameOf(row, 'input')),
      schemaJsonOf(row, 'input'),
    );
    expected.set(
      join(REPO_ROOT, schemaFileNameOf(row, 'output')),
      schemaJsonOf(row, 'output'),
    );
  }

  if (check) {
    const drifted: string[] = [];
    for (const [path, content] of expected) {
      let actual: string;
      try {
        actual = readFileSync(path, 'utf8');
      } catch {
        drifted.push(`${path} is missing`);
        continue;
      }
      if (actual !== content) {
        drifted.push(`${path} does not match the table`);
      }
    }
    if (drifted.length > 0) {
      process.stderr.write(
        `the capability registry has drifted from the table:\n${drifted.map((line) => `  ${line}`).join('\n')}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`the capability registry matches the table (${CAPABILITIES.length} capabilities)\n`);
    return;
  }

  mkdirSync(CAPABILITIES_DIR, { recursive: true });
  for (const [path, content] of expected) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  process.stdout.write(
    `wrote ${CAPABILITIES.length} capabilities and their schemas\n`,
  );
};

main();
