/**
 * `api-idempotency` — the `Idempotency-Key` (T-1.14).
 *
 * ## What the pack requires
 *
 * pack `04` §3: "`Idempotency-Key` required on creating POSTs."
 *
 * ## Why this matters more than it looks
 *
 * A human clicks a button. The network is slow. The browser retries.
 * Without an idempotency key the factory records **two intents** for one
 * click — and the second one starts a second run of a workflow, which
 * spends money, opens a pull request, and can merge something.
 *
 * So the key is **required**, and a repeat returns the **recorded
 * result** rather than performing the action again.
 *
 * ## The three rules
 *
 * 1. **The key is required** on a mutating route.
 * 2. **A repeat is a replay** — the recorded result, not a second
 *    action. The action ran once.
 * 3. **The key is scoped to the caller and the route** — the same string
 *    on a different route is a **conflict**, not a replay.
 *
 * ## The replay's marker
 *
 * The replayed response carries `idempotent-replay: true`. A client
 * that cannot tell a replay from a fresh response cannot tell whether
 * its action happened once or twice.
 */

import { describe, expect, it } from 'vitest';

import {
  browserHeaders,
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.js';

/**
 * The intent body.
 */
const INTENT_BODY = {
  repo: 'owner/repo',
  source: { kind: 'github-issue', ref: 'owner/repo#123' },
};

/**
 * The headers for a mutating intent call.
 */
const intentHeaders = (
  harness: Awaited<ReturnType<typeof buildHarness>>,
  key: string,
): Record<string, string> =>
  mutatingHeaders(browserHeaders(harness), key);

describe('the idempotency key', () => {
  it('a mutating call without the key is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        cookie: `factory_session=${harness.sessionId}`,
        'x-csrf-token': harness.csrfToken,
        'content-type': 'application/json',
      },
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe('validation');
    expect(body.detail).toContain('idempotency-key');

    await harness.close();
  });

  it('a repeated key returns the recorded result and does not act twice', async () => {
    const harness = await buildHarness();
    const headers = intentHeaders(harness, 'key-repeat');

    const first = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    // The **same** result — the recorded one.
    expect(second.json()).toEqual(first.json());

    // The action ran once. Two intents for one click is the bug this
    // whole mechanism exists to prevent.
    expect(harness.intents.recorded).toHaveLength(1);

    // And the replay is marked, so a client can tell.
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();

    await harness.close();
  });

  it('a replay emits no second event', async () => {
    // The replay is not a change — the change already happened. An event
    // for it would say the factory did the thing twice.
    const harness = await buildHarness();
    const headers = intentHeaders(harness, 'key-repeat');

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });
    expect(harness.events.count).toBe(1);

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });
    expect(harness.events.count).toBe(1);

    await harness.close();
  });

  it('a key used on a different route is a conflict, not a replay', async () => {
    const harness = await buildHarness();

    await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: intentHeaders(harness, 'key-shared'),
      payload: INTENT_BODY,
    });

    // The same key, a different route. The two are different requests, so
    // the second is not a replay — and returning the first route's
    // result would be silently wrong.
    const second = await harness.app.inject({
      method: 'POST',
      url: '/v1/factory/kill-switch',
      headers: intentHeaders(harness, 'key-shared'),
      payload: { engage: true, reason: 'an incident' },
    });

    expect(second.statusCode).toBe(409);
    const body = second.json<{ code: string }>();
    expect(body.code).toBe('conflict');

    // The kill switch was **not** engaged — the conflicting call did
    // nothing.
    expect(await harness.killSwitch.isEngaged()).toBe(false);

    await harness.close();
  });

  it('the same key from a different caller is a different request', async () => {
    // A key is a *client's* name for a request. Two callers may
    // legitimately use the same string.
    const harness = await buildHarness();

    const alice = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: intentHeaders(harness, 'key-same'),
      payload: INTENT_BODY,
    });

    // `bob` is on the allow-list but has no session, so a second session
    // is minted for him.
    harness.sessions.put({
      id: 'sess-bob',
      login: 'bob',
      csrfToken: 'csrf-bob',
      expiresAt: '2999-01-01T00:00:00.000Z',
    });

    const bob = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(
        {
          cookie: 'factory_session=sess-bob',
          'x-csrf-token': 'csrf-bob',
        },
        'key-same',
      ),
      payload: INTENT_BODY,
    });

    expect(alice.statusCode).toBe(202);
    expect(bob.statusCode).toBe(202);

    // Two intents — two different callers, two different requests.
    expect(harness.intents.recorded).toHaveLength(2);
    expect(bob.headers['idempotent-replay']).toBeUndefined();

    await harness.close();
  });

  it('a failed call does not consume the key', async () => {
    // A request that failed changed nothing, so the caller may retry it
    // with the same key — once the cause is fixed.
    const harness = await buildHarness();

    // The kill switch refuses the intake.
    await harness.killSwitch.set(true, 'an incident');

    const refused = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: intentHeaders(harness, 'key-retry'),
      payload: INTENT_BODY,
    });
    expect(refused.statusCode).toBe(503);

    // The cause is fixed.
    await harness.killSwitch.set(false, 'the incident is over');

    const retried = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: intentHeaders(harness, 'key-retry'),
      payload: INTENT_BODY,
    });

    expect(retried.statusCode).toBe(202);
    expect(retried.headers['idempotent-replay']).toBeUndefined();
    expect(harness.intents.recorded).toHaveLength(1);

    await harness.close();
  });

  it('a malformed body does not consume the key', async () => {
    // The body is validated **before** the action, so a caller that fixed
    // the body can retry with the same key.
    const harness = await buildHarness();
    const headers = intentHeaders(harness, 'key-bad-body');

    const refused = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: { repo: 'owner/repo' },
    });
    expect(refused.statusCode).toBe(400);

    const retried = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });

    expect(retried.statusCode).toBe(202);
    expect(retried.headers['idempotent-replay']).toBeUndefined();
    expect(harness.intents.recorded).toHaveLength(1);

    await harness.close();
  });

  it('a CLI caller gets the same replay', async () => {
    const harness = await buildHarness();
    const headers = mutatingHeaders(cliHeaders(harness), 'key-cli');

    const first = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers,
      payload: INTENT_BODY,
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(harness.intents.recorded).toHaveLength(1);

    await harness.close();
  });

  it('a read needs no key', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    await harness.close();
  });
});
