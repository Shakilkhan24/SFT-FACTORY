/**
 * `gateway` — the idempotency key.
 *
 * ## The shape
 *
 * blueprint 11 §6.4:
 *
 * | Model invocation | `(taskId, nodeId, attempt, promptSha256, modelVersion)` |
 *
 * pack 02 §4.7 names the same five parts: *"idempotency lookup
 * `(taskId,nodeId,attempt,promptSha256,modelVersion)`"*.
 *
 * ## Why every part is there
 *
 * * `taskId` + `nodeId` — **which** work this is.
 * * `attempt` — which **try**. A retried attempt is a different call
 *   and must not replay the first attempt's answer.
 * * `promptSha256` — **what** was asked. The same node at the same
 *   attempt with a different prompt is a different call.
 * * `modelVersion` — **who** answered. If the model version changes
 *   under a pinned run, the old answer must not be replayed against
 *   the new model.
 *
 * Dropping `modelVersion` would let a run that was pinned to one model
 * version replay an answer produced by another. Dropping `attempt`
 * would let a failed attempt's answer be served to its retry.
 *
 * ## The key is a hash, not a concatenation
 *
 * The parts are joined with a separator that cannot occur inside them,
 * and the whole thing is hashed. Hashing means the key is a fixed
 * length and carries no readable task id into the database — the
 * `model_calls.idempotency_key` column is a text column, and a key that
 * spelled out the task id would put an identifier in a row that is
 * read for reconciliation.
 */

import { sha256 } from '@factory/core';

/**
 * The separator between the key's parts.
 *
 * A colon cannot appear in a task id, a node id or a model version,
 * and the prompt hash is hex. So the separator cannot be forged by a
 * part that contains it.
 */
const SEPARATOR = ':';

/**
 * The parts of an idempotency key.
 */
export interface IdempotencyParts {
  /** The task. */
  readonly taskId: string;
  /** The node. */
  readonly nodeId: string;
  /** The attempt. */
  readonly attempt: number;
  /** The prompt's digest. */
  readonly promptSha256: string;
  /** The model version that answered. */
  readonly modelVersion: string;
}

/**
 * Build the idempotency key.
 *
 * The parts are joined and hashed. The order is fixed, so the same
 * parts always produce the same key.
 */
export const idempotencyKey = (parts: IdempotencyParts): string =>
  sha256(
    [
      parts.taskId,
      parts.nodeId,
      String(parts.attempt),
      parts.promptSha256,
      parts.modelVersion,
    ].join(SEPARATOR),
  );

/**
 * The prompt's digest.
 *
 * The digest is over the **messages and the system blocks** — what the
 * provider actually sees — not over the whole request. The request
 * carries routing hints and a budget, neither of which changes what is
 * asked; including them would make two identical questions look like
 * two different ones and defeat the replay.
 *
 * @param messages the request's messages.
 * @param system the request's system blocks.
 */
export const promptDigest = (
  messages: readonly { readonly role: string; readonly content: string }[],
  system: readonly { readonly id: string; readonly body: string }[] = [],
): string =>
  sha256(
    JSON.stringify({
      system: system.map((block) => ({ id: block.id, body: block.body })),
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  );
