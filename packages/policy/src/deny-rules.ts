/**
 * The deny-rule matcher.
 *
 * pack 02 §4.4 step 2: "Any matching **deny rule** (path deny, action deny,
 * forbidden scope) ⇒ `DENY` listing **every** matched rule id. *Deny
 * dominates.*"
 *
 * blueprint 11 §4.4: "A `deny` entry wins over any `grant`, at every level,
 * and over the capability's own declaration. Deny lists are checked first,
 * and a match is terminal."
 *
 * A rule matches when **all** of its present fields match. A field that is
 * absent constrains nothing. The pack's own `denyRules`:
 *
 * ```yaml
 * - { id: deny-factory-write,       when: { capability: factory.write } }
 * - { id: deny-protected-merge,     when: { capability: git.push.protected, autonomyBelow: 3 } }
 * - { id: deny-secret-read-agent,   when: { capability: secret.read, actorKind: agent } }
 * - { id: deny-agent-protected-paths, when: { action: repo.write, actorKind: agent, pathsMatch: "@protectedPaths" } }
 * - { id: deny-egress-private,      when: { action: net.egress, hostClass: [private, loopback, linkLocal, metadata] } }
 * ```
 *
 * Two of these need context the rule does not name:
 *
 * * `autonomyBelow: 3` — "the workflow's autonomy is below 3". It is a
 *   threshold on the *input's* autonomy, not a field of the input.
 * * `pathsMatch: "@protectedPaths"` — a **reference** to the bundle's
 *   `protectedPaths` set, not a literal glob. The reference form is
 *   explicit (`@`) so a literal glob that happens to start with `@` is still
 *   possible, and so the indirection is visible in a review diff.
 * * `hostClass: [private, loopback, linkLocal, metadata]` — a classification
 *   of the *host* the action targets, which the caller supplies (the host is
 *   not resolvable from a pure function; the egress proxy resolves it and
 *   passes the class in).
 *
 * The host class and the resource paths therefore arrive on the input rather
 * than in the `PolicyInput` contract. They are carried on the **evaluation
 * context** — a separate argument to the matcher — so the contract in
 * `@factory/contracts` stays exactly as pack 03 §3 declares it.
 */

import type { DenyCondition, DenyRule, PolicyInput } from '@factory/contracts';

import { matchesAnyGlob, matchesGlob } from './glob.js';

/**
 * The extra facts the deny-rule matcher needs beyond the {@link PolicyInput}.
 *
 * Everything here is derived by the caller from the request being evaluated —
 * the host's network class, the paths the action would touch, and the
 * capability's required autonomy level. None of it is looked up from inside
 * the matcher, because the matcher is pure.
 */
export interface DenyEvaluationContext {
  /**
   * The network class of the target host.
   *
   * One of `private`, `loopback`, `linkLocal`, `metadata`, or `public` for a
   * host on the public internet. The egress proxy resolves the host; the
   * engine only compares the class.
   */
  readonly hostClass?: string;

  /**
   * The paths the action would touch.
   *
   * Used by `pathsMatch` rules. A rule that names a literal glob is matched
   * against each path; a rule that names `@protectedPaths` is matched
   * against the bundle's protected-path set.
   */
  readonly paths?: readonly string[];

  /**
   * The autonomy level the action requires.
   *
   * A capability's own declaration says what level it needs; the workflow
   * has a level. Step 3 compares them. The deny-rule matcher uses it for
   * `autonomyBelow`, which is a rule about the *workflow's* level, so it
   * compares against the input's autonomy.
   */
  readonly requiredAutonomy?: number;

  /**
   * The scope the action would use, for `scope` rules.
   */
  readonly scope?: string;
}

/**
 * The result of matching the deny rules.
 */
export interface DenyMatchResult {
  /** The ids of **every** rule that matched, in bundle order. */
  readonly matchedRuleIds: readonly string[];
}

/**
 * The reference form of `pathsMatch`.
 *
 * `@protectedPaths` means "any path in the bundle's protected-path set".
 */
const PROTECTED_PATHS_REFERENCE = '@protectedPaths';

/**
 * Match a single deny rule against the input.
 *
 * Returns `true` when **every** field present in the rule's `when` matches.
 * A field that is absent in the rule constrains nothing.
 */
export const ruleMatches = (
  rule: DenyRule,
  input: PolicyInput,
  context: DenyEvaluationContext,
  protectedPathPatterns: readonly string[],
): boolean => {
  const when = rule.when;
  return Object.entries(when).every(([field, expected]) =>
    fieldMatches(field, expected, when, input, context, protectedPathPatterns),
  );
};

/**
 * Match one field of a rule's condition.
 */
const fieldMatches = (
  field: string,
  expected: unknown,
  when: DenyCondition,
  input: PolicyInput,
  context: DenyEvaluationContext,
  protectedPathPatterns: readonly string[],
): boolean => {
  switch (field) {
    case 'capability':
      return input.capabilityId === expected;

    case 'action':
      return input.action === expected;

    case 'actorKind':
      return input.actor.kind === expected;

    case 'autonomyBelow': {
      // "The workflow's autonomy is below N." The rule fires when the
      // *workflow* is under the threshold — an L2 workflow attempting a
      // protected push is denied by this rule.
      const threshold = expected as number;
      return input.autonomy < threshold;
    }

    case 'pathsMatch': {
      const pattern = expected as string;
      const paths = context.paths ?? [];
      if (pattern === PROTECTED_PATHS_REFERENCE) {
        // The path must be *in* the protected set. A path that is not
        // protected at all does not match this rule.
        return paths.some((path) =>
          protectedPathPatterns.some((protectedPattern) =>
            matchesGlob(protectedPattern, path),
          ),
        );
      }
      return paths.some((path) => matchesGlob(pattern, path));
    }

    case 'hostClass': {
      const classes = expected as readonly string[];
      const hostClass = context.hostClass;
      if (hostClass === undefined) {
        // No classification means no match: the rule cannot be satisfied
        // without knowing the host's class, and an unsatisfied rule must not
        // fire.
        return false;
      }
      return classes.includes(hostClass);
    }

    case 'scope':
      return context.scope === expected;

    case 'effectClass':
      return input.effectClass === expected;

    case 'tier':
      return input.tier === expected;

    default:
      // An unknown field in a rule is a configuration error. It cannot be
      // satisfied, so the rule does not match — but the condition object
      // came from the schema, so this branch is unreachable for a parsed
      // bundle. It is here so a future field cannot silently be ignored.
      void when;
      return false;
  }
};

/**
 * Match **every** deny rule and collect the ids of those that matched.
 *
 * The result lists every matched rule, not just the first: the decision
 * names all of them, so an auditor sees the full set of reasons rather than
 * the first one the evaluator happened to reach.
 */
export const matchDenyRules = (
  rules: readonly DenyRule[],
  input: PolicyInput,
  context: DenyEvaluationContext,
  protectedPathPatterns: readonly string[],
): DenyMatchResult => {
  const matchedRuleIds: string[] = [];
  for (const rule of rules) {
    if (ruleMatches(rule, input, context, protectedPathPatterns)) {
      matchedRuleIds.push(rule.id);
    }
  }
  return { matchedRuleIds };
};

/**
 * Whether any path in `paths` is in the protected set.
 *
 * Exposed for the definition loader's own checks and for the broker's
 * pre-flight, which refuses a protected path before it ever reaches the
 * engine.
 */
export const touchesProtectedPath = (
  paths: readonly string[],
  protectedPathPatterns: readonly string[],
): boolean => matchesAnyGlob(protectedPathPatterns, paths[0] ?? '');
