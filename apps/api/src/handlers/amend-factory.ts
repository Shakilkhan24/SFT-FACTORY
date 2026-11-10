/**
 * `api/handlers/amend-factory` — **AP-6** (T-1.14).
 *
 * ## What the access point is
 *
 * blueprint `13` §3.1: AP-6 `amend-factory` — "a human proposes a change
 * to the factory's own definition — its workflows, its policy, its
 * capabilities — and it is reviewed like any other change." Its "Cannot"
 * column: it cannot approve its own change.
 *
 * ## The API never writes the live definition
 *
 * This is the trap in the ticket, and it is worth being explicit about.
 *
 * `packages/definition` ships the real applier, and the applier has three
 * preconditions — the SHA is on the protected default branch with green
 * checks, an owner `definition` approval bound to the exact
 * `bundleSha256`, and the connection acts as the `factory_applier` role.
 * The **API role cannot insert into `definition_versions`** (A0.7).
 *
 * So `POST /v1/definition/apply` does **not** write the live definition.
 * It asks the definition port for the plan the reviewed change carries,
 * and refuses when the approval does not bind it. The write happens
 * through the applier, with the applier's role, in the applier's process
 * — not through a control-surface HTTP call.
 *
 * blueprint `13` §3.3 quotes ADR-0001's acceptance test: "A control-surface
 * write that is not backed by a reviewed change in the definition is
 * **rejected**." So the refusal is the *behaviour*, not a limitation.
 *
 * ## The plan is a read
 *
 * `GET /v1/definition/plan` returns the diff between the applied bundle
 * and a candidate. It is the thing the approver looks at — so the SHA it
 * names is the SHA the approval must be bound to.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import { handled, refused } from '../ports.js';
import { emitFor, hashMismatch, notFound } from './shared.js';

/**
 * The body AP-6's apply accepts.
 */
interface DefinitionApplyBody {
  readonly sha: string;
  readonly approvalId: string;
}

/**
 * Build AP-6's plan handler.
 *
 * @param deps the app's dependencies
 */
export const readDefinitionPlan = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const sha = ctx.query['sha'];
    const plan = await deps.definition.plan(
      typeof sha === 'string' ? sha : undefined,
    );

    if ('refusal' in plan) {
      // The port refused. The refusal carries its own code and status.
      return refused(plan.refusal);
    }

    return handled(plan);
  };
};

/**
 * Build AP-6's apply handler.
 *
 * @param deps the app's dependencies
 */
export const applyDefinition = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const body = ctx.body as DefinitionApplyBody;

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: 'definition.applied',
        aggregate: { kind: 'definition', id: body.sha },
        payload: (value) => ({
          sha: body.sha,
          approvalId: body.approvalId,
          bundleSha256: value.bundleSha256,
        }),
      },
      async () =>
        deps.definition.apply({
          sha: body.sha,
          approvalId: body.approvalId,
          identity: ctx.login,
        }),
    );
  };
};

/**
 * The refusal for an apply whose approval does not bind the bundle.
 *
 * Exported so the tests can name the same refusal the handler would
 * produce — a test that constructs its own refusal proves nothing.
 */
export const approvalDoesNotBind = (bound: string, applied: string) =>
  hashMismatch(
    `the approval is bound to ${bound}, not to the bundle being applied (${applied})`,
  );

/**
 * The refusal for an apply that names no known approval.
 */
export const noSuchApproval = (approvalId: string) =>
  notFound(`approval "${approvalId}"`);
