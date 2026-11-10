/**
 * `api/handlers/approve` — **AP-2** (T-1.14).
 *
 * ## What the access point is
 *
 * blueprint `13` §3.1: AP-2 `approve` — "a human reviews a proposed
 * change and approves, refuses or revokes it." Its "Cannot" column: it
 * cannot approve its own work.
 *
 * ## The three rules the handler enforces
 *
 * The approval's authority is not a free parameter, and these three checks
 * are what make it mean something:
 *
 * 1. **The approver list** — pack `04` §3: an approval names its
 *    approvers, and only one of them may decide it. A caller outside the
 *    list is refused with `not_approver`.
 * 2. **The hash binding** — the approval is bound to the digest of the
 *    artefact it approves. If the artefact has changed since the approval
 *    was requested, the approval no longer covers what is on screen, and
 *    the call is refused with `hash_mismatch`. This is the check that
 *    stops "approve, then swap the diff, then merge".
 * 3. **The expiry** — an approval that has expired is refused with
 *    `expired`. An approval is a *time-bounded* authorisation, so a stale
 *    one authorises nothing.
 *
 * The checks are in that order — identity, then binding, then time — so
 * the refusal the caller gets is the *first* thing wrong with the call.
 * A caller who is not an approver does not need to be told their approval
 * expired.
 *
 * ## The security-scope acknowledgement
 *
 * A `securityScopeAck` in the body is the approver saying they read the
 * scope. It is recorded in the `approval.granted` payload, because the
 * contracts register `securityScopeAck` as one of that event's minimum
 * fields — and an acknowledgement nobody recorded is an acknowledgement
 * nobody gave.
 *
 * ## The revoke
 *
 * A revoke is `approval.revoked`, with the reason in the payload. A
 * revoke is not a decision — it withdraws one — so it has no approver-list
 * check, but it does need a reason.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import { handled, refused } from '../ports.js';
import {
  emitFor,
  expired,
  hashMismatch,
  notApprover,
  notFound,
} from './shared.js';

/**
 * The body AP-2's decision accepts.
 */
interface ApprovalDecisionBody {
  readonly decision: 'grant' | 'refuse';
  readonly comment?: string;
  readonly securityScopeAck?: boolean;
  readonly reviewMinutes?: number;
}

/**
 * The body AP-2's revoke accepts.
 */
interface ApprovalRevokeBody {
  readonly reason: string;
}

/**
 * The approval as the handler sees it.
 */
interface ApprovalView {
  readonly id: string;
  readonly taskId: string;
  readonly type: string;
  readonly artefactRef: string;
  readonly artefactSha256: `sha256:${string}`;
  readonly approvers: readonly string[];
  readonly status: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly artefact: {
    readonly kind: string;
    readonly ref: string;
    readonly sha256: `sha256:${string}`;
    readonly blocks: readonly {
      readonly kind: string;
      readonly content: string;
      readonly untrusted: boolean;
    }[];
    readonly diff?: string;
  };
}

/**
 * Build AP-2's list handler.
 *
 * @param deps the app's dependencies
 */
export const listApprovals = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const status = ctx.query['status'];
    const approvals = await deps.approvals.list(
      typeof status === 'string' ? status : undefined,
    );
    return handled({ items: approvals });
  };
};

/**
 * Build AP-2's read handler.
 *
 * @param deps the app's dependencies
 */
export const readApproval = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const approval = await deps.approvals.byId(id);
    if (approval === undefined) {
      return refused(notFound(`approval "${id}"`));
    }
    return handled(approval);
  };
};

/**
 * Build AP-2's decision handler.
 *
 * @param deps the app's dependencies
 */
export const decideApproval = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const body = ctx.body as ApprovalDecisionBody;

    const approval = await deps.approvals.byId(id);
    if (approval === undefined) {
      return refused(notFound(`approval "${id}"`));
    }

    // ---- 1. the approver list ------------------------------------------
    if (!approval.approvers.includes(ctx.login)) {
      return refused(
        notApprover(
          `"${ctx.login}" is not in the approver list for "${id}"`,
        ),
      );
    }

    // ---- 2. the hash binding --------------------------------------------
    //
    // The approval is bound to a digest. If the artefact now carries a
    // different digest, the thing the approver saw is not the thing that
    // would be approved.
    if (approval.artefact.sha256 !== approval.artefactSha256) {
      return refused(
        hashMismatch(
          `the approval is bound to ${approval.artefactSha256} but the artefact now carries ${approval.artefact.sha256}`,
        ),
      );
    }

    // ---- 3. the expiry --------------------------------------------------
    if (approval.expiresAt <= deps.clock.nowIso()) {
      return refused(
        expired(`the approval "${id}" expired at ${approval.expiresAt}`),
      );
    }

    // ---- the decision ----------------------------------------------------
    const granted = body.decision === 'grant';

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: granted ? 'approval.granted' : 'approval.revoked',
        aggregate: { kind: 'approval', id },
        payload: {
          approvalId: id,
          decidedBy: ctx.login,
          artefactSha256: approval.artefactSha256,
          securityScopeAck: body.securityScopeAck === true,
          ...(granted ? {} : { reason: body.comment ?? 'refused' }),
        },
      },
      async () =>
        deps.approvals.decide(id, {
          decision: body.decision,
          identity: ctx.login,
          ...(body.comment === undefined ? {} : { comment: body.comment }),
          ...(body.securityScopeAck === undefined
            ? {}
            : { securityScopeAck: body.securityScopeAck }),
          ...(body.reviewMinutes === undefined
            ? {}
            : { reviewMinutes: body.reviewMinutes }),
        }),
    );
  };
};

/**
 * Build AP-2's revoke handler.
 *
 * @param deps the app's dependencies
 */
export const revokeApproval = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const id = ctx.params['id'] ?? '';
    const body = ctx.body as ApprovalRevokeBody;

    const approval = await deps.approvals.byId(id);
    if (approval === undefined) {
      return refused(notFound(`approval "${id}"`));
    }

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: 'approval.revoked',
        aggregate: { kind: 'approval', id },
        payload: { approvalId: id, reason: body.reason, revokedBy: ctx.login },
      },
      async () => deps.approvals.revoke(id, body.reason),
    );
  };
};

/**
 * The approval view the handler checks — exported for the tests.
 */
export type { ApprovalView };
