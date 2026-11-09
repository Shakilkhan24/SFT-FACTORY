/**
 * T-1.02 oracle — the parity between the pack's oracle and ours.
 *
 * checklist 02 T-1.02: "start from `reference/validate_ddl.sh` (it already
 * passes against the shipped DDL on PostgreSQL 16.15 — **extend it, never
 * weaken it**)".
 *
 * "Never weaken it" needs a mechanism, or it is only a sentiment. This test
 * is that mechanism: it reads the pack's `reference/validate_ddl.sh`, extracts
 * every check it makes, and asserts that our own DDL oracle covers each one.
 *
 * The mapping is by *effect*, not by name — the pack's script and our test
 * file describe the same guarantee in different words. The table below is the
 * mapping. Each row names the check in the pack's script and the test id in
 * `tests/invariants/ddl.test.ts` that proves it.
 *
 * If the pack's script gains a check, this test fails until the new check is
 * mapped — which is exactly the "extend, never weaken" rule made executable.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const packOraclePath = join(
  repoRoot,
  'software-factory-pack',
  'software-factory-pack',
  'reference',
  'validate_ddl.sh',
);
const ourOraclePath = join(repoRoot, 'tests', 'invariants', 'ddl.test.ts');

const packOracle = readFileSync(packOraclePath, 'utf8');
const ourOracle = readFileSync(ourOraclePath, 'utf8');

/**
 * Every check the pack's oracle makes, mapped to the test id in our oracle
 * that proves the same guarantee.
 *
 * The `pack` field is the label the pack's script prints. It is matched
 * against the script's source, so a rename in the pack breaks this test
 * rather than silently orphaning a check.
 */
const MAPPING: readonly { readonly pack: string; readonly ours: readonly string[] }[] = [
  // -- the privilege layer on `events` ------------------------------------
  { pack: 'factory_app can INSERT events', ours: ['A1.2 factory_app can INSERT events'] },
  {
    pack: 'factory_app cannot UPDATE events',
    ours: ['A1.2 factory_app cannot UPDATE events'],
  },
  {
    pack: 'factory_app cannot DELETE events',
    ours: ['A1.2 factory_app cannot DELETE events'],
  },
  {
    pack: 'factory_app cannot TRUNCATE events',
    ours: ['A1.2 factory_app cannot TRUNCATE events'],
  },

  // -- the trigger layer on `events` (defence in depth) --------------------
  {
    pack: 'owner UPDATE blocked by trigger (defence in depth)',
    ours: ['A1.3 owner UPDATE is blocked by the trigger'],
  },
  { pack: 'owner DELETE blocked by trigger', ours: ['A1.3 owner DELETE is blocked by the trigger'] },
  {
    pack: 'owner TRUNCATE blocked by trigger',
    ours: ['A1.3 owner TRUNCATE is blocked by the trigger'],
  },

  // -- the projector -------------------------------------------------------
  { pack: 'projector cannot INSERT events', ours: ['A1.4 projector cannot INSERT events'] },
  { pack: 'projector can SELECT events', ours: ['A1.4 projector can SELECT events'] },

  // -- the edge role -------------------------------------------------------
  {
    pack: 'edge can INSERT edge_outbox (bigserial grant)',
    ours: ['A1.5 edge can INSERT edge_outbox'],
  },
  {
    pack: 'edge_outbox rejects unknown kind',
    ours: ['A1.5 edge_outbox rejects an unknown kind'],
  },
  {
    pack: 'edge can SELECT task budget columns only',
    ours: ['A1.5 edge can SELECT only the task budget columns'],
  },
  { pack: 'edge cannot SELECT * FROM tasks', ours: ['A1.5 edge cannot SELECT * FROM tasks'] },
  { pack: 'edge cannot INSERT events', ours: ['A1.5 edge cannot INSERT events'] },
  { pack: 'edge cannot UPDATE gateway_tokens', ours: ['A1.5 edge cannot UPDATE gateway_tokens'] },

  // -- the definition store (A0.7) ----------------------------------------
  {
    pack: 'factory_app cannot write definition_versions (A0.7)',
    ours: ['A1.6 factory_app cannot write definition_versions'],
  },
  {
    pack: 'factory_applier can write definition_versions',
    ours: ['A1.6 factory_applier can write definition_versions'],
  },

  // -- the job queue -------------------------------------------------------
  {
    pack: 'factory_app can INSERT jobs (sequence grant)',
    ours: ['A1.7 factory_app can INSERT jobs'],
  },
  { pack: 'jobs.idempotency_key is unique', ours: ['A1.7 jobs.idempotency_key is unique'] },

  // -- partitions ----------------------------------------------------------
  { pack: 'far-future event accepted', ours: ['A1.8 a far-future event is accepted'] },
];

/**
 * The checks the pack's script makes that are not `expect_ok`/`expect_error`
 * calls — the structural checks it makes with plain shell.
 */
const STRUCTURAL_CHECKS: readonly { readonly pack: string; readonly ours: readonly string[] }[] = [
  {
    pack: 'DDL + privileges apply cleanly (ensure_event_partitions idempotent)',
    ours: ['A1.1 applies the DDL and the privilege script with no error'],
  },
  {
    pack: 'events has default + 4 monthly partitions',
    ours: ['A1.8 events has the default partition plus four monthly partitions'],
  },
  {
    pack: 'gapless strictly-unique seq under concurrency',
    ours: ['A1.9 twenty concurrent writers produce a gapless, unique seq'],
  },
  { pack: 'rollback leaves no seq gap', ours: ['A1.9 a rollback leaves no seq gap'] },
  {
    pack: 'out-of-range timestamp lands in the default partition',
    ours: ['A1.8 an out-of-range timestamp lands in the default partition'],
  },
];

/**
 * The checks this oracle **adds** beyond the pack's.
 *
 * The pack's script does not test `factory_readonly` at all, even though the
 * role is normative in pack `03` §2 ("Roles and privileges (normative)").
 * Extending the oracle is explicitly permitted — this file records what was
 * added, so the addition is visible rather than silent.
 */
const EXTENSIONS: readonly { readonly what: string; readonly ours: readonly string[] }[] = [
  {
    what: 'factory_readonly can read but not write',
    ours: [
      'A1.11 factory_readonly can read every table',
      'A1.11 factory_readonly cannot write anything',
      'A1.11 factory_readonly cannot UPDATE tasks',
    ],
  },
  {
    what: 'the DDL creates every table the pack names',
    ours: ['A1.1 creates every table the pack names'],
  },
  {
    what: 'events is partitioned by RANGE on occurred_at',
    ours: ['A1.1 creates the event log as a partitioned table'],
  },
];

describe('T-1.02 · the DDL oracle extends the pack oracle and never weakens it', () => {
  it('A1.10 every check in the pack oracle is present in the pack script', () => {
    const missing = MAPPING.filter((entry) => !packOracle.includes(entry.pack)).map(
      (entry) => entry.pack,
    );
    expect(missing).toEqual([]);
  });

  it('A1.10 every mapped check is present in our oracle', () => {
    const missing: string[] = [];
    for (const entry of [...MAPPING, ...STRUCTURAL_CHECKS]) {
      for (const ours of entry.ours) {
        if (!ourOracle.includes(ours)) {
          missing.push(`${entry.pack} -> ${ours}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('A1.10 every role check the pack script makes is mapped', () => {
    // Count the `expect_ok`/`expect_error` calls in the pack's script. Each
    // one is a guarantee; each must appear in the mapping above.
    const calls = packOracle.match(/^\s*expect_(ok|error)\s+/gm) ?? [];
    expect(calls.length).toBe(MAPPING.length);
  });

  it('A1.10 every structural check the pack script makes is mapped', () => {
    for (const entry of STRUCTURAL_CHECKS) {
      expect(packOracle.includes(entry.pack.split(' (')[0] ?? entry.pack)).toBe(true);
    }
  });

  it('A1.10 every extension is present in our oracle', () => {
    const missing: string[] = [];
    for (const entry of EXTENSIONS) {
      for (const ours of entry.ours) {
        if (!ourOracle.includes(ours)) {
          missing.push(`${entry.what} -> ${ours}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('A1.10 the extensions are genuinely additional, not duplicates', () => {
    // An extension that restates a pack check would mean the mapping is
    // padded rather than extended. Every extension must describe something
    // the pack's script does not check.
    const packChecks = new Set([...MAPPING, ...STRUCTURAL_CHECKS].map((entry) => entry.pack));
    for (const entry of EXTENSIONS) {
      expect(packChecks.has(entry.what)).toBe(false);
    }
  });

  it('A1.10 our oracle keeps every role the pack names', () => {
    for (const role of [
      'factory_owner',
      'factory_app',
      'factory_projector',
      'factory_applier',
      'factory_edge',
      'factory_readonly',
    ]) {
      expect(ourOracle).toContain(role);
    }
  });

  it('A1.10 the pack script still states the no-weakening rule', () => {
    // The pack is read-only (pack 07: the corpus is the contract). If this
    // file's bytes changed, the oracle would have been weakened at the source.
    // The header of the script states the rule; asserting on it catches a
    // tampered script even before the immutability digest is compared.
    expect(packOracle).toContain('may EXTEND this file but may not weaken or delete a check');
  });
});
