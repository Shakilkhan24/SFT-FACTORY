/**
 * `api/events` — **every mutating call emits an event** (T-1.14).
 *
 * ## What the ticket requires
 *
 * pack `04` §3: "Every call emits an event with `actor=human:<login>` and
 * `authority.basis='human-access-point'`." And blueprint `13` §3.3 lists
 * it as the third of four things every access-point call does:
 *
 * 1. is authenticated with a human identity;
 * 2. names the authority it is exercising;
 * 3. **is recorded in the event log with the authority and the resulting
 *    state change**;
 * 4. is subject to the same policy evaluation as any other consequential
 *    action.
 *
 * ## The actor and the authority are not free parameters
 *
 * The obvious way to build this is a function that takes an actor and an
 * authority. That way is wrong, because it makes the *caller* responsible
 * for getting them right — and a caller that forgets produces an event
 * with the wrong actor, which is exactly the failure the audit trail
 * exists to prevent.
 *
 * So the emitter **derives** them: the actor is always `{kind: 'human',
 * id: login}` and the authority is always `{basis: 'human-access-point'}`.
 * There is no way to pass anything else. A call that comes from anywhere
 * other than an access point does not go through this module.
 *
 * ## The event type is from the registered vocabulary
 *
 * `packages/contracts` owns the event vocabulary, and every type an
 * access point emits is already in it — `intent.recorded`,
 * `approval.granted`, `kill.switch.engaged` and the rest. **No new event
 * type is needed**, which is why T-1.14 needs no contract change.
 */

import type { Actor, Authority, EventType, NewEvent } from '@factory/contracts';

import type { AccessPointEvent, CallerIdentity, EventSink } from './ports.js';

/**
 * The actor for an access-point call.
 *
 * Always a human. There is no other kind of actor at an access point —
 * that is the definition of one.
 */
export const actorFor = (identity: CallerIdentity): Actor => ({
  kind: 'human',
  id: identity.login,
});

/**
 * The authority for an access-point call.
 *
 * Always `human-access-point`. Blueprint `13` §3.1: "Each carries declared
 * authority. There is no other sanctioned channel."
 */
export const authorityFor = (): Authority => ({ basis: 'human-access-point' });

/**
 * The emitter.
 */
export interface EventEmitterDeps {
  /** Where the events go. */
  readonly sink: EventSink;
  /** The clock. */
  readonly now: () => string;
}

/**
 * Emit an access-point event.
 *
 * @param deps the emitter's dependencies
 * @param identity the caller — the actor's login
 * @param type the event type, from the registered vocabulary
 * @param aggregate the aggregate the event belongs to
 * @param payload the event's payload
 * @param correlationId the request id
 */
export const emit = async (
  deps: EventEmitterDeps,
  identity: CallerIdentity,
  type: EventType,
  aggregate: { readonly kind: string; readonly id: string },
  payload: Readonly<Record<string, unknown>>,
  correlationId: string,
): Promise<void> => {
  const event: NewEvent = {
    eventType: type,
    aggregate: {
      kind: aggregate.kind as NewEvent['aggregate']['kind'],
      id: aggregate.id,
      version: 0,
    },
    correlationId,
    actor: actorFor(identity),
    authority: authorityFor(),
    subject: {},
    payload,
    context: { items: [] },
    bumpsVersion: true,
  };

  await deps.sink.append(event);
};

/**
 * Build an access-point event without emitting it.
 *
 * The test seam: the oracle asserts that a mutating call produces an
 * event with the right actor and authority, and it needs to see the event
 * rather than trust the sink.
 */
export const buildEvent = (
  identity: CallerIdentity,
  type: EventType,
  aggregate: { readonly kind: string; readonly id: string },
  payload: Readonly<Record<string, unknown>>,
  correlationId: string,
): AccessPointEvent => ({
  type,
  actor: actorFor(identity),
  authority: authorityFor(),
  aggregate: {
    kind: aggregate.kind,
    id: aggregate.id,
  },
  payload,
  correlationId,
});
