/**
 * `api-events` — **the ticket's first proof** (T-1.14).
 *
 * ## What the ticket requires
 *
 * "every mutating call emits an event with actor + authority" — and pack
 * `04` §3 spells out what that means: "Every call emits an event with
 * `actor=human:<login>` and `authority.basis='human-access-point'`."
 *
 * blueprint `13` §3.3 lists it as the third of four things every
 * access-point call does: "is recorded in the event log with the
 * authority and the resulting state change".
 *
 * ## Why the actor and the authority are not parameters
 *
 * The obvious design is a function that takes an actor and an authority.
 * That design is wrong: it makes the *caller* responsible for getting
 * them right, and a caller that forgets produces an event with the
 * wrong actor — which is exactly the failure the audit trail exists to
 * prevent.
 *
 * So the emitter **derives** them. There is no way to pass anything
 * else. These tests prove that: the actor is always human, the id is
 * always the caller's login, and the authority is always
 * `human-access-point`.
 *
 * ## The three facts these tests pin
 *
 * 1. **Every** mutating route emits **exactly one** event.
 * 2. The event's actor is the **human** who made the call.
 * 3. A **refused** call emits **no** event — a refusal changed nothing,
 *    and an event for it would say something changed.
 */

import { describe, expect, it } from 'vitest';

import { actorFor, authorityFor } from '../../apps/api/src/events.js';
import {
  browserHeaders,
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.js';
import { ROUTES } from '../../apps/api/src/routes.js';

/**
 * The intent body.
 */
const INTENT_BODY = {
  repo: 'owner/repo',
  source: { kind: 'manual', title: 'a title', body: 'a body' },
};

/**
 * A body for the intervention route.
 */
const INTERVENTION_BODY = { reason: 'the build is burning money' };

describe('the events', () => {
  it('the actor is always a human, and its id is the login', () => {
    expect(actorFor({ login: 'alice', via: 'session' })).toEqual({
      kind: 'human',
      id: 'alice',
    });
    expect(actorFor({ login: 'bob', via: 'token' })).toEqual({
      kind: 'human',
      id: 'bob',
    });
  });

  it('the authority is always the human access point', () => {
    expect(authorityFor()).toEqual({ basis: 'human-access-point' });
  });

  it('a mutating call emits exactly one event with the actor and authority', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(202);
    expect(harness.events.count).toBe(1);

    const event = harness.events.last;
    expect(event?.eventType).toBe('intent.recorded');
    expect(event?.actor).toEqual({ kind: 'human', id: 'alice' });
    expect(event?.authority).toEqual({ basis: 'human-access-point' });

    await harness.close();
  });

  it('the event carries the request id as its correlation id', async () => {
    const harness = await buildHarness();

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: INTENT_BODY,
    });

    const event = harness.events.last;
    expect(event?.correlationId).not.toBe('');
    expect(event?.correlationId).not.toBe('unknown');

    await harness.close();
  });

  it('the event names the aggregate the call acted on', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: INTENT_BODY,
    });

    const taskId = (response.json<{ taskId: string }>()).taskId;
    const event = harness.events.last;

    expect(event?.aggregate.kind).toBe('task');
    expect(event?.aggregate.id).toBe(taskId);

    await harness.close();
  });

  it('the event is emitted before the reply leaves', async () => {
    // A caller that receives a `202` knows the change is already in the
    // log. So by the time the response is observable, the event exists.
    const harness = await buildHarness();

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: INTENT_BODY,
    });

    expect(harness.events.count).toBe(1);
    await harness.close();
  });

  it('a refused call emits no event', async () => {
    const harness = await buildHarness();

    // The kill switch is engaged, so the intake is refused.
    await harness.killSwitch.set(true, 'an incident');
    harness.events.clear();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(503);
    // A refusal changed nothing, so nothing is recorded.
    expect(harness.events.count).toBe(0);

    await harness.close();
  });

  it('a read emits no event', async () => {
    const harness = await buildHarness();

    await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: browserHeaders(harness),
    });

    expect(harness.events.count).toBe(0);
    await harness.close();
  });

  it('every mutating route emits an event', async () => {
    // The proof is **structural**: for each mutating route in the
    // inventory, a call that succeeds must leave an event behind.
    //
    // The routes that need a resource to exist get one; the routes that
    // create one do not. The bodies are the ones the schemas accept.
    const harness = await buildHarness();

    harness.approvals.put({
      id: 'appr-1',
      taskId: 'task-1',
      type: 'merge',
      artefactRef: 'artefact://diff/1',
      artefactSha256: `sha256:${'a'.repeat(64)}`,
      approvers: ['alice'],
      status: 'pending',
      requestedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      artefact: {
        kind: 'diff',
        ref: 'artefact://diff/1',
        sha256: `sha256:${'a'.repeat(64)}`,
        blocks: [],
      },
    });

    harness.reviews.put({
      taskId: 'task-1',
      risk: 'high',
      rationale: ['the diff touches the policy bundle'],
      queuedAt: '2026-01-01T00:00:00.000Z',
      spec: 'a spec',
      oracleResult: 'passed',
      gateReport: 'green',
      panelResult: 'approved',
      blastRadius: 'the policy bundle',
      diffLink: 'https://diff.invalid/1',
    });

    harness.definition.approvals.set('appr-def', {
      artefactSha256: harness.definition.activeSha256,
      approvers: ['alice'],
    });

    const bodies: Record<string, object> = {
      '/v1/intents': INTENT_BODY,
      '/v1/approvals/{id}/decision': { decision: 'grant' },
      '/v1/approvals/{id}/revoke': { reason: 'the artefact changed' },
      '/v1/reviews/{taskId}/decision': {
        decision: 'approve',
        rationale: 'the evidence holds',
      },
      '/v1/tasks/{id}/pause': INTERVENTION_BODY,
      '/v1/tasks/{id}/resume': INTERVENTION_BODY,
      '/v1/tasks/{id}/cancel': INTERVENTION_BODY,
      '/v1/tasks/{id}/escalate': INTERVENTION_BODY,
      '/v1/tasks/{id}/rerun': INTERVENTION_BODY,
      '/v1/factory/kill-switch': { engage: true, reason: 'an incident' },
      '/v1/grants/temporary': {
        taskId: 'task-1',
        capability: 'merge',
        scope: 'repo:owner/repo',
        ttlSeconds: 300,
        reason: 'the merge needs a credential',
      },
      '/v1/tasks/{id}/defect-flag': { note: 'the gate is too weak' },
      '/v1/definition/apply': { sha: 'abc123', approvalId: 'appr-def' },
    };

    const mutating = ROUTES.filter(
      (route) => route.mutating && route.auth !== 'public',
    );

    for (const route of mutating) {
      const path = route.path
        .replace('{id}', 'appr-1')
        .replace('{taskId}', 'task-1');
      const body = bodies[route.path];

      if (body === undefined) {
        throw new Error(
          `the test has no body for the mutating route ${route.method} ${route.path}`,
        );
      }

      harness.events.clear();

      const response = await harness.app.inject({
        method: route.method,
        url: path,
        headers: mutatingHeaders(browserHeaders(harness), `key-${route.path}`),
        payload: body,
      });

      expect(
        response.statusCode,
        `${route.method} ${route.path} answered ${response.statusCode}: ${response.payload}`,
      ).toBeLessThan(300);

      expect(
        harness.events.count,
        `${route.method} ${route.path} emitted no event`,
      ).toBe(1);

      const event = harness.events.last;
      expect(event?.actor).toEqual({ kind: 'human', id: 'alice' });
      expect(event?.authority).toEqual({ basis: 'human-access-point' });
    }

    await harness.close();
  });

  it('the event type is from the registered vocabulary', async () => {
    const harness = await buildHarness();

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: INTENT_BODY,
    });

    // The contracts own the vocabulary; an unregistered type would be a
    // contract violation. The import is the check.
    const { EVENT_TYPES } = await import('@factory/contracts');
    expect(EVENT_TYPES).toContain(harness.events.last?.eventType);

    await harness.close();
  });

  it('a CLI caller is the actor too', async () => {
    const harness = await buildHarness();

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(cliHeaders(harness)),
      payload: INTENT_BODY,
    });

    expect(harness.events.last?.actor).toEqual({
      kind: 'human',
      id: 'alice',
    });
    await harness.close();
  });
});
