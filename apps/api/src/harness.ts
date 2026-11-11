/**
 * `api/harness` — the test harness (T-1.14).
 *
 * ## What it gives a test
 *
 * A built app, the doubles behind it, and two credentials:
 *
 * * a **browser session** — a cookie plus a CSRF token;
 * * a **CLI token** — a plaintext `fac_…` and the scopes it carries.
 *
 * The plaintext token is minted here and handed to the test; the **store**
 * only ever holds its hash. So a test that wants to present a token
 * presents the plaintext and the app hashes it — which is exactly what a
 * real CLI does, and it means the "stored hashed" property is exercised
 * rather than assumed.
 *
 * ## The request id is pinned
 *
 * `nextRequestId` is injected, so a test can assert the `requestId` in a
 * problem document and the `correlationId` in an event without reading
 * them out of the response.
 */

import { buildApp } from './app.js';
import type { AppDeps } from './app.js';
import { hashToken } from './auth.js';
import {
  InMemoryAllowList,
  InMemoryApprovalPort,
  InMemoryDefinitionPort,
  InMemoryIntentIntake,
  InMemoryInspectionPort,
  InMemoryInterventionPort,
  InMemoryKillSwitch,
  InMemoryReviewPort,
  InMemorySessionStore,
  InMemoryTokenStore,
  RecordingEventSink,
  RecordingStreamSource,
  testClock,
  testIds,
} from './fakes.js';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import type { AccessPointScope, ApiDeps } from './ports.js';
import type { FastifyInstance } from 'fastify';

/**
 * The harness.
 */
export interface Harness {
  /** The built app. */
  readonly app: FastifyInstance;
  /** The app's dependencies — the ports the handlers need. */
  readonly deps: ApiDeps;
  /** The app's own dependencies — the ports plus the app's wiring. */
  readonly appDeps: AppDeps;
  /** The event sink — every event the app appended. */
  readonly events: RecordingEventSink;
  /** The stream source — the events `GET /v1/stream` would carry. */
  readonly stream: RecordingStreamSource;
  /** The allow-list. */
  readonly allowList: InMemoryAllowList;
  /** The sessions. */
  readonly sessions: InMemorySessionStore;
  /** The tokens. */
  readonly tokens: InMemoryTokenStore;
  /** The kill switch. */
  readonly killSwitch: InMemoryKillSwitch;
  /** The intent intake. */
  readonly intents: InMemoryIntentIntake;
  /** The approvals. */
  readonly approvals: InMemoryApprovalPort;
  /** The reviews. */
  readonly reviews: InMemoryReviewPort;
  /** The inspection port. */
  readonly inspection: InMemoryInspectionPort;
  /** The intervention port. */
  readonly intervention: InMemoryInterventionPort;
  /** The definition port. */
  readonly definition: InMemoryDefinitionPort;
  /** The idempotency store. */
  readonly idempotency: InMemoryIdempotencyStore;
  /** The rate limiter. */
  readonly rateLimiter: FixedWindowRateLimiter;
  /** The browser session's cookie value. */
  readonly sessionId: string;
  /** The browser session's CSRF token. */
  readonly csrfToken: string;
  /** The CLI token's plaintext. */
  readonly cliToken: string;
  /**
   * A **second** CLI token's plaintext, for a different caller.
   *
   * The rate limit is keyed on the credential, so proving that needs two
   * credentials on one address.
   */
  readonly cliToken2: string;
  /**
   * The routes the app actually registered.
   *
   * Collected by Fastify's own `onRoute` hook — so this is what the
   * server registered, not what the inventory says it registered. A
   * route that exists in the inventory but not here would be served and
   * answer `404`.
   */
  readonly registeredRoutes: readonly { readonly method: string; readonly url: string }[];
  /**
   * Start the app on a real port and return its base URL.
   *
   * `inject` cannot serve the SSE route: the stream holds its
   * connection open for as long as the client is there, and `inject`
   * waits for the response to **complete**. So a test that needs the
   * stream's real behaviour listens for real.
   */
  readonly listen: (port?: number) => Promise<string>;
  /** Close the app. */
  readonly close: () => Promise<void>;
}

/**
 * The harness's options.
 */
export interface HarnessOptions {
  /** The logins the allow-list permits. */
  readonly allow?: readonly string[];
  /** The scopes the CLI token carries. */
  readonly scopes?: readonly AccessPointScope[];
  /** The moment the clock is frozen at. */
  readonly now?: string;
  /** The rate limit — the calls allowed per window. */
  readonly rateLimit?: number;
}

/**
 * The default allow-list.
 *
 * Two logins: one who may act and one who may not, so a test can prove
 * the allow-list is a real gate without hard-coding anyone's login
 * (HR-10).
 */
export const DEFAULT_ALLOWED = ['alice', 'bob'] as const;

/**
 * Build the harness.
 *
 * @param options the harness's options
 */
export const buildHarness = async (
  options: HarnessOptions = {},
): Promise<Harness> => {
  const now = options.now ?? '2026-01-01T00:00:00.000Z';
  const allow = options.allow ?? DEFAULT_ALLOWED;
  const scopes = options.scopes ?? [
    'define-intent',
    'approve',
    'review',
    'inspect',
    'intervene',
    'amend-factory',
  ];

  const events = new RecordingEventSink();
  const stream = new RecordingStreamSource();
  const sessions = new InMemorySessionStore();
  const tokens = new InMemoryTokenStore();
  const allowList = new InMemoryAllowList();
  const killSwitch = new InMemoryKillSwitch();
  const intents = new InMemoryIntentIntake();
  const approvals = new InMemoryApprovalPort();
  const reviews = new InMemoryReviewPort();
  const inspection = new InMemoryInspectionPort();
  const intervention = new InMemoryInterventionPort();
  const definition = new InMemoryDefinitionPort();
  const idempotency = new InMemoryIdempotencyStore();
  const rateLimiter = new FixedWindowRateLimiter(options.rateLimit ?? 1000);

  for (const login of allow) {
    allowList.allow(login);
  }

  // The browser session. Its id and its CSRF token are separate, because
  // they are separate proofs: the session proves *who*, the CSRF token
  // proves *where the request came from*.
  const sessionId = 'sess-browser';
  const csrfToken = 'csrf-browser';
  sessions.put({
    id: sessionId,
    login: 'alice',
    csrfToken,
    expiresAt: '2999-01-01T00:00:00.000Z',
  });

  // The CLI token. The plaintext exists here and in the test; the store
  // holds only its hash.
  const cliToken = 'fac_testtoken0001';
  tokens.put({
    id: 'tok-1',
    tokenHash: hashToken(cliToken),
    login: 'alice',
    scopes,
    expiresAt: '2999-01-01T00:00:00.000Z',
  });

  // A **second** CLI token, for a different caller.
  //
  // The rate limit is keyed on the *credential*, so the only way to prove
  // that is to have two credentials on one address and show that one
  // caller's budget is not the other's. Two tokens is what makes that
  // observable — a browser session and a CLI token already differ by
  // *kind*, which is a weaker proof.
  const cliToken2 = 'fac_testtoken0002';
  tokens.put({
    id: 'tok-2',
    tokenHash: hashToken(cliToken2),
    login: 'bob',
    scopes,
    expiresAt: '2999-01-01T00:00:00.000Z',
  });

  const ids = testIds('req');

  const deps: ApiDeps = {
    clock: testClock(now),
    nextId: () => ids.next(),
    events,
    stream,
    sessions,
    tokens,
    allowList,
    killSwitch,
    intents,
    approvals,
    reviews,
    inspection,
    intervention,
    definition,
  };

  const requestIds = testIds('req');
  const appDeps: AppDeps = {
    api: deps,
    idempotency,
    rateLimiter,
    nextRequestId: () => requestIds.next(),
  };
  // The registered routes, collected by Fastify's own `onRoute` hook. The
  // hook must be in place **before** the routes are registered, so it is
  // passed into the build rather than added afterwards.
  const registeredRoutes: { method: string; url: string }[] = [];
  const app = await buildApp(appDeps, {
    onRoute: (route) => {
      registeredRoutes.push({
        method: Array.isArray(route.method)
          ? route.method.join(',')
          : String(route.method),
        url: route.url,
      });
    },
  });

  return {
    app,
    deps,
    appDeps,
    events,
    stream,
    allowList,
    sessions,
    tokens,
    killSwitch,
    intents,
    approvals,
    reviews,
    inspection,
    intervention,
    definition,
    idempotency,
    rateLimiter,
    sessionId,
    csrfToken,
    cliToken,
    cliToken2,
    registeredRoutes,
    listen: async (port?: number): Promise<string> => {
      await app.listen({ port: port ?? 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('the app did not report a listening address');
      }
      return `http://127.0.0.1:${String(address.port)}`;
    },
    close: () => app.close(),
  };
};

/**
 * The headers a browser session carries.
 *
 * @param harness the harness
 */
export const browserHeaders = (
  harness: Harness,
): Record<string, string> => ({
  cookie: `factory_session=${harness.sessionId}`,
  'x-csrf-token': harness.csrfToken,
});

/**
 * The headers a CLI token carries.
 *
 * @param harness the harness
 * @param token the plaintext token — the default is the harness's own
 */
export const cliHeaders = (
  harness: Harness,
  token: string = harness.cliToken,
): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/**
 * The headers a mutating call needs beyond its credential.
 *
 * The `Idempotency-Key` is required on every mutating route, so it is
 * part of what a mutating call *is* — a test that omits it is testing
 * the refusal, and there is a separate test for that.
 */
export const mutatingHeaders = (
  credential: Record<string, string>,
  key = 'key-1',
): Record<string, string> => ({
  ...credential,
  'idempotency-key': key,
});
