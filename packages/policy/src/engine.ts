/**
 * The policy engine — `evaluate(input, bundle) → Decision`.
 *
 * pack 02 §4.4: "Pure function `evaluate(input, bundle) → Decision`.
 * Algorithm (**fail-closed**):
 *
 * 1. Validate input against schema → invalid ⇒ `DENY(invalid_input)`.
 * 2. Any matching **deny rule** ⇒ `DENY` listing every matched rule id.
 *    *Deny dominates.*
 * 2b. **Equivalent-effect check (AT-14):** if `priorDenials` already contains
 *    the same `(effectClass, resourceKey)` pair via a *different* capability ⇒
 *    `ESCALATE`.
 * 3. Autonomy check: action's required level > workflow's level ⇒
 *    `DENY(autonomy)`.
 * 4. Grant check: effective grant = `workflow ∩ stage ∩ resource`; capability
 *    or scope absent ⇒ `DENY(no_grant)`.
 * 5. Effect class: E0/E1 ⇒ allow; E2 ⇒ allow only if resource-scope
 *    matches; **E3/E4 ⇒ `REQUIRE_APPROVAL`** (artefact-bound).
 * 6. Tier rule: tier ≥ R3 on approve/merge-class actions ⇒
 *    `REQUIRE_APPROVAL(security-scope)`.
 * 7. Default ⇒ **`DENY(default)`**.
 *
 * Any thrown error ⇒ `DENY(engine_error)`."
 *
 * blueprint 13 §2.3 (the arbitration rule): "**Deny by default and
 * escalate.** 'Let the orchestrator try and see' is not available anywhere in
 * the system." And blueprint 13 SG-12: "The failure mode of the policy
 * engine is deny."
 *
 * ## The three properties that make this the security core
 *
 * **It is total.** `evaluate` returns a `Decision` for every input. It never
 * throws — a thrown error becomes `DENY(engine_error)` — because a policy
 * engine that throws is a policy engine that can be crashed into failing
 * *open* by whoever controls the input.
 *
 * **It is deterministic.** The same input and the same bundle produce the
 * same decision, byte for byte. There is no clock, no randomness, and no
 * iteration over an unordered collection whose order could vary.
 *
 * **It fails closed.** Every branch that is not an explicit allow ends in a
 * denial or an escalation. There is no "fall through to allow".
 *
 * ## The order is load-bearing
 *
 * The steps run in the order the pack gives, and the order encodes the
 * priority of the concerns:
 *
 * * **Deny before grant** (step 2 before step 4) because a deny rule is
 *   shorter, more specific, and more likely to be the safety-critical entry
 *   (blueprint 11 §4.4).
 * * **Equivalent-effect before autonomy** (step 2b) because an escalation is
 *   a *human* being asked to look, and that question should be asked even
 *   when the action would have been refused on autonomy grounds — otherwise
 *   the pattern of repeated attempts is invisible.
 * * **Autonomy before grant** (step 3 before step 4) because the ladder is a
 *   property of the *level*, and a level that cannot perform the action at
 *   all should not be reported as missing a grant.
 * * **Effect class before tier** (step 5 before step 6) because the effect
 *   class is a property of the *capability* and the tier is a property of the
 *   *change*; the capability's requirement is the stronger of the two.
 */

import {
  PolicyInput as PolicyInputSchema,
  ENGINE_RULE_IDS,
  type Decision,
  type PolicyBundle,
  type PolicyInput,
  type RequiredApproval,
  type Tier,
} from '@factory/contracts';

import { policyBundleSha256 } from './bundle.js';
import { matchDenyRules, type DenyEvaluationContext } from './deny-rules.js';
import { checkEffectiveGrant, type EffectiveGrant } from './grants.js';

/**
 * The extra inputs the engine needs beyond the bundle.
 *
 * Everything here is **resolved by the caller**: the grants, the autonomy
 * level the capability requires, the host's network class, the paths the
 * action touches. The engine resolves nothing itself, because resolving any
 * of it would mean reading the definition or the network — and the engine is
 * pure (pack 02 §3).
 */
export interface PolicyEvaluationContext {
  /** The workflow's grant. */
  readonly workflowGrant?: EffectiveGrant;

  /** The stage's narrower grant, when the action happens in a stage. */
  readonly stageGrant?: EffectiveGrant;

  /** The autonomy level the action requires. */
  readonly requiredAutonomy?: number;

  /**
   * The scope the action's capability requires.
   *
   * pack 04 §5: `git.patch.apply` requires `repo:write:path:<glob>`;
   * `github.pr.create` requires `git.write.pr`. A grant's `allow` list is a
   * list of scopes, so this is what the grant check compares against.
   *
   * It is **required** for the grant check to be meaningful: without it, no
   * grant can cover the action, and the engine would deny everything.
   */
  readonly requiredScope?: string;

  /** The network class of the target host. */
  readonly hostClass?: string;

  /** The paths the action would touch. */
  readonly paths?: readonly string[];

  /** The scope the action would use. */
  readonly scope?: string;
}

/**
 * The actions that are "approve/merge-class" for the tier rule (step 6).
 *
 * pack 03 §4.7's tier rules: `R3: { approveActions: requireApproval-security }`.
 * The tier rule fires on the actions that *grant* authority — approving,
 * approving a plan, and merging — because those are the actions a blast
 * radius of R3 or above must not take on its own.
 */
const APPROVE_MERGE_ACTIONS: readonly string[] = [
  'approve',
  'approve.plan',
  'approve.merge',
  'merge',
];

/**
 * The effect class required for the tier rule (step 6).
 *
 * The pack's tier rule is `R3: { approveActions: requireApproval-security }`,
 * so the approval the tier rule demands has the `security` scope.
 */
const TIER_APPROVAL_TYPE = 'merge';

/**
 * The effect class required by the effect rules (step 5).
 */
const EFFECT_APPROVAL_TYPE = 'effectful';

/**
 * The digest reported when the bundle's own digest could not be computed.
 *
 * It is the digest of the canonical empty object. A decision that failed
 * before the bundle could be read must still carry *some* well-formed
 * digest — the column is `NOT NULL` — and "no bundle" is the honest thing
 * to record.
 */
const ENGINE_ERROR_DIGEST: `sha256:${string}` =
  'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

/**
 * Build a decision.
 *
 * The `reason` is a human-readable sentence naming the outcome and the
 * rules that produced it. It is stored with the decision, so it must say
 * *why*, not just *what*.
 */
const decision = (
  outcome: Decision['outcome'],
  ruleIds: readonly string[],
  reason: string,
  bundleSha256: `sha256:${string}`,
  requiredApproval?: RequiredApproval,
): Decision => ({
  outcome,
  ruleIds: [...ruleIds],
  reason,
  bundleSha256,
  ...(requiredApproval === undefined ? {} : { requiredApproval }),
});

/**
 * Evaluate an action against a policy bundle.
 *
 * **Total**: this never throws. Every failure path returns a `DENY`.
 *
 * @param input the action to evaluate.
 * @param bundle the rules to evaluate it against.
 * @param context the resolved grants and facts the engine cannot derive.
 */
export const evaluate = (
  input: PolicyInput,
  bundle: PolicyBundle,
  context: PolicyEvaluationContext = {},
): Decision => {
  try {
    // The digest is computed inside the try: a bundle whose canonical form
    // cannot be computed (a getter that throws, a value JSON cannot
    // represent) must fail closed rather than escape the engine.
    const bundleSha256 = policyBundleSha256(bundle);
    return evaluateInner(input, bundle, context, bundleSha256);
  } catch (error) {
    // pack 02 §4.4: "Any thrown error ⇒ `DENY(engine_error)`."
    // The engine's failure mode is deny (blueprint 13 SG-12), so a bug here
    // closes the door rather than opening it.
    return decision(
      'DENY',
      [ENGINE_RULE_IDS.engine_error],
      `the policy engine failed and denied the action: ${describe(error)}`,
      // The digest may itself be what failed, so the fallback is the digest
      // of the empty object — a well-formed value that identifies "no
      // bundle" rather than a specific bundle.
      ENGINE_ERROR_DIGEST,
    );
  }
};

/**
 * The algorithm proper, with the failure handling hoisted to {@link evaluate}.
 */
const evaluateInner = (
  input: PolicyInput,
  bundle: PolicyBundle,
  context: PolicyEvaluationContext,
  bundleSha256: `sha256:${string}`,
): Decision => {
  // ---- Step 1: validate the input -------------------------------------
  //
  // The input is validated against the contract schema. An input that does
  // not conform is not a request the engine can reason about, and a rule
  // evaluated against a malformed input could match by accident — so the
  // input is rejected before any rule is read.
  const parsed = PolicyInputSchema.safeParse(input);
  if (!parsed.success) {
    return decision(
      'DENY',
      [ENGINE_RULE_IDS.invalid_input],
      'the policy input did not conform to the schema',
      bundleSha256,
    );
  }

  const valid = parsed.data;

  // ---- Step 2: deny rules ----------------------------------------------
  //
  // "Deny dominates." Every matched rule is listed, not just the first.
  const denyContext: DenyEvaluationContext = {
    ...(context.hostClass === undefined ? {} : { hostClass: context.hostClass }),
    ...(context.paths === undefined ? {} : { paths: context.paths }),
    ...(context.requiredAutonomy === undefined
      ? {}
      : { requiredAutonomy: context.requiredAutonomy }),
    ...(context.scope === undefined ? {} : { scope: context.scope }),
  };

  const denyMatch = matchDenyRules(
    bundle.spec.denyRules,
    valid,
    denyContext,
    bundle.spec.protectedPaths,
  );

  if (denyMatch.matchedRuleIds.length > 0) {
    return decision(
      'DENY',
      denyMatch.matchedRuleIds,
      `denied by ${denyMatch.matchedRuleIds.length} deny rule(s): ${denyMatch.matchedRuleIds.join(', ')}`,
      bundleSha256,
    );
  }

  // ---- Step 2b: the equivalent-effect check (AT-14) ---------------------
  //
  // "if `priorDenials` — supplied by the broker from this task's recorded
  // denials — already contains the same `(effectClass, resourceKey)` pair via
  // a *different* capability ⇒ `ESCALATE` (the task is flagged to a human;
  // the second attempt is **not** executed)."
  //
  // The rule catches an attempt to reach an effect that was already denied,
  // through a second capability. The same capability retrying is *not* an
  // escalation — that is the normal retry path — so the capability must
  // differ.
  const escalation = equivalentEffect(valid);
  if (escalation !== undefined) {
    return decision(
      'ESCALATE',
      [ENGINE_RULE_IDS.equivalent_effect, ...escalation.ruleIds],
      escalation.reason,
      bundleSha256,
    );
  }

  // ---- Step 3: the autonomy check ---------------------------------------
  //
  // "the action's required level > the workflow's level ⇒ `DENY(autonomy)`."
  //
  // blueprint 13 §4.2: the ladder "is not a label. It is enforced at the
  // transition guard." This is the second enforcement point.
  const requiredAutonomy = context.requiredAutonomy;
  if (requiredAutonomy !== undefined && requiredAutonomy > valid.autonomy) {
    return decision(
      'DENY',
      [ENGINE_RULE_IDS.autonomy],
      `the action requires autonomy L${requiredAutonomy} and the workflow is at L${valid.autonomy}`,
      bundleSha256,
    );
  }

  // ---- Step 4: the grant check ------------------------------------------
  //
  // "effective grant = `workflow ∩ stage ∩ resource`; capability or scope
  // absent ⇒ `DENY(no_grant)`."
  //
  // The scope the action requires comes from the capability's own
  // declaration. Without it no grant can cover the action, and the action is
  // denied — which is the correct answer for an action whose required scope
  // nobody stated.
  const requiredScope = context.requiredScope;
  const grant =
    requiredScope === undefined
      ? { granted: false as const, reason: 'the action states no required scope' }
      : checkEffectiveGrant(
          {
            ...(context.workflowGrant === undefined
              ? {}
              : { workflowGrant: context.workflowGrant }),
            ...(context.stageGrant === undefined
              ? {}
              : { stageGrant: context.stageGrant }),
          },
          valid,
          requiredScope,
        );
  if (!grant.granted) {
    return decision(
      'DENY',
      [ENGINE_RULE_IDS.no_grant],
      `no grant covers the action: ${grant.reason}`,
      bundleSha256,
    );
  }

  // ---- Step 5: the effect class -----------------------------------------
  //
  // "E0/E1 ⇒ allow; E2 ⇒ allow only if the resource scope matches; **E3/E4 ⇒
  // `REQUIRE_APPROVAL`** (artefact-bound)."
  //
  // The step does not return immediately on `allow`, because the tier rule
  // (step 6) can still require an approval for an action the effect class
  // permits. So the effect rule's verdict is recorded and the allow is
  // *confirmed* at step 7.
  const effectClass = valid.effectClass;
  if (effectClass === undefined) {
    // An action with no declared effect class cannot be shown to be safe, so
    // it falls through to the default deny at step 7.
    return decision(
      'DENY',
      [ENGINE_RULE_IDS.default],
      'the action declares no effect class, so it is denied by default',
      bundleSha256,
    );
  }

  const effectRule = bundle.spec.effectRules[effectClass];

  if (effectRule === 'requireApproval') {
    return decision(
      'REQUIRE_APPROVAL',
      [ENGINE_RULE_IDS.effect_class, `policy.effect/${effectClass}`],
      `effect class ${effectClass} requires an artefact-bound approval`,
      bundleSha256,
      { type: EFFECT_APPROVAL_TYPE, scope: 'security' },
    );
  }

  if (effectRule === 'allowIfResourceScoped' && !resourceScopeMatches(valid)) {
    return decision(
      'DENY',
      [ENGINE_RULE_IDS.effect_class, `policy.effect/${effectClass}`],
      `effect class ${effectClass} is allowed only when the resource scope matches, and it does not`,
      bundleSha256,
    );
  }

  // ---- Step 6: the tier rule --------------------------------------------
  //
  // "tier ≥ R3 on approve/merge-class actions ⇒ `REQUIRE_APPROVAL
  // (security-scope)`."
  //
  // The tier rule has two clauses, and they fire on different actions:
  //
  // * `approveActions` — on approve/merge-class actions, the action that
  //   *grants* authority. An R3 change needs a security-scoped approval
  //   before it can be approved.
  // * `agentChange` — on an agent-initiated **change** at all. The pack's
  //   bundle has `R4: { agentChange: deny }`: blueprint 13 §5.3 says R4 is
  //   "human-only for the factory's own R4 paths", so an agent may not
  //   originate a change of that tier at all.
  const tier = valid.tier;
  if (tier !== undefined) {
    const tierRule = bundle.spec.tierRules[tier];

    if (tierRule?.agentChange === 'deny' && valid.actor.kind === 'agent') {
      return decision(
        'DENY',
        [ENGINE_RULE_IDS.tier_rule, `policy.tier/${tier}`],
        `tier ${tier} forbids an agent-initiated change`,
        bundleSha256,
      );
    }

    if (isApproveMergeAction(valid.action) && tierRule?.approveActions === 'requireApproval-security') {
      return decision(
        'REQUIRE_APPROVAL',
        [ENGINE_RULE_IDS.tier_rule, `policy.tier/${tier}`],
        `tier ${tier} requires a security-scoped approval for ${valid.action}`,
        bundleSha256,
        { type: TIER_APPROVAL_TYPE, scope: 'security' },
      );
    }
  }

  // ---- Step 7: the default ----------------------------------------------
  //
  // "Default ⇒ **`DENY(default)`**." checklist 02 trap 8: "Allowing by
  // default at the end of the algorithm. The default branch is `DENY`."
  //
  // The allow at step 5 is confirmed here, and only here: the effect rule
  // said this effect class is permitted, and no later rule objected. If the
  // effect class was one the bundle does not permit, the default denies.
  if (effectRule === 'allow' || effectRule === 'allowIfResourceScoped') {
    return decision(
      'ALLOW',
      [ENGINE_RULE_IDS.effect_class, `policy.effect/${effectClass}`],
      `effect class ${effectClass} is permitted and the action is within the grant`,
      bundleSha256,
    );
  }

  return decision(
    'DENY',
    [ENGINE_RULE_IDS.default],
    'no rule allowed the action, so it is denied by default',
    bundleSha256,
  );
};

/**
 * The AT-14 equivalent-effect check.
 *
 * Returns `undefined` when there is no equivalent-effect prior denial.
 */
const equivalentEffect = (
  input: PolicyInput,
): { readonly reason: string; readonly ruleIds: readonly string[] } | undefined => {
  const priorDenials = input.priorDenials;
  if (priorDenials === undefined || priorDenials.length === 0) {
    return undefined;
  }

  const effectClass = input.effectClass;
  const resourceKey = resourceKeyOf(input);
  if (effectClass === undefined || resourceKey === undefined) {
    return undefined;
  }

  const capabilityId = input.capabilityId;
  const equivalent = priorDenials.filter(
    (denial) =>
      denial.effectClass === effectClass &&
      denial.resourceKey === resourceKey &&
      (capabilityId === undefined || denial.capabilityId !== capabilityId),
  );

  if (equivalent.length === 0) {
    return undefined;
  }

  const via = equivalent.map((denial) => denial.capabilityId).join(', ');
  return {
    reason: `the same (${effectClass}, ${resourceKey}) effect was already denied via ${via}; the attempt is escalated to a human and is not executed`,
    ruleIds: equivalent.map((denial) => `policy.denied/${denial.capabilityId}`),
  };
};

/**
 * The identity of the resource an action targets.
 *
 * The AT-14 check compares `(effectClass, resourceKey)`, where the resource
 * key is the resource's identity — the repository plus the paths, or the
 * host. Two actions on the same resource have the same key; two actions on
 * different resources do not.
 */
export const resourceKeyOf = (input: PolicyInput): string | undefined => {
  const resource = input.resource;
  if (resource === undefined) {
    return undefined;
  }
  const paths = resource.paths ?? [];
  const pathPart = paths.length > 0 ? `:${[...paths].sort().join(',')}` : '';
  return `${resource.kind}:${resource.ref}${pathPart}`;
};

/**
 * Whether the resource scope matches, for the E2 effect rule.
 *
 * blueprint 11 §4.3: resource scope is "Does the capability's
 * `resourcePattern` match the *actual* resource being acted on?"
 *
 * The check is that the action names a resource at all, and that the
 * resource is one the grant's own scope covers. The grant check at step 4
 * has already established that the resource is inside the grant; this step
 * establishes that the resource is *specified*, because an external write
 * with no resource named is an unbounded external write.
 */
const resourceScopeMatches = (input: PolicyInput): boolean => {
  const resource = input.resource;
  if (resource === undefined) {
    return false;
  }
  // A resource with neither a path nor a host names nothing concrete.
  const hasPaths = (resource.paths ?? []).length > 0;
  const hasHost = resource.host !== undefined && resource.host.length > 0;
  return hasPaths || hasHost;
};

/**
 * Whether an action is "approve/merge-class" for the tier rule.
 */
const isApproveMergeAction = (action: string): boolean =>
  APPROVE_MERGE_ACTIONS.includes(action);

/**
 * The tier of a task, for the tier rule.
 */
export const tierOf = (input: PolicyInput): Tier | undefined => input.tier;

/**
 * Describe an error for the `engine_error` reason.
 *
 * The message must not leak anything sensitive, so it is the error's name
 * and message only — the engine's inputs are configuration, not secrets.
 */
const describe = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return `non-error thrown: ${String(error)}`;
};
