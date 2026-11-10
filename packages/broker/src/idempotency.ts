/**
 * The idempotency keys.
 *
 * ## Two shapes, for two kinds of call
 *
 * blueprint 11 §6.4:
 *
 * * **A tool call** is keyed by `(taskId, nodeId, attempt, toolId, argsSha256)`.
 *   The arguments' digest is part of the key, so the *same* call with
 *   *different* arguments is a different call.
 * * **An external side effect** is keyed by
 *   `(taskId, nodeId, attempt, externalOperation)`. The operation's
 *   *identity* is the key, not its arguments' hash — because an external
 *   side effect (a push, a PR, a comment) is the *same* side effect however
 *   it is spelled, and re-keying it by its arguments would let a retry
 *   with a changed body perform the effect twice.
 *
 * ## Why the attempt is in the key
 *
 * A retry after a lease expiry is a *different* attempt, and it must be
 * allowed to perform the effect again — the first attempt's lease expired
 * without a committed result, so the effect may or may not have happened.
 * Keying by attempt keeps the two attempts distinct, while keying by
 * `(task, node, attempt)` keeps a retry of the *same* attempt idempotent.
 *
 * ## The key's shape
 *
 * The key is a **string**, colon-separated, because it is stored in a
 * `text` column and compared for equality. It is not hashed: a human
 * reading the invocation row must be able to see what the call was.
 */

import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

/**
 * The digest of an argument value.
 *
 * The digest is over the **canonical** JSON form, so two argument objects
 * with the same content but different key order produce the same digest.
 */
export const argsDigest = (args: unknown): string => sha256(canonical(args));

/**
 * The canonical JSON of an arbitrary value.
 *
 * `packages/core` exports `canonicalJsonOfUnknown`, which sorts object keys
 * and drops `undefined`. It is used here so that the digest is stable
 * across argument ordering — the same arguments spelled two ways are the
 * same call.
 */
const canonical = (args: unknown): string => canonicalJsonOfUnknown(args);

/**
 * The key for a **tool call**.
 *
 * blueprint 11 §6.4: `(taskId, nodeId, attempt, toolId, argsSha256)`.
 */
export const toolIdempotencyKey = (input: {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly capabilityId: string;
  readonly argsSha256: string;
}): string =>
  [
    input.taskId,
    input.nodeId,
    String(input.attempt),
    input.capabilityId,
    input.argsSha256,
  ].join(':');

/**
 * The key for an **external side effect**.
 *
 * blueprint 11 §6.4: `(taskId, nodeId, attempt, externalOperation)`.
 *
 * The operation's identity, not its arguments' digest. Two calls that name
 * the same operation are the same side effect, however their bodies differ.
 */
export const externalIdempotencyKey = (input: {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly externalOperation: string;
}): string =>
  [input.taskId, input.nodeId, String(input.attempt), input.externalOperation].join(':');

/**
 * The key for a call, chosen by whether it names an external operation.
 *
 * A request that names an `externalOperation` is keyed by it; a request
 * that does not is keyed by its arguments' digest.
 */
export const idempotencyKeyFor = (input: {
  readonly taskId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly capabilityId: string;
  readonly argsSha256: string;
  readonly externalOperation?: string;
}): string =>
  input.externalOperation === undefined
    ? toolIdempotencyKey(input)
    : externalIdempotencyKey({
        taskId: input.taskId,
        nodeId: input.nodeId,
        attempt: input.attempt,
        externalOperation: input.externalOperation,
      });
