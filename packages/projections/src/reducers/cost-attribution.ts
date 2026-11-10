/**
 * `projections/reducers/cost-attribution` — the `cost_attribution` shell
 * (T-1.15).
 *
 * ## What a "shell" is here
 *
 * pack `03` §2 assigns `cost_attribution` to **T-4.05**; T-1.15 ships the
 * computation and the cursor, and T-4.05 ships the table.
 *
 * ## The aggregation problem, and the answer
 *
 * `cost_attribution` is a **sum**: `tokens_in`, `tokens_out`, `usd_micros`
 * over the `(day, workflow, role, model)` bucket, plus a count of
 * accepted changes.
 *
 * A sum is an **accumulation**, and an accumulation replayed twice is
 * wrong. So a reducer that added each event's cost to the row's running
 * total would break A0.6 — the rebuild would double every figure.
 *
 * There are two ways out, and this is the one the corpus's own shape
 * dictates.
 *
 * **(1) Make the accumulator idempotent by keying it.** The bucket's
 * figures become a *map* from the contributing event's id to its
 * contribution, and the row's totals are the **sum over that map**. A
 * replayed event **overwrites its own entry** rather than adding a
 * second one, so the totals are unchanged.
 *
 * **(2) Make the reducer an assignment.** The row's totals are set from
 * a figure the log already carries.
 *
 * This module takes **(1)**, because it is the only one that can work
 * from the events alone — and the events are the only thing a rebuild
 * has. The `model_calls` ledger is *not* replayable: it is a table, and
 * the log is what the projection reads.
 *
 * So `CostAttributionRow` carries the **contributions**, keyed by the
 * contributing event's id, and the totals are derived. The derived
 * totals are what T-4.05's table stores; the contributions are the
 * projection's own bookkeeping and are what makes the fold idempotent.
 *
 * The key of a contribution is the event's **id**, not its `seq`: the id
 * is stable across a rebuild, and a *different* event with the same
 * `seq` cannot exist (the log's `seq` is gapless and unique).
 */

import type { EventEnvelope } from '@factory/contracts';

import type { CostAttributionRow } from '../types.js';

/**
 * One event's contribution to a cost bucket.
 */
export interface CostContribution {
  /** The tokens in. */
  readonly tokensIn: number;
  /** The tokens out. */
  readonly tokensOut: number;
  /** The cost, in integer micro-USD. */
  readonly usdMicros: number;
  /** Whether this contribution is an accepted change. */
  readonly acceptedChange: boolean;
}

/**
 * The contributions to one bucket, keyed by the contributing event's id.
 */
export type CostContributions = Readonly<Record<string, CostContribution>>;

/**
 * The payload fields the reducer reads from a cost-bearing event.
 */
interface CostPayload {
  readonly workflow?: string;
  readonly role?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly tokens?: { readonly in?: number; readonly out?: number };
  readonly costUsdMicros?: number;
  readonly taskId?: string;
}

/**
 * Read the payload as the reducer's view of it.
 */
const payloadOf = (event: EventEnvelope): CostPayload => {
  const payload = event.payload;
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return {};
  }
  return payload as CostPayload;
};

/**
 * The day an event falls on, `YYYY-MM-DD`.
 *
 * The event's own `occurredAt` — the log's clock, not the projector's —
 * so the bucket does not depend on when the projection ran.
 */
export const dayOf = (occurredAt: string): string => {
  const parsed = Date.parse(occurredAt);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  return new Date(parsed).toISOString().slice(0, 10);
};

/**
 * The bucket key for an event.
 *
 * The four parts are the pack's columns, and the key is the four of them
 * joined — so two events with the same four parts land in the same
 * bucket, and an event missing a part lands in a bucket named after its
 * missing part rather than being silently dropped.
 */
export const costBucketKey = (event: EventEnvelope): string => {
  const payload = payloadOf(event);
  return [
    dayOf(event.occurredAt),
    payload.workflow ?? '',
    payload.role ?? '',
    payload.model ?? payload.provider ?? '',
  ].join(' ');
};

/**
 * The contributions to the bucket an event belongs to.
 *
 * @param current the contributions before the event, or `undefined`
 * @param event the event
 */
export const reduceCostAttribution = (
  current: CostContributions | undefined,
  event: EventEnvelope,
): CostContributions => {
  const contributions = current ?? {};

  // The events that carry a cost: a model request, and a change that was
  // merged (the accepted-change count).
  const isCostEvent = event.eventType === 'model.requested';
  const isAcceptedChange = event.eventType === 'change.merged';

  if (!isCostEvent && !isAcceptedChange) {
    return contributions;
  }

  const payload = payloadOf(event);
  const tokens = payload.tokens;

  const contribution: CostContribution = {
    tokensIn: typeof tokens?.in === 'number' ? tokens.in : 0,
    tokensOut: typeof tokens?.out === 'number' ? tokens.out : 0,
    usdMicros:
      typeof payload.costUsdMicros === 'number' ? payload.costUsdMicros : 0,
    acceptedChange: isAcceptedChange,
  };

  // The event's **id** is the key, so a replayed event **overwrites** its
  // own contribution rather than adding a second one. That is what makes
  // the fold idempotent, and therefore what makes the rebuild identical.
  return { ...contributions, [event.eventId]: contribution };
};

/**
 * The totals over a bucket's contributions.
 *
 * The sum is over the **map**, not over the events — so the total is a
 * function of the map, and a replayed event leaves the map unchanged.
 */
export const totalsOf = (
  contributions: CostContributions,
): {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usdMicros: number;
  readonly acceptedChangeCount: number;
} => {
  let tokensIn = 0;
  let tokensOut = 0;
  let usdMicros = 0;
  let acceptedChangeCount = 0;

  for (const contribution of Object.values(contributions)) {
    tokensIn += contribution.tokensIn;
    tokensOut += contribution.tokensOut;
    usdMicros += contribution.usdMicros;
    if (contribution.acceptedChange) {
      acceptedChangeCount += 1;
    }
  }

  return { tokensIn, tokensOut, usdMicros, acceptedChangeCount };
};

/**
 * Build the row for a bucket from its contributions.
 *
 * @param day the bucket's day
 * @param workflow the bucket's workflow
 * @param role the bucket's role
 * @param model the bucket's model
 * @param contributions the bucket's contributions
 */
export const costRowOf = (
  day: string,
  workflow: string,
  role: string,
  model: string,
  contributions: CostContributions,
): CostAttributionRow => {
  const totals = totalsOf(contributions);
  return {
    day,
    workflow,
    role,
    model,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    usdMicros: totals.usdMicros,
    acceptedChangeCount: totals.acceptedChangeCount,
  };
};
