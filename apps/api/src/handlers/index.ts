/**
 * `api/handlers/index` — the route table (T-1.14).
 *
 * ## What this file is
 *
 * The binding between the **route inventory** (`routes.ts`) and the
 * **handlers**. The inventory says what the API serves; this file says
 * which handler serves it.
 *
 * The binding is a **lookup**, not a second table. So there is no way for
 * a route to exist in the inventory without a handler, and no way for a
 * handler to be reachable without being in the inventory. A route added
 * to `routes.ts` and not bound here is a build-time failure, not a
 * runtime 404.
 *
 * ## Why the inventory is the single source
 *
 * The ticket's third proof is "a route-inventory test proves no endpoint
 * accepts free-form agent instructions". That proof walks the inventory —
 * so the inventory must be the *complete* list of routes. Deriving the
 * routes from the inventory (which `app.ts` does) makes that true by
 * construction rather than by discipline.
 *
 * ## The public routes
 *
 * Three of the routes are public: the GitHub webhook and the two health
 * checks plus `/metrics`. They carry no scope, so a CLI token cannot be
 * required for them — a health check has no credential, and a webhook
 * authenticates with its own signature rather than with a factory token.
 *
 * The webhook's handler is a **stub** here: the ticket says AP-1…AP-6
 * "per `04` §3 (**stubs for later-ticket behaviours**)", and the
 * webhook's signature verification belongs to `packages/scm-github`.
 * The stub refuses with a `validation` refusal rather than pretending to
 * accept a delivery.
 */

import type { RegisteredRoute } from '../app.js';
import type { ApiDeps } from '../ports.js';
import { handled, refused } from '../ports.js';
import { ROUTES, type RouteSpec } from '../routes.js';

import { applyDefinition, readDefinitionPlan } from './amend-factory.js';
import { decideApproval, listApprovals, readApproval, revokeApproval } from './approve.js';
import { defineIntent } from './define-intent.js';
import { createTemporaryGrant, flagDefect, INTERVENTIONS, intervene, setKillSwitch } from './intervene.js';
import {
  readAuditExplain,
  readMetricsSummary,
  readOverview,
  readRun,
  readRunArtefact,
  readTask,
  readTaskEvents,
  readTaskRuns,
  listTasks,
} from './inspect.js';
import { decideReview, listReviews, readReview } from './review.js';

/**
 * The key a handler is bound to.
 *
 * The method and the path — so the binding is exact, and the same path
 * under a different method is a different route.
 */
const keyOf = (route: RouteSpec): string => `${route.method} ${route.path}`;

/**
 * Bind a handler to a route, naming the route **by its path**.
 *
 * The path is looked up in the inventory, so a binding names the route it
 * serves. That matters more than it looks: a binding written as
 * `ROUTES[17]` silently rebinds every handler below it when a route is
 * inserted in the middle of the inventory — and the result is a route
 * that answers with another route's handler, which is exactly the kind
 * of bug the "no handler" check exists to prevent.
 *
 * @param handlers the table being built
 * @param method the route's method
 * @param path the route's path
 * @param handler the handler
 */
export const bind = (
  handlers: Map<string, RegisteredRoute['handler']>,
  method: string,
  path: string,
  handler: RegisteredRoute['handler'],
): void => {
  const route = ROUTES.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (route === undefined) {
    // The binding names a route the inventory does not have. That is a
    // typo, and it is a hard error — a handler nobody can reach is dead
    // code, and the route it was meant to serve has none.
    throw new Error(
      `the binding "${method} ${path}" names a route that is not in the inventory`,
    );
  }
  handlers.set(keyOf(route), handler);
};

/**
 * Build the handler table for one set of dependencies.
 *
 * @param deps the app's dependencies
 */
const buildHandlers = (
  deps: ApiDeps,
): ReadonlyMap<string, RegisteredRoute['handler']> => {
  const handlers = new Map<string, RegisteredRoute['handler']>();

  // ---- AP-1 · define-intent -------------------------------------------
  bind(handlers, 'POST', '/v1/intents', defineIntent(deps));

  // ---- AP-2 · approve --------------------------------------------------
  bind(handlers, 'GET', '/v1/approvals', listApprovals(deps));
  bind(handlers, 'GET', '/v1/approvals/{id}', readApproval(deps));
  bind(handlers, 'POST', '/v1/approvals/{id}/decision', decideApproval(deps));
  bind(handlers, 'POST', '/v1/approvals/{id}/revoke', revokeApproval(deps));

  // ---- AP-3 · review ---------------------------------------------------
  bind(handlers, 'GET', '/v1/reviews', listReviews(deps));
  bind(handlers, 'GET', '/v1/reviews/{taskId}', readReview(deps));
  bind(handlers, 'POST', '/v1/reviews/{taskId}/decision', decideReview(deps));

  // ---- AP-4 · inspect --------------------------------------------------
  bind(handlers, 'GET', '/v1/views/overview', readOverview(deps));
  bind(handlers, 'GET', '/v1/tasks', listTasks(deps));
  bind(handlers, 'GET', '/v1/tasks/{id}', readTask(deps));
  bind(handlers, 'GET', '/v1/tasks/{id}/events', readTaskEvents(deps));
  bind(handlers, 'GET', '/v1/tasks/{id}/runs', readTaskRuns(deps));
  bind(handlers, 'GET', '/v1/runs/{id}', readRun(deps));
  bind(handlers, 'GET', '/v1/runs/{id}/artefacts/{name}', readRunArtefact(deps));
  bind(handlers, 'GET', '/v1/metrics/summary', readMetricsSummary(deps));
  bind(handlers, 'GET', '/v1/audit/explain', readAuditExplain(deps));
  bind(handlers, 'GET', '/v1/stream', streamStub());

  // ---- AP-5 · intervene ------------------------------------------------
  bind(handlers, 'POST', '/v1/tasks/{id}/pause', intervene(deps, 'pause'));
  bind(handlers, 'POST', '/v1/tasks/{id}/resume', intervene(deps, 'resume'));
  bind(handlers, 'POST', '/v1/tasks/{id}/cancel', intervene(deps, 'cancel'));
  bind(handlers, 'POST', '/v1/tasks/{id}/escalate', intervene(deps, 'escalate'));
  bind(handlers, 'POST', '/v1/tasks/{id}/rerun', intervene(deps, 'rerun'));
  bind(handlers, 'POST', '/v1/factory/kill-switch', setKillSwitch(deps));
  bind(handlers, 'POST', '/v1/grants/temporary', createTemporaryGrant(deps));
  bind(handlers, 'POST', '/v1/tasks/{id}/defect-flag', flagDefect(deps));

  // ---- AP-6 · amend-factory --------------------------------------------
  bind(handlers, 'GET', '/v1/definition/plan', readDefinitionPlan(deps));
  bind(handlers, 'POST', '/v1/definition/apply', applyDefinition(deps));

  // ---- the operational surface -----------------------------------------
  bind(handlers, 'POST', '/webhooks/github', webhookStub());
  bind(handlers, 'GET', '/healthz', healthz());
  bind(handlers, 'GET', '/readyz', readyz(deps));
  bind(handlers, 'GET', '/metrics', metrics(deps));

  return handlers;
};

/**
 * The GitHub webhook's stub.
 *
 * The webhook's signature verification belongs to `packages/scm-github`,
 * which is not this ticket's to build. So the stub **refuses** — it does
 * not accept a delivery and pretend it verified one, and it does not
 * record an intent from an unauthenticated payload.
 *
 * A refused delivery changed nothing, so it leaves no event behind. The
 * refusal is the whole answer.
 */
const webhookStub = (): RegisteredRoute['handler'] => {
  return (): Promise<ReturnType<typeof handled>> =>
    Promise.resolve(
      refused({
        type: 'about:blank',
        title: 'Validation failed',
        status: 501,
        detail:
          'the GitHub webhook is not implemented in this build — the signature verification belongs to the SCM adapter',
        code: 'validation',
      }),
    );
};

/**
 * The SSE stream's stub.
 *
 * pack `04` §3 (AP-4): "`GET /v1/stream` — **SSE**: `task.updated`,
 * `approval.requested`, `review.queued`, `health.changed`,
 * `cost.updated`, `killswitch.changed`; `id:` = event `seq` for
 * `Last-Event-ID` resume."
 *
 * The stream's **source** is the event log, and the projections that
 * turn the log into the stream's event classes are T-1.15's ticket. So
 * the route exists and is authenticated — a stream that nobody can reach
 * would be worse than one that says so — but it refuses rather than
 * opening a connection that never carries anything.
 *
 * It refuses with `501`, not `200` with an empty body: a client that
 * connects and sees nothing cannot tell "no events yet" from "not
 * implemented", and the second must not look like the first.
 */
const streamStub = (): RegisteredRoute['handler'] => {
  return (): Promise<ReturnType<typeof handled>> =>
    Promise.resolve(
      refused({
        type: 'about:blank',
        title: 'Not implemented',
        status: 501,
        detail:
          'the event stream is not implemented in this build — its event classes come from the projections',
        code: 'validation',
      }),
    );
};

/**
 * The health check.
 *
 * It answers "is this process up", not "is the factory healthy" — the
 * factory's health is the overview's job, and that is authenticated.
 */
const healthz = (): RegisteredRoute['handler'] => {
  return (): Promise<ReturnType<typeof handled>> =>
    Promise.resolve(handled({ status: 'ok' }));
};

/**
 * The readiness check.
 *
 * It answers "can this process serve" — and the kill switch is the
 * factory's own statement that it must not. So an engaged switch makes
 * this process **not ready**: it is up, but it should not take work.
 */
const readyz = (deps: ApiDeps): RegisteredRoute['handler'] => {
  return async (): Promise<ReturnType<typeof handled>> => {
    const engaged = await deps.killSwitch.isEngaged();
    if (engaged) {
      return refused({
        type: 'about:blank',
        title: 'Kill switch engaged',
        status: 503,
        detail:
          'the kill switch is engaged — this process is up but must not take work',
        code: 'kill_switch',
      });
    }
    return handled({ status: 'ready' });
  };
};

/**
 * The Prometheus metrics endpoint.
 *
 * The metrics themselves come from the projections (T-1.15), so the
 * endpoint returns the summary the port gives. The route is public
 * because a scraper has no factory credential — and the summary carries
 * no task content.
 */
const metrics = (deps: ApiDeps): RegisteredRoute['handler'] => {
  return async (): Promise<ReturnType<typeof handled>> => {
    return handled(await deps.inspection.metricsSummary());
  };
};

/**
 * Register the routes the app serves.
 *
 * The routes come from the inventory, and each one is bound to its
 * handler. A route in the inventory with no binding is a **hard error**:
 * it would otherwise be served and answer `404` for a route the pack
 * says exists, which is the worst kind of bug — a client that believes
 * an access point exists and silently gets nothing.
 *
 * @param deps the app's dependencies
 */
export const registerRoutes = (
  deps: ApiDeps,
): readonly RegisteredRoute[] => {
  const handlers = buildHandlers(deps);

  return ROUTES.map((route) => {
    const handler = handlers.get(keyOf(route));
    if (handler === undefined) {
      throw new Error(
        `the route ${keyOf(route)} is in the inventory but has no handler`,
      );
    }
    return { ...route, handler };
  });
};

export { defineIntent };
export { decideApproval, listApprovals, readApproval, revokeApproval };
export { decideReview, listReviews, readReview };
export {
  readAuditExplain,
  readMetricsSummary,
  readOverview,
  readRun,
  readRunArtefact,
  readTask,
  readTaskEvents,
  readTaskRuns,
  listTasks,
};
export {
  createTemporaryGrant,
  flagDefect,
  INTERVENTIONS,
  intervene,
  setKillSwitch,
};
export { applyDefinition, readDefinitionPlan };
