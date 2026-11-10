/**
 * `projections/reducers/approval-queue` — the `approval_queue` shell
 * (T-1.15).
 *
 * ## What a "shell" is here
 *
 * The ticket says "shells for `approval_queue` and `cost_attribution`", and
 * pack `03` §2 assigns those tables to **T-2.09** and **T-4.05**. So
 * T-1.15 owns the *computation* and the *cursor*; the later tickets own
 * the DDL.
 *
 * That is the honest split, and it is not a placeholder: the reducer
 * here is the real reduction, and when T-2.09 writes the table the
 * projector's output lands in it unchanged. The shell is complete in the
 * sense that matters — it computes the right rows.
 *
 * ## Why `approval_queue` is *not* a fold over "requested minus granted"
 *
 * The obvious implementation keeps a set of requested approvals and
 * removes the granted ones. That is an **accumulation**, and an
 * accumulation replayed twice is wrong — which would break A0.6 exactly
 * where it matters.
 *
 * So the reducer works the other way: the row is created by
 * `approval.requested` and **removed** by the event that answers it.
 * A replay of the same log produces the same set, because the removal is
 * driven by the event, not by a counter.
 *
 * The projector expresses a removal as a *tombstone* — the row is
 * deleted — so the store's write is still an idempotent assignment.
 */

import type { EventEnvelope } from '@factory/contracts';

import type { ApprovalQueueRow } from '../types.js';

/**
 * The payload fields the reducer reads from an approval event.
 */
interface ApprovalPayload {
  readonly approvalId?: string;
  readonly type?: string;
  readonly expiresAt?: string;
  readonly taskId?: string;
}

/**
 * Read the payload as the reducer's view of it.
 */
const payloadOf = (event: EventEnvelope): ApprovalPayload => {
  const payload = event.payload;
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return {};
  }
  return payload as ApprovalPayload;
};

/**
 * The events that **answer** an approval — the row leaves the queue.
 *
 * `approval.granted` is the pack's vocabulary; `approval.refused` is
 * **not** in the registered vocabulary (pack `03` §5 lists `requested`,
 * `granted`, `expired`, `revoked`), so a refusal is recorded by
 * `approval.revoked` with a reason. The list therefore names only
 * registered types.
 */
const ANSWERED: readonly string[] = [
  'approval.granted',
  'approval.expired',
  'approval.revoked',
];

/**
 * The result of reducing one event into the queue.
 *
 * `undefined` means "no row" — either the event did not concern the
 * queue, or it **removed** the row.
 */
export type ApprovalQueueEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'upsert'; readonly row: ApprovalQueueRow }
  | { readonly kind: 'remove'; readonly approvalId: string };

/**
 * The urgency of an approval.
 *
 * The queue's `urgency` is a plain string in the pack's column list, so
 * this is a **classification**, not a number: it says how soon the
 * approval must be answered, relative to its own expiry.
 *
 * The classification is derived from the expiry rather than stored, so
 * the same log always produces the same urgency — a rebuild at a
 * different wall-clock time must not reclassify the queue.
 */
export const urgencyOf = (requestedAt: string, expiresAt: string): string => {
  const requested = Date.parse(requestedAt);
  const expires = Date.parse(expiresAt);

  // An unparseable date cannot be classified, so it is reported as
  // unknown rather than guessed into a bucket.
  if (!Number.isFinite(requested) || !Number.isFinite(expires)) {
    return 'unknown';
  }

  const windowMs = expires - requested;
  if (windowMs <= 0) {
    return 'expired';
  }
  if (windowMs <= 15 * 60 * 1000) {
    return 'critical';
  }
  if (windowMs <= 60 * 60 * 1000) {
    return 'high';
  }
  if (windowMs <= 24 * 60 * 60 * 1000) {
    return 'normal';
  }
  return 'low';
};

/**
 * Reduce one event into the `approval_queue`.
 *
 * @param current the row before the event, or `undefined`
 * @param event the event
 */
export const reduceApprovalQueue = (
  current: ApprovalQueueRow | undefined,
  event: EventEnvelope,
): ApprovalQueueEffect => {
  const payload = payloadOf(event);

  if (event.eventType === 'approval.requested') {
    const approvalId = payload.approvalId ?? '';
    if (approvalId === '') {
      // An approval with no id cannot be queued — the queue's key is the
      // approval id, and a row with an empty key cannot be upserted
      // without colliding with every other such row.
      return { kind: 'none' };
    }

    const requestedAt = event.occurredAt;
    const expiresAt = payload.expiresAt ?? '';
    const taskId = payload.taskId ?? current?.taskId ?? '';

    return {
      kind: 'upsert',
      row: {
        approvalId,
        taskId,
        type: payload.type ?? current?.type ?? '',
        requestedAt: current?.requestedAt ?? requestedAt,
        expiresAt,
        urgency: urgencyOf(current?.requestedAt ?? requestedAt, expiresAt),
      },
    };
  }

  if (ANSWERED.includes(event.eventType)) {
    const approvalId = payload.approvalId ?? current?.approvalId ?? '';
    if (approvalId === '') {
      return { kind: 'none' };
    }
    return { kind: 'remove', approvalId };
  }

  return { kind: 'none' };
};
