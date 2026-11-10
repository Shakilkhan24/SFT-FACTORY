/**
 * `api-rate-limit` — the limiter and the problem documents (T-1.14).
 *
 * ## Why the API needs a limiter
 *
 * The factory's access points are the factory's **write** path. An
 * approval decision merges code; a kill-switch call stops the fleet; an
 * intent starts a workflow that spends money. So the surface that
 * decides those things must not be reachable at whatever rate a client
 * chooses.
 *
 * ## The limit is per caller, not per IP
 *
 * The CLI tokens are shared by a team, and a limit keyed on an address
 * would let one noisy machine exhaust the whole team's budget. So the key
 * is the credential when there is one, and the address otherwise — an
 * unauthenticated caller still gets a bounded number of attempts.
 *
 * ## The refusal is a policy refusal
 *
 * The pack's code set has no `rate_limited` code, and the refusal *is* a
 * policy refusal: the caller's rate does not permit the call. So the
 * code is `policy_denied` and the **status** is `429`. The
 * `Retry-After` header says when to come back.
 *
 * ## The gate comes first
 *
 blueprint `13` §3.1's first rule is that a call is authenticated with a
 * human identity — but the *cheapest* gate is the rate limit, so it runs
 * first. An unauthenticated caller therefore burns rate-limit budget
 * rather than authentication budget, and an authenticated caller who is
 * over their limit is refused before any work is done.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_STATUS_BY_CODE, PROBLEM_CODES } from '../../apps/api/src/problem.js';
import {
  browserHeaders,
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.js';

describe('the rate limit', () => {
  it('a caller over the limit is refused with a 429 and a retry-after', async () => {
    const harness = await buildHarness({ rateLimit: 2 });

    for (let index = 0; index < 2; index += 1) {
      const allowed = await harness.app.inject({
        method: 'GET',
        url: '/v1/approvals',
        headers: browserHeaders(harness),
      });
      expect(allowed.statusCode).toBe(200);
    }

    const refused = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: browserHeaders(harness),
    });

    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);

    const body = refused.json<{ code: string; status: number }>();
    expect(body.code).toBe('policy_denied');
    expect(body.status).toBe(429);

    await harness.close();
  });

  it('the remaining calls are reported on the response', async () => {
    const harness = await buildHarness({ rateLimit: 3 });

    const first = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: browserHeaders(harness),
    });

    expect(first.headers['x-ratelimit-remaining']).toBe('2');
    await harness.close();
  });

  it('the limit is per caller, not per address', async () => {
    // Two different credentials are two different budgets. A shared
    // address must not let one caller exhaust another's.
    //
    // The two callers are **two CLI tokens**, not a browser and a CLI.
    // That is deliberate: the browser has a session cookie and the CLI
    // has a bearer token, so they differ by *kind* and would get
    // different keys even if the key ignored the credential entirely.
    // Two tokens of the same kind, from the same address, are the case
    // that actually distinguishes "keyed on the credential" from
    // "keyed on the address".
    const harness = await buildHarness({ rateLimit: 1 });

    const first = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: cliHeaders(harness, harness.cliToken),
    });
    expect(first.statusCode).toBe(200);

    // The same address, a different credential.
    const second = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: cliHeaders(harness, harness.cliToken2),
    });
    expect(second.statusCode).toBe(200);

    // And the first caller is still over its own limit — the two
    // budgets really are separate.
    const third = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: cliHeaders(harness, harness.cliToken),
    });
    expect(third.statusCode).toBe(429);

    await harness.close();
  });

  it('the rate limit is checked before the authentication', async () => {
    // An unauthenticated caller still gets a bounded number of
    // attempts — the limiter keys on the address when there is no
    // credential.
    const harness = await buildHarness({ rateLimit: 1 });

    const first = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
    });
    // The authentication refusal, not the rate limit — the first call
    // is inside the budget.
    expect(first.statusCode).toBe(401);

    const second = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
    });
    // The second is over the limit, so the limiter refuses first.
    expect(second.statusCode).toBe(429);

    await harness.close();
  });

  it('the limit does not stop the health check', async () => {
    // The health check is public and unauthenticated, so it is keyed on
    // the address — but it must still answer, or an orchestrator would
    // see the process as down when it is merely busy.
    const harness = await buildHarness({ rateLimit: 1 });

    for (let index = 0; index < 3; index += 1) {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/healthz',
      });
      expect(response.statusCode).toBe(200);
    }

    await harness.close();
  });
});

describe('the problem documents', () => {
  it('the code set is exactly the pack\'s', () => {
    // pack `04` §3: the extra `code` is one of `policy_denied |
    // hash_mismatch | expired | not_approver | conflict | kill_switch |
    // validation`.
    expect([...PROBLEM_CODES].sort()).toEqual([
      'conflict',
      'expired',
      'hash_mismatch',
      'kill_switch',
      'not_approver',
      'policy_denied',
      'validation',
    ]);
  });

  it('every code has a default status', () => {
    for (const code of PROBLEM_CODES) {
      expect(DEFAULT_STATUS_BY_CODE[code]).toBeGreaterThanOrEqual(400);
      expect(DEFAULT_STATUS_BY_CODE[code]).toBeLessThan(600);
    }
  });

  it('a failure leaves as application/problem+json with a request id', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
    });

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );

    const body = response.json<{
      type: string;
      title: string;
      status: number;
      detail: string;
      code: string;
      requestId: string;
    }>();

    expect(body.type).not.toBe('');
    expect(body.title).not.toBe('');
    expect(body.status).toBe(401);
    expect(body.detail).not.toBe('');
    expect(PROBLEM_CODES).toContain(body.code);
    expect(body.requestId).not.toBe('');
    expect(body.requestId).not.toBe('unknown');

    await harness.close();
  });

  it('a malformed body leaves as a problem document too', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(browserHeaders(harness)),
      payload: { repo: 'owner/repo', source: { kind: 'nope' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json<{ code: string; requestId: string }>();
    expect(body.code).toBe('validation');
    expect(body.requestId).not.toBe('unknown');

    await harness.close();
  });

  it('the problem document carries no stack trace', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: browserHeaders(harness),
    });

    // `payload` and not `body`: the inject *chain* has a `body` method
    // that builds the request, and it shadows the response's body string.
    const raw = response.payload;
    expect(raw).not.toContain('at Object.');
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('.ts:');

    await harness.close();
  });

  it('each request carries its own request id', async () => {
    const harness = await buildHarness();

    const first = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
    });
    const second = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
    });

    const firstId = (first.json<{ requestId: string }>()).requestId;
    const secondId = (second.json<{ requestId: string }>()).requestId;

    expect(firstId).not.toBe(secondId);
    await harness.close();
  });
});
