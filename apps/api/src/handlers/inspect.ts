/**
 * `api/handlers/inspect` — **AP-4** (T-1.14).
 *
 * ## What the access point is
 *
 * blueprint `13` §3.1: AP-4 `inspect` — "a human sees what the factory
 * is doing, what it needs, what it spent." Its "Cannot" column: it
 * cannot change anything.
 *
 * So **every** handler here is a read. None of them emits an event,
 * because none of them changes anything — and the app only emits an
 * event for a mutating route.
 *
 * ## The answers come from the projections
 *
 * The overview, the task list, the metrics summary — those are
 * **projections**, and the projections are T-1.15's ticket. So they
 * arrive through the `InspectionPort`, and this file only does the
 * HTTP-shaped work: the filters, the pagination and the artefact's
 * expiry.
 *
 * ## The pagination
 *
 * pack `04` §3: "`?cursor=&limit=`". The cursor is opaque to the caller —
 * it is the projection's business how it encodes one — and the limit is
 * bounded here so a caller cannot ask for the whole table.
 *
 * ## The artefact URL expires
 *
 * `GET /v1/runs/{id}/artefacts/{name}` returns a URL and the moment it
 * stops working. A signed URL without an expiry is a permanent
 * credential, and an artefact can be a diff that has not been approved.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import { handled, refused } from '../ports.js';
import { notFound } from './shared.js';

/**
 * The largest page a caller may ask for.
 */
export const MAX_PAGE_LIMIT = 200;

/**
 * The default page size.
 */
export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Read the `limit` query parameter, bounded.
 *
 * An absent, unparseable or out-of-range limit falls back to the
 * default — the caller gets a page rather than an error, because a
 * pagination parameter is a hint, not a contract.
 */
export const readLimit = (raw: unknown): number => {
  if (typeof raw !== 'string') {
    return DEFAULT_PAGE_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(parsed, MAX_PAGE_LIMIT);
};

/**
 * Read the `cursor` query parameter.
 */
export const readCursor = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.length > 0 ? raw : undefined;

/**
 * Build AP-4's overview handler.
 *
 * @param deps the app's dependencies
 */
export const readOverview = (deps: ApiDeps): RouteHandler => {
  return async (): Promise<ReturnType<typeof handled>> => {
    return handled(await deps.inspection.overview());
  };
};

/**
 * Build AP-4's task-list handler.
 *
 * @param deps the app's dependencies
 */
export const listTasks = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const query = ctx.query;
    const state = query['state'];
    const repo = query['repo'];
    const workflow = query['workflow'];
    const cursor = readCursor(query['cursor']);

    const page = await deps.inspection.tasks({
      ...(typeof state === 'string' ? { state } : {}),
      ...(typeof repo === 'string' ? { repo } : {}),
      ...(typeof workflow === 'string' ? { workflow } : {}),
      ...(cursor === undefined ? {} : { cursor }),
      limit: readLimit(query['limit']),
    });

    return handled(
      page.nextCursor === undefined
        ? { items: page.items }
        : { items: page.items, nextCursor: page.nextCursor },
    );
  };
};

/**
 * Build AP-4's single-task handler.
 *
 * @param deps the app's dependencies
 */
export const readTask = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const task = await deps.inspection.task(id);
    if (task === undefined) {
      return refused(notFound(`task "${id}"`));
    }
    return handled(task);
  };
};

/**
 * Build AP-4's task-events handler.
 *
 * @param deps the app's dependencies
 */
export const readTaskEvents = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const events = await deps.inspection.taskEvents(id);
    return handled({ items: events });
  };
};

/**
 * Build AP-4's task-runs handler.
 *
 * @param deps the app's dependencies
 */
export const readTaskRuns = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const runs = await deps.inspection.taskRuns(id);
    return handled({ items: runs });
  };
};

/**
 * Build AP-4's single-run handler.
 *
 * @param deps the app's dependencies
 */
export const readRun = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const run = await deps.inspection.run(id);
    if (run === undefined) {
      return refused(notFound(`run "${id}"`));
    }
    return handled(run);
  };
};

/**
 * Build AP-4's artefact handler.
 *
 * @param deps the app's dependencies
 */
export const readRunArtefact = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const runId = ctx.params['id'] ?? '';
    const name = ctx.params['name'] ?? '';
    const artefact = await deps.inspection.runArtefact(runId, name);
    if (artefact === undefined) {
      return refused(notFound(`artefact "${name}" of run "${runId}"`));
    }
    return handled(artefact);
  };
};

/**
 * Build AP-4's metrics handler.
 *
 * @param deps the app's dependencies
 */
export const readMetricsSummary = (deps: ApiDeps): RouteHandler => {
  return async (): Promise<ReturnType<typeof handled>> => {
    return handled(await deps.inspection.metricsSummary());
  };
};

/**
 * Build AP-4's audit-explain handler.
 *
 * @param deps the app's dependencies
 */
export const readAuditExplain = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const eventId = ctx.query['eventId'];
    if (typeof eventId !== 'string' || eventId.length === 0) {
      return refused(
        // The `eventId` is required — the audit walk has nothing to walk
        // without it, and an empty walk would look like an empty audit.
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          detail: 'the audit explain needs an "eventId" query parameter',
          code: 'validation',
        },
      );
    }
    const explanation = await deps.inspection.auditExplain(eventId);
    if (explanation === undefined) {
      return refused(notFound(`event "${eventId}"`));
    }
    return handled(explanation);
  };
};
