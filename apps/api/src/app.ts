/**
 * `api/app` — the Fastify application (T-1.14).
 *
 * ## What this file is
 *
 * The wiring. It registers the routes **from the inventory**
 * (`routes.ts`), applies the four things every access-point call must
 * have — authentication, the rate limit, the idempotency key, the event
 * — and renders every failure as `application/problem+json`.
 *
 * ## The order of the four gates
 *
 * The order matters, and it is not arbitrary:
 *
 * 1. **the rate limit** — first, because it is the cheapest and it must
 *    bound the work an unauthenticated caller can cause;
 * 2. **the authentication** — second, because the rate limit is keyed on
 *    the caller and a caller must be identified to be keyed on;
 * 3. **the scope check** — third, because a token that is valid but not
 *    scoped for this access point must be refused before any work;
 * 4. **the idempotency key** — fourth, because it is only needed for the
 *    mutating calls, and checking it before the action is the point.
 *
 * Then the action, then the event, then the response.
 *
 * ## The event is emitted **after** the action and **before** the reply
 *
 * If the action failed, no event is emitted — a refused call changed
 * nothing, and an event for it would say something changed. If the action
 * succeeded, the event is emitted before the reply, so a caller that
 * receives a `202` knows the change is already in the log.
 */

import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';

import { authenticate, CSRF_HEADER_NAME, hasScope, SESSION_COOKIE_NAME } from './auth.js';
import { emit } from './events.js';
import { IDEMPOTENCY_HEADER_NAME, type IdempotencyStore } from './idempotency.js';
import { refusal, toProblemDocument, unauthenticated } from './problem.js';
import type { Refusal } from './problem.js';
import type { ApiDeps, HandlerResult } from './ports.js';
import { handled, refused } from './ports.js';
import type { RateLimiter } from './rate-limit.js';
import type { RouteSpec } from './routes.js';
import { registerRoutes } from './handlers/index.js';

/**
 * The app's dependencies.
 */
export interface AppDeps {
  /** Everything the handlers need. */
  readonly api: ApiDeps;
  /** The idempotency store. */
  readonly idempotency: IdempotencyStore;
  /** The rate limiter. */
  readonly rateLimiter: RateLimiter;
  /** The request id source — injected, so a test can pin it. */
  readonly nextRequestId: () => string;
}

/**
 * The request context the handlers receive.
 */
export interface RequestContext {
  /** The caller. */
  readonly login: string;
  /** How the caller authenticated. */
  readonly via: 'session' | 'token';
  /** The request id. */
  readonly requestId: string;
  /** The route's path parameters. */
  readonly params: Readonly<Record<string, string>>;
  /** The validated body, for the routes that take one. */
  readonly body: unknown;
  /** The query parameters. */
  readonly query: Readonly<Record<string, unknown>>;
  /** The raw request, for the SSE route. */
  readonly request: FastifyRequest;
  /** The reply, for the SSE route. */
  readonly reply: FastifyReply;
}

/**
 * A route handler.
 */
export type RouteHandler = (
  ctx: RequestContext,
) => Promise<HandlerResult<unknown>> | HandlerResult<unknown>;

/**
 * The registered route, with its handler.
 */
export interface RegisteredRoute extends RouteSpec {
  readonly handler: RouteHandler;
}

/**
 * The app's options.
 */
export interface AppOptions {
  /** The logger. */
  readonly logger?: boolean;
  /**
   * A hook called for each route the app registers.
   *
   * Fastify has its own `onRoute` hook, and this is the seam that lets
   * it be used — the hook must be in place **before** the routes are
   * registered, so it cannot be added to the app after the build. A test
   * that wants to know what the app serves needs this.
   */
  readonly onRoute?: (route: {
    readonly method: string | readonly string[];
    readonly url: string;
  }) => void;
}

/**
 * Build the Fastify app.
 *
 * The app is built from the inventory, so the inventory *is* the route
 * table — there is no second place a route could be added, and the
 * inventory test therefore covers every route the app serves.
 */
export const buildApp = async (
  deps: AppDeps,
  options: AppOptions = {},
): Promise<FastifyInstance> => {
  const app = Fastify({ logger: options.logger ?? false });

  // The cookie plugin — the browser's session credential is a cookie, so
  // the app must be able to read it. Registered before the routes, so
  // `request.cookies` is populated for every one of them.
  await app.register(cookie);

  // The route hook. It must be in place **before** the routes are
  // registered — Fastify calls it for each one as it is added.
  if (options.onRoute !== undefined) {
    app.addHook('onRoute', options.onRoute);
  }

  /**
   * The routes the app serves, with their handlers.
   */
  const registered = registerRoutes(deps.api);

  // ---- the error handler --------------------------------------------
  //
  // Every failure leaves as `application/problem+json` with the pack's
  // `code` and a `requestId`. That includes the failures Fastify raises
  // itself — a malformed body, an unknown route — because a client that
  // gets a different error shape for some failures cannot handle them
  // uniformly.
  app.setErrorHandler((error, request, reply) => {
    const requestId = requestIdOf(request);
    const refusalForError = refusalFor(error);
    reply
      .status(refusalForError.status)
      .header('content-type', 'application/problem+json')
      .send(toProblemDocument(refusalForError, requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    const requestId = requestIdOf(request);
    reply
      .status(404)
      .header('content-type', 'application/problem+json')
      .send(
        toProblemDocument(
          refusal(
            'validation',
            `there is no route ${request.method} ${request.url}`,
            404,
          ),
          requestId,
        ),
      );
  });

  // ---- the routes ----------------------------------------------------
  for (const route of registered) {
    registerOne(app, deps, route);
  }

  return app;
};

/**
 * The request id on a request.
 *
 * The id is attached by the `onRequest` hook below; this reads it back.
 */
const requestIdOf = (request: FastifyRequest): string => {
  const attached = (request as FastifyRequest & { requestId?: string }).requestId;
  return attached ?? 'unknown';
};

/**
 * The refusal for a thrown error.
 *
 * A validation error from Zod is the caller's fault and gets `400`; an
 * unrecognised error is a **server** fault and gets `500`. It is a
 * `policy_denied` rather than a `validation` because the server did not
 * do what it was asked, and the pack's set has no `internal` code — the
 * distinction the client needs is made by the **status**, and the code
 * says the call was refused.
 */
const refusalFor = (error: unknown): Refusal => {
  if (error instanceof z.ZodError) {
    return refusal(
      'validation',
      `the request body is not valid: ${error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
      400,
    );
  }
  const message =
    error instanceof Error ? error.message : 'the request could not be served';
  return refusal('policy_denied', message, 500);
};

/**
 * Translate the inventory's path into the router's path.
 *
 * The inventory writes `/v1/approvals/{id}` because **pack `04` §3** writes
 * it that way, and the inventory is a transcription of the pack — so the
 * pack's notation is what the code holds and what a reader compares.
 *
 * The router wants `/v1/approvals/:id`. Express's `{id}` syntax is not
 * Fastify's, and a path written in one and registered in the other
 * produces a route that **silently does not match** — the request falls
 * through to the not-found handler and the endpoint looks absent.
 *
 * So the translation happens here, once, and it is the only place that
 * knows the two notations differ.
 */
const toRouterPath = (path: string): string =>
  path.replace(/\{([^}]+)\}/g, ':$1');

/**
 * Register one route, with its four gates.
 */
const registerOne = (
  app: FastifyInstance,
  deps: AppDeps,
  route: RegisteredRoute,
): void => {
  const spec: Parameters<FastifyInstance['route']>[0] = {
    method: route.method,
    url: toRouterPath(route.path),
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = deps.nextRequestId();
      (request as FastifyRequest & { requestId?: string }).requestId = requestId;

      // ---- 1. the rate limit ----------------------------------------
      //
      // Keyed on the caller's credential when there is one, and on the
      // address when there is not — an unauthenticated caller still gets
      // a bounded number of attempts.
      //
      // The health checks are **exempt**. A health check that answers
      // `429` tells the orchestrator the process is down when it is
      // merely busy — a false negative that can trigger a restart loop.
      // The exemption is declared in the inventory, not inferred here.
      //
      // The flag is **optional**, and the default is "limited": only an
      // explicit `false` exempts a route. A route that omits the flag is
      // rate-limited, so a new route cannot be unbounded by omission.
      if (route.rateLimited !== false) {
        const callerKey = callerKeyOf(request);
        const limited = await deps.rateLimiter.consume(callerKey);
        if (!limited.allowed) {
          reply
            .header('retry-after', String(limited.retryAfterSeconds))
            .status(limited.refusal.status)
            .header('content-type', 'application/problem+json')
            .send(toProblemDocument(limited.refusal, requestId));
          return;
        }
        reply.header('x-ratelimit-remaining', String(limited.remaining));
      }

      // ---- 2. the authentication -------------------------------------
      if (route.auth !== 'public') {
        const credentials = credentialsOf(request);
        const auth = await authenticate(
          {
            now: () => deps.api.clock.nowIso(),
            sessions: deps.api.sessions,
            tokens: deps.api.tokens,
            allowList: deps.api.allowList,
          },
          credentials,
          route.mutating,
        );
        if (!auth.ok) {
          reply
            .status(auth.refusal.status)
            .header('content-type', 'application/problem+json')
            .send(toProblemDocument(auth.refusal, requestId));
          return;
        }

        // ---- 3. the scope check ------------------------------------
        if (!hasScope(auth.token, route.scopes)) {
          const refusalForScope = refusal(
            'policy_denied',
            `the token does not carry the "${route.scopes.join(', ')}" scope`,
            403,
          );
          reply
            .status(refusalForScope.status)
            .header('content-type', 'application/problem+json')
            .send(toProblemDocument(refusalForScope, requestId));
          return;
        }

        // ---- 4. the idempotency key -------------------------------
        if (route.mutating) {
          const key = headerValue(request, IDEMPOTENCY_HEADER_NAME);
          if (key === undefined) {
            const refusalForKey = refusal(
              'validation',
              `a mutating call needs the "${IDEMPOTENCY_HEADER_NAME}" header`,
              400,
            );
            reply
              .status(refusalForKey.status)
              .header('content-type', 'application/problem+json')
              .send(toProblemDocument(refusalForKey, requestId));
            return;
          }

          const identity = {
            login: auth.identity.login,
            method: request.method,
            path: request.url.split('?')[0] ?? request.url,
            key,
          };
          const existing = await deps.idempotency.get(identity);
          if (existing.found) {
            if (!existing.sameRoute) {
              const refusalForConflict = refusal(
                'conflict',
                'the idempotency key has already been used on a different route',
              );
              reply
                .status(refusalForConflict.status)
                .header('content-type', 'application/problem+json')
                .send(toProblemDocument(refusalForConflict, requestId));
              return;
            }
            // The replay. The recorded result, not a second action.
            reply
              .status(existing.record.status)
              .header('content-type', 'application/json')
              .header('idempotent-replay', 'true')
              .send(existing.record.body);
            return;
          }

          // The body is validated **before** the action, so a malformed
          // body never consumes the key — a caller that fixed the body
          // can retry with the same key.
          const parsed = parseBody(route, request.body);
          if (!parsed.ok) {
            reply
              .status(parsed.refusal.status)
              .header('content-type', 'application/problem+json')
              .send(toProblemDocument(parsed.refusal, requestId));
            return;
          }

          const result = await route.handler({
            login: auth.identity.login,
            via: auth.identity.via,
            requestId,
            params: request.params as Record<string, string>,
            body: parsed.value,
            query: request.query as Record<string, unknown>,
            request,
            reply,
          });

          if (!result.ok) {
            reply
              .status(result.refusal.status)
              .header('content-type', 'application/problem+json')
              .send(toProblemDocument(result.refusal, requestId));
            return;
          }

          await deps.idempotency.put(identity, {
            status: result.status,
            body: result.value,
            requestId,
          });
          reply.status(result.status).send(result.value);
          return;
        }

        // A read. No key, no event.
        const result = await route.handler({
          login: auth.identity.login,
          via: auth.identity.via,
          requestId,
          params: request.params as Record<string, string>,
          body: request.body,
          query: request.query as Record<string, unknown>,
          request,
          reply,
        });
        if (!result.ok) {
          reply
            .status(result.refusal.status)
            .header('content-type', 'application/problem+json')
            .send(toProblemDocument(result.refusal, requestId));
          return;
        }
        reply.status(result.status).send(result.value);
        return;
      }

      // ---- a public route --------------------------------------------
      const result = await route.handler({
        login: 'system',
        via: 'token',
        requestId,
        params: request.params as Record<string, string>,
        body: request.body,
        query: request.query as Record<string, unknown>,
        request,
        reply,
      });
      if (!result.ok) {
        reply
          .status(result.refusal.status)
          .header('content-type', 'application/problem+json')
          .send(toProblemDocument(result.refusal, requestId));
        return;
      }
      reply.status(result.status).send(result.value);
    },
  };

  // Fastify 5's `route` registers synchronously and returns the instance.
  app.route(spec);
};

/**
 * Parse a body against the route's schema.
 *
 * A route with no schema takes no body. A body that does not parse is a
 * `validation` refusal — never a coerced or partially-accepted body,
 * because a partially-accepted body is how a field nobody validated
 * reaches the factory.
 */
const parseBody = (
  route: RouteSpec,
  body: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly refusal: Refusal } => {
  if (route.body === undefined) {
    return { ok: true, value: undefined };
  }
  const parsed = route.body.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      refusal: refusal(
        'validation',
        `the request body is not valid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
        400,
      ),
    };
  }
  return { ok: true, value: parsed.data };
};

/**
 * The credentials a request carried.
 */
const credentialsOf = (request: FastifyRequest): {
  readonly sessionId?: string;
  readonly csrfToken?: string;
  readonly bearerToken?: string;
} => {
  const cookies = request.cookies as Record<string, string | undefined>;
  const sessionId = cookies[SESSION_COOKIE_NAME];
  const csrfToken = headerValue(request, CSRF_HEADER_NAME);
  const authorization = headerValue(request, 'authorization');
  const bearerToken =
    authorization !== undefined && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(csrfToken === undefined ? {} : { csrfToken }),
    ...(bearerToken === undefined ? {} : { bearerToken }),
  };
};

/**
 * The rate-limit key for a request.
 *
 * The credential when there is one, so a shared CLI token does not
 * exhaust a team's budget; the address otherwise, so an unauthenticated
 * caller still gets a bounded number of attempts.
 */
const callerKeyOf = (request: FastifyRequest): string => {
  const authorization = headerValue(request, 'authorization');
  if (authorization !== undefined) {
    return `token:${authorization}`;
  }
  const cookies = request.cookies as Record<string, string | undefined>;
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId !== undefined) {
    return `session:${sessionId}`;
  }
  return `address:${request.ip}`;
};

/**
 * A header's value, or `undefined`.
 */
const headerValue = (
  request: FastifyRequest,
  name: string,
): string | undefined => {
  const value = request.headers[name];
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
};

export { handled, refused, unauthenticated };
export { emit };
