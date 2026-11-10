/**
 * `api-auth` — **the ticket's authentication proofs** (T-1.14).
 *
 * ## What the ticket requires
 *
 * "browser = GitHub-OAuth session cookie + CSRF token; CLI = bearer token
 * `fac_…` (stored hashed, scoped, expiring, revocable)" (pack `04` §3),
 * and the ticket's proof: "a non-allow-listed login is rejected".
 *
 * ## The four credentials rules
 *
 * 1. **The allow-list** gates every authenticated call — a session and a
 *    token alike. It is **injected**, so no login is hard-coded (HR-10).
 * 2. **The CSRF token** is required for a *mutating* call made with a
 *    session. A read needs none — a `GET` changes nothing, so it has
 *    nothing to forge.
 * 3. **The token is stored hashed.** The store holds a digest; the caller
 *    presents a plaintext and the app hashes it before the lookup. A
 *    stolen store hands over no working token.
 * 4. **The token is scoped.** A token minted for reading cannot write,
 *    and a token minted for one access point cannot use another.
 *
 * ## The refusals are values, not throws
 *
 * A rejected login is an *expected* outcome (AGENTS.md §4), so it comes
 * back as a problem document — `application/problem+json` with the
 * pack's `code` — and never as a stack trace.
 */

import { describe, expect, it } from 'vitest';

import { hashToken, isCliToken } from '../../apps/api/src/auth.js';
import {
  browserHeaders,
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.js';

/**
 * A body the intents route accepts.
 */
const INTENT_BODY = {
  repo: 'owner/repo',
  source: { kind: 'manual', title: 'a title', body: 'a body' },
};

describe('the authentication', () => {
  it('a call with no credential is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json<{
      code: string;
      status: number;
      detail: string;
      requestId: string;
    }>();
    expect(body.code).toBe('policy_denied');
    expect(body.status).toBe(401);
    expect(body.detail).toContain('neither a session cookie nor a bearer token');
    expect(body.requestId).not.toBe('');

    await harness.close();
  });

  it('a session cookie authenticates a read', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    await harness.close();
  });

  it('a non-allow-listed login is rejected', async () => {
    // The session belongs to a login that is **not** on the allow-list.
    const harness = await buildHarness();
    harness.sessions.put({
      id: 'sess-stranger',
      login: 'mallory',
      csrfToken: 'csrf-stranger',
      expiresAt: '2999-01-01T00:00:00.000Z',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: { cookie: 'factory_session=sess-stranger' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe('policy_denied');
    expect(body.detail).toContain('allow-list');
    expect(body.detail).toContain('mallory');

    await harness.close();
  });

  it('a non-allow-listed login is rejected for a token too', async () => {
    const harness = await buildHarness();
    harness.tokens.put({
      id: 'tok-stranger',
      tokenHash: hashToken('fac_stranger'),
      login: 'mallory',
      scopes: ['approve'],
      expiresAt: '2999-01-01T00:00:00.000Z',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: cliHeaders(harness, 'fac_stranger'),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('allow-list');

    await harness.close();
  });

  it('a mutating call with a session and no CSRF token is refused', async () => {
    // The session proves *who*. The CSRF token proves *where the request
    // came from*. Without it, a third-party site could make the browser
    // issue the call.
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        cookie: `factory_session=${harness.sessionId}`,
        'idempotency-key': 'key-1',
        'content-type': 'application/json',
      },
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe('policy_denied');
    expect(body.detail).toContain('x-csrf-token');

    // Nothing was recorded — the refusal came before the action.
    expect(harness.intents.recorded).toHaveLength(0);

    await harness.close();
  });

  it('a mutating call with a session and the wrong CSRF token is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        cookie: `factory_session=${harness.sessionId}`,
        'x-csrf-token': 'csrf-not-the-sessions',
        'idempotency-key': 'key-1',
        'content-type': 'application/json',
      },
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('does not match');

    await harness.close();
  });

  it('a read with a session needs no CSRF token', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: { cookie: `factory_session=${harness.sessionId}` },
    });

    expect(response.statusCode).toBe(200);
    await harness.close();
  });

  it('a CLI token authenticates without a CSRF token', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(cliHeaders(harness)),
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(202);
    await harness.close();
  });

  it('a bearer token that is not a factory token is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: { authorization: 'Bearer not-a-factory-token' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('fac_');

    await harness.close();
  });

  it('an unknown bearer token is refused', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: { authorization: 'Bearer fac_neverminted' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('not known');

    await harness.close();
  });

  it('a revoked bearer token is refused', async () => {
    const harness = await buildHarness();
    harness.tokens.put({
      id: 'tok-revoked',
      tokenHash: hashToken('fac_revoked'),
      login: 'alice',
      scopes: ['approve'],
      expiresAt: '2999-01-01T00:00:00.000Z',
      revokedAt: '2026-01-01T00:00:00.000Z',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: cliHeaders(harness, 'fac_revoked'),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('revoked');

    await harness.close();
  });

  it('an expired bearer token is refused', async () => {
    const harness = await buildHarness();
    harness.tokens.put({
      id: 'tok-expired',
      tokenHash: hashToken('fac_expired'),
      login: 'alice',
      scopes: ['approve'],
      expiresAt: '2025-01-01T00:00:00.000Z',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: cliHeaders(harness, 'fac_expired'),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('expired');

    await harness.close();
  });

  it('the token is stored hashed — the store holds no plaintext', async () => {
    // The store is asked by hash, so a store that held the plaintext
    // could not answer. This proves the property by construction: the
    // lookup key is the hash.
    const harness = await buildHarness();

    const stored = await harness.tokens.byHash(hashToken(harness.cliToken));
    expect(stored).toBeDefined();
    expect(stored?.tokenHash).toBe(hashToken(harness.cliToken));
    expect(stored?.tokenHash).not.toBe(harness.cliToken);
    expect(harness.cliToken).toMatch(/^fac_/);

    await harness.close();
  });

  it('a token without the scope the route needs is refused', async () => {
    // A token minted for reading cannot write.
    const harness = await buildHarness({ scopes: ['inspect'] });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: mutatingHeaders(cliHeaders(harness)),
      payload: INTENT_BODY,
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe('policy_denied');
    expect(body.detail).toContain('define-intent');

    await harness.close();
  });

  it('a token for one access point cannot use another', async () => {
    const harness = await buildHarness({ scopes: ['approve'] });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/reviews',
      headers: cliHeaders(harness),
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('review');

    await harness.close();
  });

  it('a session is not scope-limited — it is the owner\'s own authority', async () => {
    const harness = await buildHarness({ scopes: ['inspect'] });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/reviews',
      headers: browserHeaders(harness),
    });

    expect(response.statusCode).toBe(200);
    await harness.close();
  });

  it('an expired session is refused', async () => {
    const harness = await buildHarness();
    harness.sessions.put({
      id: 'sess-expired',
      login: 'alice',
      csrfToken: 'csrf-expired',
      expiresAt: '2025-01-01T00:00:00.000Z',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: { cookie: 'factory_session=sess-expired' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('expired');

    await harness.close();
  });

  it('a bearer token is checked before a session cookie', async () => {
    // A session cookie sent by a CLI would be an accident, and treating it
    // as one would let a browser session borrow a CLI's authority.
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/approvals',
      headers: {
        ...browserHeaders(harness),
        authorization: 'Bearer fac_neverminted',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('not known');

    await harness.close();
  });

  it('a factory token is recognised by its prefix', () => {
    expect(isCliToken('fac_abc')).toBe(true);
    expect(isCliToken('fac_')).toBe(false);
    expect(isCliToken('abc')).toBe(false);
  });
});
