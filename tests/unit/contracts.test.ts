/**
 * T-1.01 oracle — the contracts hold.
 *
 * Pack 03 §3, checklist 02 T-1.01:
 *
 * > | T-1.01 | canonical-JSON test vectors (key order, unicode, numbers;
 * > **rejects NaN/Infinity**); **every YAML example in `03` §4 parses** and a
 * > variant with an unknown field is rejected; an unregistered event type is
 * > rejected | R-G |
 *
 * And the non-negotiables:
 *
 * > * `StageOutput` has `confidence?: never` — **no confidence-gated merging
 * >   exists** (the panel must not carry a confidence field; `07` §10).
 * > * `ContextEnvelope.truncations: never[]` — the assembler **fails**, never
 * >   truncates.
 * > * `EventEnvelope` carries `actor` **and** `authority` on every event
 * >   (I-3).
 * > * Schema **versioning is mandatory**: add fields, never repurpose a
 * >   field.
 *
 * **The YAML examples are read from the pack at test time**, not copied into
 * this file. A copy could drift from the pack and keep passing. Reading the
 * pack means the test fails the moment the pack and the contracts disagree —
 * which is exactly the failure this oracle exists to catch.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import type { Authority } from '../../packages/contracts/src/index.ts';
import {
  AUTONOMY_LEVELS,
  Autonomy,
  ContextEnvelope,
  Decision,
  DEFINITION_SCHEMAS,
  EffectClass,
  EVENT_PAYLOAD_FIELDS,
  EventEnvelope,
  EventTypeSchema,
  FailureClass,
  NewEvent,
  PACK_EVENT_TYPES,
  PanelResult,
  PolicyBundle,
  Sha256,
  StageOutput,
  TaskState,
  TERMINAL,
  TASK_STATES,
  NODE_STATES,
  Tier,
  UsdMicros,
} from '../../packages/contracts/src/index.ts';
import {
  canonicalJson,
  canonicalJsonOfUnknown,
  CanonicalJsonError,
} from '../../packages/core/src/canonical-json.ts';
import {
  sha256,
  sha256Json,
  toSha256Digest,
} from '../../packages/core/src/hash.ts';
import { prefixedUlid, uuidv7 } from '../../packages/core/src/ids.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const PACK_03 = join(REPO_ROOT, 'software-factory-pack/software-factory-pack/03_CONTRACTS_AND_DATA_MODEL.md');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The pack's §4 text — the examples of record. */
const packSection4 = (): string => {
  const text = readFileSync(PACK_03, 'utf8');
  const start = text.indexOf('## 4. Definition document kinds');
  const end = text.indexOf('## 5. Event vocabulary');
  expect(start, 'pack 03 §4 heading not found').toBeGreaterThan(-1);
  expect(end, 'pack 03 §5 heading not found').toBeGreaterThan(-1);
  return text.slice(start, end);
};

/**
 * The pack's YAML examples, split into individual documents.
 *
 * A block may hold more than one document (pack 03 §4.5 has two, separated by
 * `---`), so each is split and parsed separately.
 */
const packYamlDocuments = (): { kind: string; source: string; document: unknown }[] => {
  const section = packSection4();
  const blocks = [...section.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  expect(blocks.length, 'expected 11 YAML blocks in pack 03 §4').toBe(11);

  const documents: { kind: string; source: string; document: unknown }[] = [];
  for (const block of blocks) {
    for (const part of block.split(/^---$/m)) {
      if (part.trim() === '') {
        continue;
      }
      const parsed = load(part) as { kind?: string } | null;
      expect(parsed, 'a pack YAML example did not parse').not.toBeNull();
      expect(typeof parsed?.kind, 'a pack YAML example has no `kind`').toBe('string');
      documents.push({ kind: parsed?.kind as string, source: part, document: parsed });
    }
  }
  return documents;
};

/**
 * The placeholders the pack uses for values it does not want to commit.
 *
 * `<owner>`, `orc_01H...` and friends are *documentation*, not data. Each is
 * replaced with a value of the right shape so the schema is exercised on the
 * structure rather than on the placeholder.
 */
const substitutePlaceholders = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value
      .replace(/<owner>/g, 'factory-owner')
      .replace(/<you>/g, 'example-org')
      .replace(/<name>/g, 'example-name')
      .replace(/<digest>/g, 'sha256:' + '0'.repeat(64))
      .replace(/<configured>/g, 'example-model')
      .replace(/<allowed-globs>/g, 'src/**')
      .replace(/^orc_01H\.\.\.$/, 'orc_01JCZ8K2QF7V9N4M6P8R0S2T4U')
      .replace(/^run_01H\.\.\.$/, 'run_01JCZ8JYQF7V9N4M6P8R0S2T4U')
      .replace(/^tsk_01H\.\.\.$/, 'tsk_01JCZ8K1QF7V9N4M6P8R0S2T4U');
  }
  if (Array.isArray(value)) {
    return value.map(substitutePlaceholders);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = substitutePlaceholders(member);
    }
    return out;
  }
  return value;
};

/** A deterministic entropy source — the ids must be reproducible in a test. */
const deterministicEntropy = (fill: number) => (byteLength: number): Uint8Array =>
  new Uint8Array(byteLength).fill(fill);

// ---------------------------------------------------------------------------
// 1. canonical JSON
// ---------------------------------------------------------------------------

describe('T-1.01 — canonical JSON vectors', () => {
  it('A1.1 — key order does not change the output', () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { c: { y: 2, z: 1 }, a: 2, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  it('A1.2 — array order IS significant and is preserved', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('A1.3 — unicode is emitted literally, not escaped', () => {
    expect(canonicalJson({ k: 'café' })).toBe('{"k":"café"}');
    // A surrogate pair survives intact.
    expect(canonicalJson({ k: '🚀' })).toBe('{"k":"🚀"}');
  });

  it('A1.4 — numbers are JSON numbers, with no float reformatting', () => {
    expect(canonicalJson({ n: 1 })).toBe('{"n":1}');
    expect(canonicalJson({ n: -0.5 })).toBe('{"n":-0.5}');
    expect(canonicalJson({ n: 1e21 })).toBe('{"n":1e+21}');
    // A double holds integers exactly only up to 2^53. Past that the value is
    // the nearest representable double — and the canonical form must say so
    // rather than echoing the digits the author wrote.
    const beyondSafeInteger = 2 ** 53 + 1;
    expect(canonicalJson({ n: beyondSafeInteger })).toBe(`{"n":${2 ** 53}}`);
  });

  it('A1.5 — undefined members are dropped, not emitted', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('A1.6 — REJECTS NaN', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson([Number.NaN])).toThrow(/non-finite/);
  });

  it('A1.7 — REJECTS Infinity and -Infinity', () => {
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ n: Number.NEGATIVE_INFINITY })).toThrow(CanonicalJsonError);
  });

  it('A1.8 — the unknown-value guard rejects what JSON cannot represent', () => {
    expect(() => canonicalJsonOfUnknown({ when: new Date() })).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonOfUnknown({ when: new Map() })).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonOfUnknown({ when: 1n })).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonOfUnknown({ when: Number.NaN })).toThrow(/non-finite/);
    expect(canonicalJsonOfUnknown({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('A1.9 — the error names the path of the offending value', () => {
    try {
      canonicalJson({ outer: { inner: Number.NaN } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalJsonError);
      expect((error as CanonicalJsonError).path).toBe('outer.inner');
    }
  });

  it('A1.10 — sha256 over canonical JSON is stable across key order', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(sha256Json(a)).toBe(sha256Json(b));
    expect(sha256Json(a)).toBe(sha256('{"a":2,"b":1}'));
    expect(toSha256Digest('{"a":2,"b":1}')).toBe(`sha256:${sha256('{"a":2,"b":1}')}`);
  });
});

// ---------------------------------------------------------------------------
// 2. every YAML example in pack 03 §4 parses
// ---------------------------------------------------------------------------

describe('T-1.01 — every YAML example in pack 03 §4 parses', () => {
  const documents = packYamlDocuments();

  it('A1.11 — the pack §4 examples cover all twelve definition kinds', () => {
    const kinds = documents.map((entry) => entry.kind).sort();
    expect(kinds).toEqual(
      [
        'AcceptanceOracle',
        'CapabilityGrant',
        'CriticalityMap',
        'FactoryDefinition',
        'PolicyBundle',
        'RepoOnboarding',
        'RoleSpec',
        'RoutingPolicy',
        'TaskGraph',
        'ToolCapability',
        'WorkflowDefinition',
        'WorkflowEnvironment',
      ].sort(),
    );
  });

  it.each(documents.map((entry) => [entry.kind, entry] as const))(
    'A1.12 — %s parses against its schema',
    (_kind, entry) => {
      // The schemas live in `definitions.ts`; importing the whole index here
      // would shadow `PolicyBundle` with the schema-registry entry of the
      // same name, so the registry is imported by name below.
      const schema = DEFINITION_SCHEMAS[entry.kind as keyof typeof DEFINITION_SCHEMAS];
      expect(schema, `no schema registered for kind ${entry.kind}`).toBeDefined();

      const prepared = substitutePlaceholders(entry.document);
      const parsed = schema.safeParse(prepared);
      if (!parsed.success) {
        throw new Error(
          `pack 03 §4 example for ${entry.kind} does not parse: ${JSON.stringify(
            parsed.error.issues,
            null,
            2,
          )}`,
        );
      }
      expect(parsed.success).toBe(true);
    },
  );

  it('A1.13 — REJECTS a variant with an unknown field', () => {
    for (const entry of documents) {
      const schema = DEFINITION_SCHEMAS[entry.kind as keyof typeof DEFINITION_SCHEMAS];
      const prepared = substitutePlaceholders(entry.document) as Record<string, unknown>;
      const mutated = { ...prepared, notAFieldThePackMentions: true };
      const parsed = schema.safeParse(mutated);
      expect(
        parsed.success,
        `${entry.kind} accepted an unknown field — pack 03 §1: "Unknown kinds/fields are **rejected** (\`.strict()\`)"`,
      ).toBe(false);
    }
  });

  it('A1.14 — REJECTS an unknown kind', () => {
    const parsed = DEFINITION_SCHEMAS.FactoryDefinition.safeParse({
      apiVersion: 'factory/v1',
      kind: 'NotAKind',
      metadata: { name: 'x' },
      spec: { owner: { githubLogin: 'owner' } },
    });
    expect(parsed.success).toBe(false);
  });

  it('A1.15 — REJECTS a document with the wrong apiVersion', () => {
    const documents2 = packYamlDocuments();
    const entry = documents2.find((candidate) => candidate.kind === 'FactoryDefinition');
    expect(entry).toBeDefined();
    const prepared = substitutePlaceholders(entry?.document) as Record<string, unknown>;
    const parsed = DEFINITION_SCHEMAS.FactoryDefinition.safeParse({
      ...prepared,
      apiVersion: 'factory/v2',
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. the event vocabulary is closed
// ---------------------------------------------------------------------------

describe('T-1.01 — the event vocabulary is closed', () => {
  it('A1.16 — REJECTS an unregistered event type', () => {
    const parsed = EventTypeSchema.safeParse('task.made');
    expect(parsed.success).toBe(false);

    const parsed2 = EventTypeSchema.safeParse('stage.completed');
    expect(parsed2.success).toBe(true);
  });

  it('A1.17 — REJECTS an event envelope carrying an unregistered event type', () => {
    const envelope = validEnvelope({ eventType: 'task.made' });
    const parsed = EventEnvelope.safeParse(envelope);
    expect(parsed.success).toBe(false);
  });

  it('A1.18 — every registered event type has a payload-field entry', () => {
    for (const eventType of EventTypeSchema.options) {
      expect(
        EVENT_PAYLOAD_FIELDS[eventType],
        `event type ${eventType} has no entry in EVENT_PAYLOAD_FIELDS`,
      ).toBeDefined();
    }
  });

  it('A1.19 — every pack addition is documented in packages/contracts/events.md', () => {
    const readme = readFileSync(join(REPO_ROOT, 'packages/contracts/events.md'), 'utf8');
    for (const eventType of PACK_EVENT_TYPES) {
      expect(
        readme.includes(eventType),
        `pack addition ${eventType} is not listed in packages/contracts/events.md — pack 03 §5: "each addition must be listed in \`packages/contracts/events.md\`"`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. the non-negotiable shapes
// ---------------------------------------------------------------------------

describe('T-1.01 — the non-negotiable shapes', () => {
  it('A1.20 — StageOutput REJECTS a confidence field', () => {
    const base = { status: 'success', artefacts: [] };
    expect(StageOutput.safeParse(base).success).toBe(true);

    const withConfidence = StageOutput.safeParse({ ...base, confidence: 0.87 });
    expect(withConfidence.success, 'StageOutput accepted a confidence field').toBe(false);

    const withNullConfidence = StageOutput.safeParse({ ...base, confidence: null });
    expect(withNullConfidence.success, 'StageOutput accepted `confidence: null`').toBe(false);
  });

  it('A1.21 — PanelResult REJECTS a confidence field', () => {
    const parsed = PanelResult.safeParse({
      outcome: 'approve',
      reasons: [],
      blockingReviewers: [],
      confidence: 0.9,
    });
    expect(parsed.success, 'the panel carried a confidence field — 07 §10').toBe(false);
  });

  it('A1.22 — ContextEnvelope REJECTS a non-empty truncations array', () => {
    const base = {
      envelopeId: 'ctx_01JCZ8JNQF7V9N4M6P8R0S2T4U',
      items: [],
      resolvedContextSha256: `sha256:${'0'.repeat(64)}`,
      truncations: [],
      gaps: [],
      budget: { bytes: 0, limit: 1000 },
      rendered: '',
    };
    expect(ContextEnvelope.safeParse(base).success).toBe(true);

    const truncated = ContextEnvelope.safeParse({
      ...base,
      truncations: [{ what: 'the tail of the diff' }],
    });
    expect(
      truncated.success,
      'the assembler truncated instead of failing — pack 03 §3: `truncations: never[]`',
    ).toBe(false);
  });

  it('A1.23 — EventEnvelope REQUIRES both actor and authority (I-3)', () => {
    const envelope = validEnvelope();

    const withoutActor = { ...envelope } as Record<string, unknown>;
    delete withoutActor['actor'];
    expect(EventEnvelope.safeParse(withoutActor).success, 'an event without an actor parsed').toBe(
      false,
    );

    const withoutAuthority = { ...envelope } as Record<string, unknown>;
    delete withoutAuthority['authority'];
    expect(
      EventEnvelope.safeParse(withoutAuthority).success,
      'an event without an authority parsed — I-3 requires both',
    ).toBe(false);
  });

  it('A1.24 — an agent event without an authority basis is rejected', () => {
    const envelope = validEnvelope({
      actor: { kind: 'agent', id: 'role.worker' },
      authority: {} as unknown as Authority,
    });
    expect(EventEnvelope.safeParse(envelope).success).toBe(false);
  });

  it('A1.25 — a NewEvent cannot carry the fields the log owns', () => {
    const parsed = NewEvent.safeParse({
      eventType: 'stage.completed',
      aggregate: { kind: 'task', id: 'tsk_1', version: 1 },
      correlationId: 'tsk_1',
      actor: { kind: 'system', id: 'orchestrator' },
      authority: { basis: 'system-rule' },
      subject: {},
      payload: {},
      context: { items: [] },
      seq: 5,
      hash: `sha256:${'0'.repeat(64)}`,
    });
    expect(parsed.success, 'a NewEvent carried a `seq` the log owns').toBe(false);
  });

  it('A1.26 — the failure class set has exactly the pack\'s ten members', () => {
    expect(FailureClass.options).toHaveLength(10);
    expect(FailureClass.options).toContain('workflow.composition');
    expect(FailureClass.options).toContain('model.reasoning');
  });

  it('A1.27 — the effect class set is E0–E4 and the tier set is R0–R4', () => {
    expect(EffectClass.options).toEqual(['E0', 'E1', 'E2', 'E3', 'E4']);
    expect(Tier.options).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
    expect(AUTONOMY_LEVELS).toEqual([0, 1, 2, 3, 4]);
    expect(Autonomy.safeParse(2).success).toBe(true);
    expect(Autonomy.safeParse(5).success).toBe(false);
  });

  it('A1.28 — a policy bundle whose default is not `deny` is rejected', () => {
    const bundle = PolicyBundle.safeParse({
      apiVersion: 'factory/v1',
      kind: 'PolicyBundle',
      spec: { default: 'allow' },
    });
    expect(bundle.success, 'a policy bundle could default to allow').toBe(false);
  });

  it('A1.29 — a decision always carries a bundle digest', () => {
    const parsed = Decision.safeParse({
      outcome: 'DENY',
      ruleIds: ['deny-factory-write'],
      reason: 'deny_rule',
    });
    expect(parsed.success, 'a decision had no bundleSha256').toBe(false);
  });

  it('A1.30 — usd micros must be an integer', () => {
    expect(UsdMicros.safeParse(1.5).success).toBe(false);
    expect(UsdMicros.safeParse(1500000).success).toBe(true);
  });

  it('A1.31 — a sha256 digest must carry the prefix', () => {
    expect(Sha256.safeParse('0'.repeat(64)).success).toBe(false);
    expect(Sha256.safeParse(`sha256:${'0'.repeat(64)}`).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. the state tables
// ---------------------------------------------------------------------------

describe('T-1.01 — the state tables', () => {
  it('A1.32 — there are 19 task states and 8 node states', () => {
    expect(TASK_STATES).toHaveLength(19);
    expect(NODE_STATES).toHaveLength(8);
  });

  it('A1.33 — ESCALATED is not terminal', () => {
    expect(TERMINAL).not.toContain('ESCALATED');
    expect(TERMINAL).toContain('MERGED');
    expect(TERMINAL).toContain('INCOMPLETE');
  });

  it('A1.34 — the task states are the pack\'s 19, in order', () => {
    expect(TASK_STATES).toEqual([
      'DRAFT',
      'TRIAGED',
      'REFINED',
      'PLANNED',
      'QUEUED',
      'RUNNING',
      'VERIFYING',
      'AWAITING_REVIEW',
      'AWAITING_APPROVAL',
      'APPROVED',
      'MERGING',
      'MERGED',
      'DEPLOYING',
      'DEPLOYED',
      'REJECTED',
      'FAILED',
      'ABANDONED',
      'INCOMPLETE',
      'ESCALATED',
    ]);
  });

  it('A1.35 — a task state outside the set is rejected', () => {
    expect(TaskState.safeParse('MERGING_AGAIN').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. ids
// ---------------------------------------------------------------------------

describe('T-1.01 — ids', () => {
  it('A1.36 — a prefixed ULID has the pack\'s prefix and 26 Crockford characters', () => {
    const id = prefixedUlid('tsk', 1_700_000_000_000, deterministicEntropy(0x2a));
    expect(id).toMatch(/^tsk_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('A1.37 — a UUIDv7 has the version and variant nibbles', () => {
    const id = uuidv7(1_700_000_000_000, deterministicEntropy(0x00));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('A1.38 — a UUIDv7 sorts by time', () => {
    const earlier = uuidv7(1_700_000_000_000, deterministicEntropy(0x00));
    const later = uuidv7(1_700_000_001_000, deterministicEntropy(0x00));
    expect(earlier < later).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// helpers used by the envelope tests
// ---------------------------------------------------------------------------

const validEnvelope = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventId: '0192b4c8-0000-7000-8000-000000000001',
  seq: 1,
  occurredAt: '2026-11-05T09:14:22.417Z',
  eventType: 'stage.completed',
  schemaVersion: 1,
  aggregate: { kind: 'task', id: 'tsk_01JCZ8K1QF7V9N4M6P8R0S2T4U', version: 1 },
  correlationId: 'tsk_01JCZ8K1QF7V9N4M6P8R0S2T4U',
  actor: { kind: 'agent', id: 'role.worker' },
  authority: { basis: 'policy-decision', autonomyLevel: 2 },
  subject: {},
  payload: {},
  context: { items: [] },
  redaction: { applied: [] },
  hash: `sha256:${'0'.repeat(64)}`,
  ...overrides,
});
