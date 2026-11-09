/**
 * Shared contracts — pack 03 §3 (the `// ---------- shared ----------` block).
 *
 * ```ts
 * export type Sha256 = `sha256:${string}`;
 * export type UsdMicros = number & { __brand: 'usdMicros' };
 * export type EffectClass = 'E0'|'E1'|'E2'|'E3'|'E4';
 * export type Tier = 'R0'|'R1'|'R2'|'R3'|'R4';
 * export type Autonomy = 0|1|2|3|4;
 * export type Actor = { kind: 'human'|'agent'|'system'|'integration'; id: string };
 * export type Authority = { basis: 'human-access-point'|'policy-decision'|'approval'|'system-rule';
 *   policyDecisionId?: string; approvalId?: string; autonomyLevel?: Autonomy; violation?: boolean };
 * export type Result<T, E = FactoryError> = { ok: true; value: T } | { ok: false; error: E };
 * export type FailureClass = 'model.reasoning'|'model.capability'|'workflow.composition'|'context.insufficient'
 *   |'verification.failure'|'environment.failure'|'policy.denied'|'budget.exhausted'|'tool.unavailable'|'unknown';
 * ```
 *
 * pack 03 §1 (IDs row): "Prefixed ULIDs, generated in the app: `tsk_`, `run_`,
 * `apr_`, `chg_`, `orc_`, `gat_`, `crd_` (credential lease), `cps_`, `env_`.
 * Node ids are slugs unique within a task (`n1-implement`). Event ids are
 * UUIDv7."
 */

import { z } from 'zod';

/**
 * A SHA-256 digest in the JSON form `"sha256:<64 hex>"` (pack 03 §1).
 *
 * The prefix is part of the value: it makes the encoding self-describing when
 * a digest is read out of a log line months later.
 */
export const Sha256 = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'expected a sha256 digest of the form sha256:<64 lowercase hex>');

export type Sha256 = z.infer<typeof Sha256>;

/**
 * Money is **integer micro-USD** — never a float (pack 03 §1, Money row).
 *
 * 1 USD = 1_000_000 micro-USD. The schema rejects fractional values because
 * a fractional micro-USD is a bug that only shows up in a cost report.
 */
export const UsdMicros = z.number().int().nonnegative();

export type UsdMicros = z.infer<typeof UsdMicros>;

/**
 * Effect classes (pack 03 §7): "E0 pure read · E1 reversible write · E2
 * external write · E3 destructive · E4 production."
 */
export const EffectClass = z.enum(['E0', 'E1', 'E2', 'E3', 'E4']);

export type EffectClass = z.infer<typeof EffectClass>;

export const EFFECT_CLASSES = EffectClass.options;

/**
 * Risk tiers (pack 03 §7): "R0 trivial · R1 low · R2 moderate · R3 high ·
 * R4 critical (human-only for the factory's own R4 paths; per
 * `CriticalityMap` for target repos)."
 */
export const Tier = z.enum(['R0', 'R1', 'R2', 'R3', 'R4']);

export type Tier = z.infer<typeof Tier>;

export const TIERS = Tier.options;

/**
 * Autonomy levels (pack 03 §7): "L0 research · L1 propose · L2 execute
 * isolated (PR; human reviews code) — all v1 workflows · L3 merge after
 * approval · L4 operate production."
 */
export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;

/**
 * Autonomy levels (pack 03 §7): "L0 research · L1 propose · L2 execute
 * isolated (PR; human reviews code) — all v1 workflows · L3 merge after
 * approval · L4 operate production."
 *
 * Built from `AUTONOMY_LEVELS` so the schema and the list can never drift.
 */
export const Autonomy = z.union(
  AUTONOMY_LEVELS.map((level) => z.literal(level)) as [
    z.ZodLiteral<0>,
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    z.ZodLiteral<3>,
    z.ZodLiteral<4>,
  ],
);

export type Autonomy = z.infer<typeof Autonomy>;

/**
 * Who acted (pack 03 §3).
 *
 * The SQL side calls the same concept `actor_kind` with the value
 * `integration` where the blueprint's `09` §4.2 says `human`, `agent`,
 * `system`, `policy` (pack 03 §2 `events.actor_kind` CHECK constraint). The
 * pack's SQL column list is the normative one for the database; the pack's
 * TypeScript block is normative for the contracts. This module follows the
 * **TypeScript** block, and `packages/db` maps `policy` → `integration`
 * where the two meet. The discrepancy is recorded in `docs/evidence/G0.md`.
 */
export const ActorKind = z.enum(['human', 'agent', 'system', 'integration']);

export type ActorKind = z.infer<typeof ActorKind>;

export const Actor = z
  .object({
    kind: ActorKind,
    id: z.string().min(1),
    /** The run that produced the action — `run_01JCZ8JY...`. */
    instanceId: z.string().min(1).optional(),
    /** The model that produced the action, when the actor was a model. */
    model: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        version: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /** The harness that ran the agent, when the actor was an agent. */
    harness: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Actor = z.infer<typeof Actor>;

/**
 * Under what grant the actor acted (pack 03 §3).
 *
 * This is the audit backbone (SEC-07) and it is **required on every event**
 * (invariant I-3, blueprint `09` §4.2: "Required for every `type: agent` and
 * `type: human` event").
 */
export const AuthorityBasis = z.enum([
  'human-access-point',
  'policy-decision',
  'approval',
  'system-rule',
]);

export type AuthorityBasis = z.infer<typeof AuthorityBasis>;

export const Authority = z
  .object({
    basis: AuthorityBasis,
    policyDecisionId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    autonomyLevel: Autonomy.optional(),
    /** True when the action exceeded its grant and was flagged, not stopped. */
    violation: z.boolean().optional(),
  })
  .strict();

export type Authority = z.infer<typeof Authority>;

/**
 * The ten failure classes (pack 03 §3, §7).
 *
 * "unknown ⇒ `workflow.composition`" — an unclassified failure is itself a
 * workflow-composition defect, so it is never left unclassified.
 */
export const FailureClass = z.enum([
  'model.reasoning',
  'model.capability',
  'workflow.composition',
  'context.insufficient',
  'verification.failure',
  'environment.failure',
  'policy.denied',
  'budget.exhausted',
  'tool.unavailable',
  'unknown',
]);

export type FailureClass = z.infer<typeof FailureClass>;

export const FAILURE_CLASSES = FailureClass.options;

/**
 * The factory's error shape — the default `E` of `Result` (pack 03 §3).
 */
export const FactoryError = z
  .object({
    class: FailureClass,
    message: z.string().min(1),
    retriable: z.boolean(),
    detail: z.record(z.unknown()).optional(),
  })
  .strict();

export type FactoryError = z.infer<typeof FactoryError>;

/**
 * `Result<T,E>` — the expected-failure idiom (pack 03 §1, Errors row).
 *
 * `Result` is a TypeScript type, not a Zod schema: it is a discriminated
 * union, not a document. The schema above covers the `FactoryError` half.
 */
export type Result<T, E = FactoryError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * The scope vocabulary (pack 03 §7).
 *
 * "`repo:read`, `repo:write:path:<glob>`, `git.write.branch`,
 * `git.write.commit`, `git.write.pr`, `git.push.protected` (never < L3),
 * `shell.sandboxed`, `net.fetch`, `net.egress:<host>`,
 * `db.read|write|migrate:local`, `prod.read|write` (none registered in v1),
 * `secret.read` (never agent), `factory.write` (never agent)."
 *
 * Some scopes carry a parameter (`repo:write:path:<glob>`,
 * `net.egress:<host>`), so the vocabulary is a *grammar* rather than a fixed
 * list. The scheme is checked; the parameterised forms are checked against
 * their own patterns.
 */
export const SCOPE_PREFIXES = [
  'repo:read',
  'repo:write:path:',
  'git.write.branch',
  'git.write.commit',
  'git.write.pr',
  'git.push.protected',
  'shell.sandboxed',
  'net.fetch',
  'net.egress:',
  'db.read',
  'db.write',
  'db.migrate:local',
  'prod.read',
  'prod.write',
  'secret.read',
  'factory.write',
] as const;

/** The scopes that carry a parameter and are therefore not plain literals. */
export const PARAMETERISED_SCOPE_PREFIXES = ['repo:write:path:', 'net.egress:'] as const;

export const Scope = z.string().min(1);

export type Scope = z.infer<typeof Scope>;

/**
 * Whether a scope string is in the vocabulary.
 *
 * A parameterised scope matches when its prefix matches and the parameter is
 * non-empty.
 */
export const isKnownScope = (scope: string): boolean => {
  const parameterised = PARAMETERISED_SCOPE_PREFIXES.find((prefix) =>
    scope.startsWith(prefix),
  );
  if (parameterised !== undefined) {
    return scope.length > parameterised.length;
  }
  return (SCOPE_PREFIXES as readonly string[]).includes(scope);
};

/**
 * Stage kinds (pack 03 §7): "**Stage kinds** (14) [BP: 09 §8.1]:
 * `specify, plan, implement, verify, review, aggregate, approve, merge,
 * deploy, sweep, investigate, record, evaluate, propose` — v1 implements all
 * but `deploy`, `investigate`; `evaluate`/`propose` minimal."
 */
export const STAGE_KINDS = [
  'specify',
  'plan',
  'implement',
  'verify',
  'review',
  'aggregate',
  'approve',
  'merge',
  'deploy',
  'sweep',
  'investigate',
  'record',
  'evaluate',
  'propose',
] as const;

export const StageKind = z.enum(STAGE_KINDS);

export type StageKind = z.infer<typeof StageKind>;

/**
 * The stage kinds v1 actually implements (pack 03 §7).
 *
 * `deploy` and `investigate` are excluded: v1 registers no deploy capability
 * and the `MERGED → DEPLOYING` guard is hard-false.
 */
export const V1_STAGE_KINDS = STAGE_KINDS.filter(
  (kind) => kind !== 'deploy' && kind !== 'investigate',
);

/** Executor kinds (pack 03 §2 `runs.executor_kind` CHECK constraint). */
export const ExecutorKind = z.enum(['deterministic', 'completion', 'harness', 'human']);

export type ExecutorKind = z.infer<typeof ExecutorKind>;

/**
 * The v1 role names (pack 03 §4.3): "`triage, refinement, oracle-author,
 * planner, worker, reviewer (spec-conformance), reviewer-quality,
 * security-reviewer, sweep(D-1), ci-repair(D-2)`; Prioritiser is
 * deterministic code (queue order), Panel is code."
 */
export const ROLE_NAMES = [
  'triage',
  'refinement',
  'oracle-author',
  'planner',
  'worker',
  'reviewer',
  'reviewer-quality',
  'security-reviewer',
  'sweep',
  'ci-repair',
] as const;

export const RoleName = z.enum(ROLE_NAMES);

export type RoleName = z.infer<typeof RoleName>;

/**
 * An ISO-8601 instant, always UTC with a `Z` suffix (pack 03 §1, Time row).
 */
export const IsoInstant = z.string().datetime({ offset: true });

export type IsoInstant = z.infer<typeof IsoInstant>;

/**
 * A prefixed ULID (pack 03 §1, IDs row).
 *
 * The prefix set is fixed; node ids are slugs and are checked separately.
 */
export const ULID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a 26-char Crockford base32 ULID');

export const PrefixedUlid = z.string().regex(
  /^(tsk|run|apr|chg|orc|gat|crd|cps|env)_[0-9A-HJKMNP-TV-Z]{26}$/,
  'expected a prefixed ULID like tsk_01JCZ8K2QF7V9N4M6P8R0S2T4U',
);

export type PrefixedUlid = z.infer<typeof PrefixedUlid>;

/** A node id — a slug unique within a task (pack 03 §1: `n1-implement`). */
export const NodeId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'expected a lowercase slug like n1-implement');

export type NodeId = z.infer<typeof NodeId>;

/** An event id — a UUIDv7 (pack 03 §1, §2). */
export const EventId = z.string().uuid();

export type EventId = z.infer<typeof EventId>;

/** A git SHA — 40 lowercase hex characters. */
export const GitSha = z.string().regex(/^[0-9a-f]{40}$/, 'expected a 40-char lowercase git sha');

export type GitSha = z.infer<typeof GitSha>;
