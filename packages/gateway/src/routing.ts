/**
 * `gateway` — the routing decision.
 *
 * ## What routing is
 *
 * blueprint 11 §9.3: *"Routing is a **declarative policy** in the factory
 * definition, evaluated per request."*
 *
 * The policy (pack 03 §4.6) has three parts:
 *
 * ```yaml
 * spec:
 *   providers: { anthropic: { adapter: anthropic } }
 *   classes:
 *     triage: { primary: { provider: anthropic, model: claude-haiku-5-5 } }
 *     strong:  { primary: { provider: anthropic, model: claude-opus-5-5 },
 *                fallbacks: [ { provider: secondary, model: "…" } ] }
 *   rules:
 *     - { match: { role: triage }, use: triage }
 * ```
 *
 * A request carries a **role** (and optionally a **stage**). The rules
 * match it to a **class**, and the class names a **primary** and its
 * **fallbacks**.
 *
 * ## The rules that are decisions, not code
 *
 * 1. **A rule that matches nothing is a refusal.** The gateway does not
 *    fall back to a default class. A role nobody routed would otherwise
 *    be answered by *some* model — and the point of the policy is that
 *    the operator decides which one.
 * 2. **The first matching rule wins.** The rules are ordered, and the
 *    order is the operator's.
 * 3. **A class that names an unknown provider is a refusal.** The policy
 *    declares its providers; a class naming one that is not declared is
 *    a policy that cannot be executed.
 * 4. **A fallback to the same provider is rejected** — blueprint 11 §9.3,
 *    NFR-09: *"A fallback to the same provider under the same failure
 *    mode is not a fallback. The policy validation rejects a fallback
 *    whose provider and trigger match the primary's."*
 *
 * Rule 4 is a property of the **policy**, so it is checked when the
 * policy is loaded, not per request. This module exposes it as
 * `validateRoutingPolicy` for that purpose.
 *
 * ## Why the module is pure
 *
 * The routing decision is a function of the policy and the request. It
 * touches no clock, no network and no database, so it can be proved
 * without any of them.
 */

import type { RoutingPolicy } from '@factory/contracts';

import type { Route, RouteCandidate } from './types.js';

/**
 * The outcome of resolving a route.
 */
export type RouteResolution =
  | { readonly ok: true; readonly route: Route }
  | { readonly ok: false; readonly reason: string };

/**
 * A request's routing inputs.
 *
 * The `ModelRequest` carries a `role`; the routing policy's `match` may
 * also name a `stage`. Both are matched here.
 */
export interface RoutingInput {
  /** The role the request is made for. */
  readonly role: string;
  /** The stage the request is made for, when there is one. */
  readonly stage?: string;
}

/**
 * Does a rule's `match` cover this input?
 *
 * A `match` with no `role` and no `stage` matches everything. A `match`
 * that names a role matches when the role is in it — a rule may name
 * one role or a list of them (the contracts' schema allows both).
 *
 * **Both** named fields must match. A rule that names a role *and* a
 * stage is narrower than either alone, and treating it as either would
 * widen it.
 */
const matches = (
  match: RoutingPolicy['spec']['rules'][number]['match'],
  input: RoutingInput,
): boolean => {
  if (match.role !== undefined) {
    const roles = Array.isArray(match.role) ? match.role : [match.role];
    if (!roles.includes(input.role)) {
      return false;
    }
  }

  if (match.stage !== undefined) {
    const stages = Array.isArray(match.stage) ? match.stage : [match.stage];
    if (input.stage === undefined || !stages.includes(input.stage)) {
      return false;
    }
  }

  return true;
};

/**
 * The rule's **name**.
 *
 * The contracts' `RoutingPolicy` schema does not give a rule an `id` —
 * the corpus's blueprint 11 §9.3 shape does, but the contracts are the
 * wire format and they are frozen (HR-12). So the rule's name is
 * **derived**: the class it selects.
 *
 * A derived name is stable — the same policy always produces the same
 * rule name — which is what `model_calls.route_rule` and the
 * `routingDecision.rule` need. What it does not give is a *short*
 * name, and the class name is the honest thing to record: it is what
 * the operator wrote in the policy.
 */
const ruleName = (use: string): string => use;

/**
 * Resolve the route for a request.
 *
 * @param policy the routing policy.
 * @param input the request's role and stage.
 */
export const resolveRoute = (
  policy: RoutingPolicy,
  input: RoutingInput,
): RouteResolution => {
  const rule = policy.spec.rules.find((candidate) => matches(candidate.match, input));

  if (rule === undefined) {
    return {
      ok: false,
      reason:
        `no routing rule matched the request (role "${input.role}"` +
        (input.stage === undefined ? '' : `, stage "${input.stage}"`) +
        '); the gateway does not fall back to a default model',
    };
  }

  const routeClass = policy.spec.classes[rule.use];

  if (routeClass === undefined) {
    return {
      ok: false,
      reason: `the routing rule selected the class "${rule.use}", which the policy does not define`,
    };
  }

  const candidates: RouteCandidate[] = [];

  const primaryProvider = policy.spec.providers[routeClass.primary.provider];
  if (primaryProvider === undefined) {
    return {
      ok: false,
      reason: `the class "${rule.use}" names the provider "${routeClass.primary.provider}", which the policy does not declare`,
    };
  }
  candidates.push({
    provider: routeClass.primary.provider,
    model: routeClass.primary.model,
    kind: 'primary',
  });

  for (const fallback of routeClass.fallbacks) {
    const fallbackProvider = policy.spec.providers[fallback.provider];
    if (fallbackProvider === undefined) {
      return {
        ok: false,
        reason: `the class "${rule.use}" names the fallback provider "${fallback.provider}", which the policy does not declare`,
      };
    }
    candidates.push({
      provider: fallback.provider,
      model: fallback.model,
      kind: 'fallback',
    });
  }

  return {
    ok: true,
    route: { rule: ruleName(rule.use), className: rule.use, candidates },
  };
};

/**
 * A problem with a routing policy.
 */
export interface RoutingPolicyProblem {
  /** The class the problem is in. */
  readonly className: string;
  /** What is wrong. */
  readonly reason: string;
}

/**
 * Validate a routing policy's **structure**.
 *
 * The contracts' schema already guarantees the shapes. This checks the
 * two things the schema cannot:
 *
 * 1. **A rule that selects a class the policy does not define.** The
 *    schema cannot say so — `use` is just a string.
 * 2. **A fallback to the same provider as the primary** — blueprint 11
 *    §9.3, NFR-09: *"A fallback to the same provider under the same
 *    failure mode is not a fallback. The policy validation rejects a
 *    fallback whose provider and trigger match the primary's."*
 *
 * A policy that fails either check is **refused**, not repaired.
 */
export const validateRoutingPolicy = (
  policy: RoutingPolicy,
): readonly RoutingPolicyProblem[] => {
  const problems: RoutingPolicyProblem[] = [];

  for (const rule of policy.spec.rules) {
    if (policy.spec.classes[rule.use] === undefined) {
      problems.push({
        className: rule.use,
        reason: `a routing rule selects the class "${rule.use}", which the policy does not define`,
      });
    }
  }

  for (const [className, routeClass] of Object.entries(policy.spec.classes)) {
    for (const fallback of routeClass.fallbacks) {
      if (fallback.provider === routeClass.primary.provider) {
        problems.push({
          className,
          reason:
            `the class "${className}" falls back to the provider "${fallback.provider}", ` +
            'which is the primary — a fallback to the same provider under the same failure mode is not a fallback',
        });
      }
    }
  }

  return problems;
};
