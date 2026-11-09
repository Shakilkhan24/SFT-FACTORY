/**
 * Context contracts — pack 03 §3 (the `// ---------- context ----------`
 * block).
 *
 * ```ts
 * export interface ContextAssembler { resolve(stage: StageSpec, inputs: TaskInputs, repo: RepoScope, store: ContextStore): Result<ContextEnvelope, 'context.budget_exceeded'|'context.invalid'> } // PURE
 * export interface ContextEnvelope { envelopeId: string; items: Array<{ id: string; version: string; sha256: Sha256; trust: 'trusted'|'untrusted-content'|'derived'; bytes: number }>;
 *   resolvedContextSha256: Sha256; truncations: never[]; gaps: Array<{ expected: string; reason: string }>; budget: { bytes: number; limit: number }; rendered: string }
 * ```
 *
 * **The assembler fails, it never truncates.** `truncations: never[]` is
 * non-negotiable (checklist 02 T-1.01: "`ContextEnvelope.truncations:
 * never[]` — the assembler **fails**, never truncates"). The DDL agrees:
 * `context_envelopes.truncations jsonb NOT NULL DEFAULT '[]'` — an empty
 * list is the only legal value, and a non-empty one is a bug.
 */

import { z } from 'zod';

import { Sha256 } from './shared.js';

/** The trust level of a context item. */
export const ContextTrust = z.enum(['trusted', 'untrusted-content', 'derived']);

export type ContextTrust = z.infer<typeof ContextTrust>;

/** One pinned context item. */
export const ContextItem = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256,
    trust: ContextTrust,
    bytes: z.number().int().nonnegative(),
  })
  .strict();

export type ContextItem = z.infer<typeof ContextItem>;

/** A gap — something expected that could not be resolved. */
export const ContextGap = z
  .object({
    expected: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export type ContextGap = z.infer<typeof ContextGap>;

/**
 * The context envelope (pack 03 §3).
 *
 * `truncations: never[]` — an array that may never hold an element. In Zod,
 * `z.array(z.never())` accepts only an empty array; a non-empty one is a
 * validation error. The whole envelope is `.strict()`, so adding a
 * `truncated` field would also fail.
 */
export const ContextEnvelope = z
  .object({
    envelopeId: z.string().min(1),
    items: z.array(ContextItem),
    resolvedContextSha256: Sha256,
    /** The assembler fails rather than truncating, so this is always empty. */
    truncations: z.array(z.never()),
    gaps: z.array(ContextGap),
    budget: z
      .object({
        bytes: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
      })
      .strict(),
    rendered: z.string(),
  })
  .strict();

export type ContextEnvelope = z.infer<typeof ContextEnvelope>;

/** The stage a context is assembled for. */
export const StageSpec = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    role: z.string().min(1),
    contextScope: z
      .object({
        include: z.array(z.string().min(1)).default([]),
        exclude: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

export type StageSpec = z.infer<typeof StageSpec>;

/** The inputs of a task, used to select context. */
export const TaskInputs = z
  .object({
    taskId: z.string().min(1),
    workflow: z.string().min(1),
    stage: z.string().min(1),
    role: z.string().min(1),
    spec: z.unknown().optional(),
  })
  .strict();

export type TaskInputs = z.infer<typeof TaskInputs>;

/** The repository scope a context is assembled for. */
export const RepoScope = z
  .object({
    repo: z.string().min(1),
    defaultBranch: z.string().min(1),
    paths: z
      .object({
        src: z.array(z.string()).default([]),
        tests: z.array(z.string()).default([]),
        docs: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    contextFiles: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type RepoScope = z.infer<typeof RepoScope>;

/**
 * The context store — the source of pinned items.
 *
 * It is an interface, not a schema: the store is an implementation detail of
 * `packages/context` (T-2.01/T-2.02), but the assembler that consumes it is
 * declared here so the pure package can depend on it.
 */
export interface ContextStore {
  get(id: string, version: string): Promise<ContextItem | undefined>;
  body(id: string, version: string): Promise<string | undefined>;
}

/**
 * The context assembler (pack 03 §3) — PURE.
 *
 * The error kinds are exactly two: the budget was exceeded, or the request
 * was invalid. There is no "truncated" error, because there is no
 * truncation.
 */
export interface ContextAssembler {
  resolve(
    stage: StageSpec,
    inputs: TaskInputs,
    repo: RepoScope,
    store: ContextStore,
  ):
    | { readonly ok: true; readonly value: ContextEnvelope }
    | { readonly ok: false; readonly error: 'context.budget_exceeded' | 'context.invalid' };
}
