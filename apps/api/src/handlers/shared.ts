/**
 * `api/handlers/shared` — the helpers every access point handler needs.
 *
 * ## What is shared and why
 *
 * Six access points, and the same four things happen at each of them:
 *
 * 1. the caller is identified;
 * 2. the domain work happens behind a **port**;
 * 3. the state change is recorded in the **event log**;
 * 4. the result is returned.
 *
 * Steps 3 and 4 are the ones that must not be got wrong per-handler, so
 * they live here once: `emitFor` derives the actor and the authority (it
 * cannot be passed anything else), appends the event, and only then hands
 * the value back.
 *
 * ## The order — action, then event, then reply
 *
 * The event is emitted **after** the action succeeds and **before** the
 * reply leaves. So a caller that receives a `202` knows the change is
 * already in the log, and a **refused** call — which changed nothing —
 * leaves no event behind. An event for a refused call would say something
 * changed when nothing did.
 *
 * ## The event's aggregate
 *
 * Each handler names the aggregate the event belongs to. The aggregate is
 * the thing the call acted *on* — the task, the approval, the review — not
 * the actor. So the event log can answer "what happened to this task"
 * without the log knowing who did it.
 */

import type { EventType } from '@factory/contracts';

import { emit } from '../events.js';
import type { ApiDeps, CallerIdentity, HandlerResult, PortResult } from '../ports.js';
import { handled, refused } from '../ports.js';
import { refusal } from '../problem.js';
import type { Refusal } from '../problem.js';

/**
 * The aggregate an access-point event belongs to.
 */
export interface AggregateRef {
  /** The aggregate's kind — `task`, `approval`, `review`, `factory`. */
  readonly kind: string;
  /** The aggregate's id. */
  readonly id: string;
}

/**
 * The event an access-point call emits.
 *
 * The aggregate is described rather than fixed, because most handlers only
 * learn the aggregate's id **after** the work succeeds — the task id comes
 * from the intake, the approval id from the approvals store. So the
 * aggregate is a function of the result, and a handler that already knows
 * the id may pass it directly.
 */
export interface EmittedEvent<T> {
  /** The event type — from the registered vocabulary. */
  readonly type: EventType;
  /**
   * The aggregate the event belongs to.
   *
   * Either a fixed reference, or a function of the work's result.
   */
  readonly aggregate:
    | AggregateRef
    | ((value: T) => AggregateRef);
  /** The payload. */
  readonly payload:
    | Readonly<Record<string, unknown>>
    | ((value: T) => Readonly<Record<string, unknown>>);
}

/**
 * Run the domain work, record the event, and return the value.
 *
 * The event is emitted **only** when the work succeeded. A refusal is a
 * value and returns as one — it is an expected outcome, not an exception
 * (AGENTS.md §4).
 *
 * ## The work returns the port's own outcome
 *
 * The work function returns the **port's** result — success *or* refusal —
 * and this function is the single place that decides what a refusal means.
 * That matters: if each handler checked its own refusal and returned early,
 * then the rule "a refused call records no event" would be re-implemented
 * six times, and a handler that forgot the check would record an event for
 * a call that changed nothing. Here there is **one** rule and **one**
 * implementation, and a handler cannot opt out of it.
 *
 * @param deps the app's dependencies
 * @param identity the caller — the actor's login
 * @param requestId the request id — the event's correlation id
 * @param event the event the success emits
 * @param work the domain work, behind a port
 * @param status the HTTP status the success answers with
 */
export const emitFor = async <T>(
  deps: ApiDeps,
  identity: CallerIdentity,
  requestId: string,
  event: EmittedEvent<T>,
  work: () => Promise<PortResult<T>>,
  status = 200,
): Promise<HandlerResult<T>> => {
  const result = await work();

  if (!result.ok) {
    // Nothing changed, so nothing is recorded. A refusal leaves no trace
    // in the event log — which is what makes the log a record of *changes*.
    return refused(result.refusal);
  }

  const aggregate =
    typeof event.aggregate === 'function'
      ? event.aggregate(result.value)
      : event.aggregate;

  const payload =
    typeof event.payload === 'function'
      ? event.payload(result.value)
      : event.payload;

  await emit(
    { sink: deps.events, now: () => deps.clock.nowIso() },
    identity,
    event.type,
    aggregate,
    payload,
    requestId,
  );

  return handled(result.value, status);
};

/**
 * The refusal for a resource that does not exist.
 *
 * A `404` with a `validation` code — the pack's code set has no `not_found`
 * code, and the closest honest one is `validation`: the identifier the
 * caller supplied does not name anything.
 */
export const notFound = (what: string): Refusal =>
  refusal('validation', `there is no ${what}`, 404);

/**
 * The refusal for a resource that exists but is in the wrong state.
 *
 * A `409` with a `conflict` code.
 */
export const conflicting = (detail: string): Refusal =>
  refusal('conflict', detail);

/**
 * The refusal for an expired thing.
 *
 * A `410` with an `expired` code — the pack's code set names it.
 */
export const expired = (detail: string): Refusal =>
  refusal('expired', detail);

/**
 * The refusal for a hash binding that does not hold.
 *
 * A `409` with a `hash_mismatch` code — the pack's code set names it, and
 * it is the code that says "the thing you approved is not the thing you
 * are applying".
 */
export const hashMismatch = (detail: string): Refusal =>
  refusal('hash_mismatch', detail);

/**
 * The refusal for a caller who is not in the approver list.
 *
 * A `403` with a `not_approver` code — the pack's code set names it.
 */
export const notApprover = (detail: string): Refusal =>
  refusal('not_approver', detail);

/**
 * The refusal for a call the kill switch refuses.
 *
 * A `503` with a `kill_switch` code — the pack's code set names it.
 */
export const killSwitch = (detail: string): Refusal =>
  refusal('kill_switch', detail);
