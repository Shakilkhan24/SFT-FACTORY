/**
 * T-1.08 — the **capability registry**.
 *
 * blueprint 11 §3: the registry makes the capability set **explicit and
 * finite**. This file proves that the registry loads, that every
 * capability it lists is **reachable and usable**, and — the assertion
 * that matters — that the capabilities pack 04 §5 **forbids** are absent.
 *
 * ## What INV-7 is
 *
 * pack 04 §5's last row: no `prod.*`, no `deploy.*`, no
 * `git.push.protected`, no `git.merge`, no `secret.read`, no
 * `factory.write` capability exists in v1.
 *
 * The registry is the factory's *entire* tool surface, so a capability
 * that is listed there **is** a capability the broker will serve. The
 * assertion is therefore not a documentation nicety — it is the property
 * that says "the factory cannot deploy to production, cannot merge, and
 * cannot read a secret."
 *
 * ## Why the assertion is checked here as well as at generation time
 *
 * The generator (`tools/generate-capabilities.ts`) checks INV-7 against its
 * own table, so a row cannot be added without tripping it. But the
 * generator checks the **table**, and the registry is the **documents on
 * disk** — and the documents are files, and files can be edited by hand.
 *
 * So the assertion is also checked against what actually loads. Two
 * checks, two different objects: the table and the artefacts.
 *
 * ## Why a missing schema makes a capability unavailable
 *
 * The registry resolves each capability's `{$ref}` schema. A ref that
 * cannot be resolved must make the capability **unavailable** — not
 * silently "no schema", because a capability with no input schema accepts
 * *any* arguments. A missing schema file would widen the capability
 * rather than refuse it, so the registry fails closed.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFINITION_ROOT,
  buildCapabilityRegistry,
  readRawDocuments,
  validateDocument,
  type CapabilityRegistryEntry,
} from '../../packages/definition/src/index.ts';
import { InMemoryCapabilityRegistry } from '../../packages/broker/src/index.ts';
import type { ToolCapabilityDefinition } from '../../packages/contracts/src/index.ts';
import { join } from 'node:path';

/**
 * The capability ids pack 04 §5 forbids in v1.
 */
const FORBIDDEN_IDS = [
  'git.push.protected',
  'git.merge',
  'secret.read',
  'factory.write',
] as const;

/**
 * The capability id prefixes pack 04 §5 forbids in v1.
 */
const FORBIDDEN_PREFIXES = ['prod.', 'deploy.'] as const;

/**
 * Load the capability documents and build the registry from them.
 *
 * ## Why the capabilities subtree, and not the whole definition
 *
 * The repository's `definition/` also holds `repos/software-factory.yaml`,
 * whose kind `RepoRegistryEntry` the contracts do not define — the open
 * T-1.06 escalation (`docs/escalations/T-1.06-repo-registry-kind.md`). The
 * loader fails closed on a kind it does not know, so the *whole* definition
 * does not load.
 *
 * That gap is **not** this ticket's to fix (HR-12: `packages/contracts` is
 * frozen; a contract change is its own ticket). And it is not this
 * ticket's to route around either — the registry is built from the
 * capability documents, so the test reads the capability documents.
 *
 * The **per-document** path is used (`readRawDocuments` +
 * `validateDocument`) rather than `loadDefinition`, because
 * `loadDefinition` also assembles the *bundle*, and the bundle must
 * contain a `FactoryDefinition` and a `PolicyBundle` — documents that
 * live outside the capabilities subtree.
 *
 * The schema refs still resolve against the repository's `schemas/`
 * directory, because `buildCapabilityRegistry` is given the **definition**
 * root, not the capabilities subtree.
 */
const loadRegistry = async (): Promise<{
  readonly documents: readonly ToolCapabilityDefinition[];
  readonly entries: readonly CapabilityRegistryEntry[];
  readonly problems: readonly { readonly capabilityId: string; readonly reason: string }[];
}> => {
  const raw = await readRawDocuments(join(DEFINITION_ROOT, 'capabilities'));
  if (!raw.ok) {
    throw new Error(
      `the capability documents could not be read: ${JSON.stringify(raw.failures, null, 2)}`,
    );
  }

  const documents: ToolCapabilityDefinition[] = [];
  for (const candidate of raw.documents) {
    const validated = validateDocument(candidate);
    if (!validated.ok) {
      throw new Error(
        `the capability document ${validated.failure.path} did not validate: ${validated.failure.reason}`,
      );
    }
    if (validated.document.kind === 'ToolCapability') {
      // A validated document is a **tagged** wrapper — `{kind, value}` —
      // so the definition itself is under `value`.
      documents.push(validated.document.value as ToolCapabilityDefinition);
    }
  }

  const registry = await buildCapabilityRegistry(documents, DEFINITION_ROOT);
  return { documents, entries: registry.entries, problems: registry.problems };
};

describe('T-1.08 — the capability registry', () => {
  it('loads the capability documents without a problem', async () => {
    const { documents, problems } = await loadRegistry();

    expect(problems).toEqual([]);
    expect(documents).toHaveLength(21);
  });

  it('finds every capability pack 04 §5 lists', async () => {
    const { documents } = await loadRegistry();

    // pack 04 §5's table has 21 rows. The count is asserted so that a
    // capability silently dropped from the table is a test failure.
    expect(documents).toHaveLength(21);
  });

  it('resolves every capability’s schemas', async () => {
    const { entries, problems } = await loadRegistry();

    expect(problems).toEqual([]);
    expect(entries.filter((entry) => entry.availability === 'available')).toHaveLength(21);
  });

  it('gives every available capability a resolved input and output schema', async () => {
    const { entries } = await loadRegistry();

    for (const entry of entries) {
      expect(entry.availability, entry.capability.id).toBe('available');
      expect(entry.inputSchema, `${entry.capability.id} has no input schema`).toBeDefined();
      expect(entry.outputSchema, `${entry.capability.id} has no output schema`).toBeDefined();
    }
  });

  it('INV-7 — no forbidden capability id exists', async () => {
    const { entries } = await loadRegistry();
    const ids = entries.map((entry) => entry.capability.id);

    for (const forbidden of FORBIDDEN_IDS) {
      expect(ids, `${forbidden} must not exist in v1`).not.toContain(forbidden);
    }
  });

  it('INV-7 — no forbidden capability prefix exists', async () => {
    const { entries } = await loadRegistry();
    const ids = entries.map((entry) => entry.capability.id);

    for (const prefix of FORBIDDEN_PREFIXES) {
      const offending = ids.filter((id) => id.startsWith(prefix));
      expect(offending, `no capability may start with "${prefix}"`).toEqual([]);
    }
  });

  it('INV-7 — the assertion holds for the broker’s registry too', async () => {
    // The broker does not consult the definition documents directly — it
    // consults a `CapabilityRegistry`. So the assertion is repeated
    // against the registry the broker actually sees, to prove the
    // filtering did not happen *between* the two.
    const { entries } = await loadRegistry();
    const registry = new InMemoryCapabilityRegistry(
      entries.map((entry) => ({
        capability: entry.capability,
        ...(entry.inputSchema === undefined ? {} : { inputSchema: entry.inputSchema }),
        ...(entry.outputSchema === undefined ? {} : { outputSchema: entry.outputSchema }),
        availability: entry.availability,
      })),
    );

    for (const forbidden of FORBIDDEN_IDS) {
      expect(registry.lookup(forbidden), `${forbidden} must not be reachable`).toBeUndefined();
    }
    for (const prefix of FORBIDDEN_PREFIXES) {
      for (const entry of entries) {
        expect(entry.capability.id.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('marks a capability with an unresolvable schema ref as unavailable', async () => {
    // **Fail closed.** The alternative — treating the missing schema as
    // "no schema" — would give the capability *any* arguments, which
    // widens it rather than refusing it.
    const broken: ToolCapabilityDefinition = {
      apiVersion: 'factory/v1',
      kind: 'ToolCapability',
      metadata: { name: 'test.broken', version: '1.0.0' },
      spec: {
        owner: 'factory-platform',
        kind: 'read',
        transport: 'inproc',
        effect: { class: 'E0', reversible: true, external: false },
        scope: {
          required: ['repo:read'],
          resourcePattern: 'repo:{owner}/{name}',
          environment: 'orchestrator',
        },
        credentials: { provider: '', permissions: {}, ttlSeconds: 60 },
        inputSchema: { $ref: 'schemas/does-not-exist.schema.json' },
        trust: { inputTrust: 'trusted', resultTrust: 'trusted' },
        health: { check: 'never runs', timeoutMs: 1000, degraded: 'degraded' },
        observability: { redactArguments: [] },
        cost: { unit: 'call', usdMicros: 0 },
      },
    } as unknown as ToolCapabilityDefinition;

    const registry = await buildCapabilityRegistry([broken]);

    expect(registry.entries[0]?.availability).toBe('unavailable');
    expect(registry.entries[0]?.inputSchema).toBeUndefined();
    expect(registry.problems).toHaveLength(1);
    expect(registry.problems[0]?.capabilityId).toBe('test.broken');
  });

  it('refuses a schema ref that escapes the schemas directory', async () => {
    // A ref is a path into the repository's own schema set, not an
    // arbitrary path. A ref like `../../etc/passwd` must not be read.
    const escaping: ToolCapabilityDefinition = {
      apiVersion: 'factory/v1',
      kind: 'ToolCapability',
      metadata: { name: 'test.escaping', version: '1.0.0' },
      spec: {
        owner: 'factory-platform',
        kind: 'read',
        transport: 'inproc',
        effect: { class: 'E0', reversible: true, external: false },
        scope: {
          required: ['repo:read'],
          resourcePattern: 'repo:{owner}/{name}',
          environment: 'orchestrator',
        },
        credentials: { provider: '', permissions: {}, ttlSeconds: 60 },
        inputSchema: { $ref: '../../etc/passwd' },
        trust: { inputTrust: 'trusted', resultTrust: 'trusted' },
        health: { check: 'never runs', timeoutMs: 1000, degraded: 'degraded' },
        observability: { redactArguments: [] },
        cost: { unit: 'call', usdMicros: 0 },
      },
    } as unknown as ToolCapabilityDefinition;

    const registry = await buildCapabilityRegistry([escaping]);

    expect(registry.entries[0]?.availability).toBe('unavailable');
    expect(registry.problems[0]?.reason).toContain('not a path into the schemas directory');
  });

  it('gives every capability a unique id', async () => {
    const { entries } = await loadRegistry();
    const ids = entries.map((entry) => entry.capability.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
