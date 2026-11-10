/**
 * `api/handlers/intervene` — **AP-5** (T-1.14).
 *
 * ## What the access point is
 *
 * blueprint `13` §3.1: AP-5 `intervene` — "a human stops, pauses,
 * resumes, cancels or escalates a running task." Its "Cannot" column: it
 * cannot approve its own work.
 *
 * ## The five actions are one route shape
 *
 * pack `04` §3: "`POST /v1/tasks/{id}/{pause|resume|cancel|escalate|rerun}`".
 * Five routes, one behaviour — so the handler is built **once** and
 * bound to each action. The action is not a free string: it is one of
 * five, and the route table names which.
 *
 * ## The reason is required
 *
 * Every intervention carries a `reason`. An intervention that stops a
 * running task without saying why leaves the operator — and the audit —
 * with no account of what happened. The reason goes into the event
 * payload.
 *
 * ## The kill switch
 *
 * `POST /v1/factory/kill-switch` — `{engage, reason}`. Engaged ⇒ intake
 * refused, scheduler claims nothing, harness containers killed, edge
 * denies new model calls. The API owns the **intake** half: AP-1 reads
 * the switch and refuses. The other halves belong to the scheduler and
 * the harness, and they read the same state.
 *
 * The event is `kill.switch.engaged` or `kill.switch.released`, and the
 * contracts register `by` and `reason` as its minimum fields — so both
 * are recorded.
 *
 * ## The temporary grant
 *
 * pack `04` §3: `{taskId, capability, scope, ttlSeconds≤3600, reason}`.
 * The TTL is capped at an hour **by the schema**, so the cap cannot be
 * widened by a caller who writes a bigger number.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import type { handled } from '../ports.js';
import { emitFor } from './shared.js';

/**
 * The five interventions.
 *
 * A closed set — the route table names them, and nothing else can be
 * acted on.
 */
export const INTERVENTIONS = [
  'pause',
  'resume',
  'cancel',
  'escalate',
  'rerun',
] as const;

export type Intervention = (typeof INTERVENTIONS)[number];

/**
 * The body AP-5's intervention accepts.
 */
interface InterventionBody {
  readonly reason: string;
}

/**
 * The body AP-5's kill-switch call accepts.
 */
interface KillSwitchBody {
  readonly engage: boolean;
  readonly reason: string;
}

/**
 * The body AP-5's temporary grant accepts.
 */
interface TemporaryGrantBody {
  readonly taskId: string;
  readonly capability: string;
  readonly scope: string;
  readonly ttlSeconds: number;
  readonly reason: string;
}

/**
 * The body AP-5's defect flag accepts.
 */
interface DefectFlagBody {
  readonly note: string;
}

/**
 * Build an intervention handler for one action.
 *
 * @param deps the app's dependencies
 * @param action the action this route performs
 */
export const intervene = (
  deps: ApiDeps,
  action: Intervention,
): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const taskId = ctx.params['id'] ?? '';
    const body = ctx.body as InterventionBody;

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: 'policy.escalated',
        aggregate: { kind: 'task', id: taskId },
        payload: {
          taskId,
          action,
          reason: body.reason,
          by: ctx.login,
        },
      },
      async () =>
        deps.intervention.act(taskId, action, body.reason, ctx.login),
    );
  };
};

/**
 * Build the kill-switch handler.
 *
 * @param deps the app's dependencies
 */
export const setKillSwitch = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const body = ctx.body as KillSwitchBody;

    await deps.killSwitch.set(body.engage, body.reason);

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: body.engage ? 'kill.switch.engaged' : 'kill.switch.released',
        aggregate: { kind: 'factory', id: 'factory' },
        payload: { by: ctx.login, reason: body.reason },
      },
      () => Promise.resolve({ ok: true, value: { engaged: body.engage } }),
    );
  };
};

/**
 * Build the temporary-grant handler.
 *
 * @param deps the app's dependencies
 */
export const createTemporaryGrant = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const body = ctx.body as TemporaryGrantBody;

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: 'approval.requested',
        aggregate: (value) => ({ kind: 'approval', id: value.approvalId }),
        payload: (value) => ({
          approvalId: value.approvalId,
          type: 'temporary_grant',
          taskId: body.taskId,
          capability: body.capability,
          scope: body.scope,
          expiresAt: new Date(
            deps.clock.now().getTime() + body.ttlSeconds * 1000,
          ).toISOString(),
        }),
      },
      async () =>
        deps.intervention.createTemporaryGrant({
          taskId: body.taskId,
          capability: body.capability,
          scope: body.scope,
          ttlSeconds: body.ttlSeconds,
          reason: body.reason,
          identity: ctx.login,
        }),
      201,
    );
  };
};

/**
 * Build the defect-flag handler.
 *
 * @param deps the app's dependencies
 */
export const flagDefect = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const taskId = ctx.params['id'] ?? '';
    const body = ctx.body as DefectFlagBody;

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: 'review.escalated',
        aggregate: { kind: 'task', id: taskId },
        payload: { taskId, note: body.note, by: ctx.login },
      },
      async () => deps.intervention.flagDefect(taskId, body.note),
    );
  };
};
