/**
 * `api/handlers/define-intent` — **AP-1** (T-1.14).
 *
 * ## What the access point is
 *
 * blueprint `13` §3.1: AP-1 `define-intent` — "a human states an intent
 * to change software, and the factory turns it into a task." Its
 * "Cannot" column: it cannot approve its own work.
 *
 * So AP-1 **records** an intent and returns a task id. It does not start
 * anything and it does not approve anything — the task it creates is
 * reviewed by AP-2 and AP-3, which are separate access points with
 * separate authorities.
 *
 * ## The kill switch refuses intake
 *
 * pack `04` §3: "`POST /v1/factory/kill-switch` … engaged ⇒ intake
 * rejected". So when the switch is engaged, AP-1 refuses with
 * `code: 'kill_switch'` and a `503`.
 *
 * The check happens **before** the intent is recorded — a refused intake
 * must not leave a task behind, or the "rejected" would be a lie.
 *
 * ## The event
 *
 * `intent.recorded`, with the payload fields the contracts register for
 * it: `source` and `repo`. The aggregate is the **task** the intent
 * became, not the intent itself.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import type { handled } from '../ports.js';
import { refused } from '../ports.js';
import { emitFor, killSwitch } from './shared.js';

/**
 * The body AP-1 accepts — the intent.
 */
interface IntentBody {
  readonly repo: string;
  readonly source:
    | { readonly kind: 'github-issue'; readonly ref: string }
    | { readonly kind: 'manual'; readonly title: string; readonly body: string };
  readonly workflow?: string;
  readonly budgetUsdMicros?: number;
}

/**
 * The value AP-1 returns.
 */
interface IntentAccepted {
  readonly taskId: string;
}

/**
 * Build AP-1's handler.
 *
 * @param deps the app's dependencies
 */
export const defineIntent = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled<IntentAccepted>>> => {
    // ---- the kill switch ------------------------------------------------
    //
    // Checked first: an engaged switch refuses intake, and a refusal must
    // not leave a task behind.
    if (await deps.killSwitch.isEngaged()) {
      return refused(
        killSwitch(
          'the kill switch is engaged — new intents are refused until it is released',
        ),
      );
    }

    const body = ctx.body as IntentBody;

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: 'intent.recorded',
        aggregate: (value) => ({ kind: 'task', id: value.taskId }),
        payload: (value) => ({
          source: body.source.kind,
          repo: body.repo,
          taskId: value.taskId,
        }),
      },
      async () => {
        const recorded = await deps.intents.record({
          repo: body.repo,
          source: body.source,
          ...(body.workflow === undefined ? {} : { workflow: body.workflow }),
          ...(body.budgetUsdMicros === undefined
            ? {}
            : { budgetUsdMicros: body.budgetUsdMicros }),
        });
        return { ok: true, value: { taskId: recorded.taskId } };
      },
      202,
    );
  };
};
