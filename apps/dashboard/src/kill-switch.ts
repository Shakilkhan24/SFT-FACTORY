/**
 * `dashboard/kill-switch` — the kill switch's decision (T-1.16).
 *
 * ## Why this is a separate module
 *
 * The decision is **pure** — a prompt's answer and the switch's current
 * state in, a verdict out. So it lives in a `.ts` module, where it can
 * be unit-tested without a JSX transform, and `views.tsx` holds only the
 * component.
 *
 * ## The rule
 *
 * A kill switch engaged **without a reason** cannot be released by
 * whoever finds it — the release needs a reason, and a reason nobody
 * wrote is a reason nobody can reconstruct. So the dashboard refuses a
 * blank one, and says why.
 *
 * The refusal is a **distinct message**, not a generic one. A generic
 * refusal would make "you did not type a reason" indistinguishable from
 * "the API refused the call", and an operator looking at the wrong
 * thing is worse than an operator with no message.
 */

/**
 * The prompt's answer, as the browser hands it over.
 *
 * `null` means the human **dismissed** the prompt — which is not a
 * refusal and not an error, it is a person changing their mind. So it
 * is its own case, and it says nothing.
 */
export type PromptAnswer = string | null;

/**
 * What the dashboard should do.
 *
 * `proceed` carries the reason and the switch's next state. `cancelled`
 * means the human dismissed the prompt. `refused` carries the message
 * to show.
 */
export type KillSwitchDecision =
  | { readonly kind: 'proceed'; readonly engage: boolean; readonly reason: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * Decide what to do about a kill-switch request.
 *
 * @param answer what the prompt returned
 * @param engaged the switch's current state
 * @param wired is the switch wired to anything at all
 */
export const decideKillSwitch = (
  answer: PromptAnswer,
  engaged: boolean,
  wired = true,
): KillSwitchDecision => {
  if (!wired) {
    return { kind: 'refused', message: 'the kill switch is not wired' };
  }
  if (answer === null) {
    // The human dismissed the prompt. Nothing is said, because nothing
    // went wrong — a person changing their mind is not an error.
    return { kind: 'cancelled' };
  }
  if (answer.trim() === '') {
    return { kind: 'refused', message: 'the kill switch needs a reason' };
  }
  return { kind: 'proceed', engage: !engaged, reason: answer };
};

/**
 * The message shown after a successful flip.
 */
export const killSwitchMessage = (engage: boolean): string =>
  engage ? 'the kill switch is engaged' : 'the kill switch is released';
