/**
 * `api/handlers/review` — **AP-3** (T-1.14).
 *
 * ## What the access point is
 *
 * blueprint `13` §3.1: AP-3 `review` — "a human reviews the factory's
 * own work: the plan, the evidence, the diff." Its "Cannot" column: it
 * cannot approve its own work.
 *
 * So the review queue and the review's evidence bundle are AP-3's reads,
 * and the decision — approve, reject, defer — is AP-3's write.
 *
 * ## The rationale is mandatory
 *
 * pack `04` §3: the decision body is `{decision, rationale}` — and the
 * rationale is **required**, not optional. A review with no stated
 * rationale is not a review; it is a verdict without a reason, and the
 * event log would record a decision nobody can account for.
 *
 * ## The three decisions are three events
 *
 * `review.approved`, `review.rejected`, `review.deferred` — each is in the
 * registered vocabulary, and each is a distinct state change, so each gets
 * its own event type. A deferred review is **not** an approval that has
 * not happened yet; it is a different outcome, and the log says so.
 *
 * ## The evidence bundle
 *
 * `GET /v1/reviews/{taskId}` returns the bundle: the spec, the oracle
 * result, the gate report, the panel result, the blast radius and the
 * diff link. The transcript is **opt-in** (`?transcript=true`) because it
 * is the largest artefact and the least often needed.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import { handled, refused } from '../ports.js';
import { emitFor, notFound } from './shared.js';

/**
 * The body AP-3's decision accepts.
 */
interface ReviewDecisionBody {
  readonly decision: 'approve' | 'reject' | 'defer';
  readonly rationale: string;
}

/**
 * The event type each decision emits.
 *
 * A closed map, so the three decisions cannot drift apart.
 */
export const REVIEW_EVENT_TYPES = {
  approve: 'review.approved',
  reject: 'review.rejected',
  defer: 'review.deferred',
} as const;

/**
 * Build AP-3's queue handler.
 *
 * @param deps the app's dependencies
 */
export const listReviews = (deps: ApiDeps): RouteHandler => {
  return async (): Promise<ReturnType<typeof handled>> => {
    const reviews = await deps.reviews.list();
    return handled({ items: reviews });
  };
};

/**
 * Build AP-3's evidence-bundle handler.
 *
 * @param deps the app's dependencies
 */
export const readReview = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const taskId = ctx.params['taskId'] ?? '';
    const includeTranscript = ctx.query['transcript'] === 'true';
    const review = await deps.reviews.byTaskId(taskId, includeTranscript);
    if (review === undefined) {
      return refused(notFound(`review for task "${taskId}"`));
    }
    return handled(review);
  };
};

/**
 * Build AP-3's decision handler.
 *
 * @param deps the app's dependencies
 */
export const decideReview = (deps: ApiDeps): RouteHandler => {
  return async (ctx): Promise<ReturnType<typeof handled>> => {
    const taskId = ctx.params['taskId'] ?? '';
    const body = ctx.body as ReviewDecisionBody;

    const review = await deps.reviews.byTaskId(taskId, false);
    if (review === undefined) {
      return refused(notFound(`review for task "${taskId}"`));
    }

    return emitFor(
      deps,
      { login: ctx.login, via: ctx.via },
      ctx.requestId,
      {
        type: REVIEW_EVENT_TYPES[body.decision],
        aggregate: { kind: 'task', id: taskId },
        payload: {
          taskId,
          decision: body.decision,
          rationale: body.rationale,
          decidedBy: ctx.login,
        },
      },
      async () =>
        deps.reviews.decide(taskId, {
          decision: body.decision,
          rationale: body.rationale,
          identity: ctx.login,
        }),
    );
  };
};
