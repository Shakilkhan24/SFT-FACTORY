/**
 * Policy contracts — pack 03 §3 (the `// ---------- policy ----------`
 * block) and §4.7 (`PolicyBundle`).
 *
 * ```ts
 * export interface PolicyInput { action: string; capabilityId?: string; effectClass?: EffectClass; actor: Actor;
 *   taskId?: string; workflow: string; stage?: string; autonomy: Autonomy; tier?: Tier;
 *   resource?: { kind: string; ref: string; paths?: string[]; host?: string }; approvalId?: string; args?: unknown;
 *   priorDenials?: Array<{ effectClass: EffectClass; resourceKey: string; capabilityId: string }>; }   // AT-14 equivalent-effect check
 * export interface Decision { outcome: 'ALLOW'|'DENY'|'REQUIRE_APPROVAL'|'ESCALATE'; ruleIds: string[]; reason: string;
 *   bundleSha256: Sha256; requiredApproval?: { type: string; scope?: 'security' } }
 * export interface PolicyEngine { evaluate(input: PolicyInput, bundle: PolicyBundle): Decision }  // PURE, total, fail-closed
 * ```
 *
 * **The engine is pure, total and fail-closed** (pack 03 §3, checklist 02
 * T-1.05). "Pure: no `node:fs/net/child_process`, no `pg`, no network, no
 * clock, no randomness except injected. Enforced by `pnpm lint:deps`."
 *
 * The `PolicyBundle` schema below is the shape of `definition/policy-bundle.yaml`
 * (pack 03 §4.7) — the YAML is the source of truth for the *rules*; this
 * schema is the contract for their *shape*.
 */

import { z } from 'zod';

import { Actor, Autonomy, EffectClass, Sha256, Tier } from './shared.js';

/**
 * The resource an action targets.
 *
 * `resourceKey` is the identity used by the AT-14 equivalent-effect check:
 * the same `(effectClass, resourceKey)` reached through a different
 * capability is an escalation, not a second execution.
 */
export const PolicyResource = z
  .object({
    kind: z.string().min(1),
    ref: z.string().min(1),
    paths: z.array(z.string().min(1)).optional(),
    host: z.string().min(1).optional(),
  })
  .strict();

export type PolicyResource = z.infer<typeof PolicyResource>;

/**
 * The prior-denial record used by the AT-14 equivalent-effect check.
 *
 * pack 03 §3: "`priorDenials?: Array<{ effectClass: EffectClass;
 * resourceKey: string; capabilityId: string }>; // AT-14 equivalent-effect
 * check".
 */
export const PriorDenial = z
  .object({
    effectClass: EffectClass,
    resourceKey: z.string().min(1),
    capabilityId: z.string().min(1),
  })
  .strict();

export type PriorDenial = z.infer<typeof PriorDenial>;

/**
 * The policy input (pack 03 §3).
 */
export const PolicyInput = z
  .object({
    action: z.string().min(1),
    capabilityId: z.string().min(1).optional(),
    effectClass: EffectClass.optional(),
    actor: Actor,
    taskId: z.string().min(1).optional(),
    workflow: z.string().min(1),
    stage: z.string().min(1).optional(),
    autonomy: Autonomy,
    tier: Tier.optional(),
    resource: PolicyResource.optional(),
    approvalId: z.string().min(1).optional(),
    args: z.unknown().optional(),
    priorDenials: z.array(PriorDenial).optional(),
  })
  .strict();

export type PolicyInput = z.infer<typeof PolicyInput>;

/**
 * The decision outcomes.
 *
 * pack 03 §2 (`policy_decisions.outcome` CHECK constraint):
 * `('ALLOW','DENY','REQUIRE_APPROVAL','ESCALATE')`.
 */
export const DecisionOutcome = z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'ESCALATE']);

export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

/**
 * The required-approval descriptor carried on a `REQUIRE_APPROVAL` decision.
 */
export const RequiredApproval = z
  .object({
    type: z.string().min(1),
    scope: z.literal('security').optional(),
  })
  .strict();

export type RequiredApproval = z.infer<typeof RequiredApproval>;

/**
 * The decision (pack 03 §3).
 *
 * `ruleIds` lists **every** matched rule id, not just the first — the
 * checklist 02 T-1.05 algorithm step 2 says "DENY listing **every** matched
 * rule id".
 */
export const Decision = z
  .object({
    outcome: DecisionOutcome,
    ruleIds: z.array(z.string().min(1)),
    reason: z.string().min(1),
    bundleSha256: Sha256,
    requiredApproval: RequiredApproval.optional(),
  })
  .strict();

export type Decision = z.infer<typeof Decision>;

/**
 * The deny-rule condition (pack 03 §4.7).
 *
 * Every field is optional: a rule matches when **all** of its present fields
 * match. A rule with no fields matches everything, which is why an empty
 * deny rule is a config error the bundle schema cannot catch — the policy
 * engine's own tests do.
 */
export const DenyCondition = z
  .object({
    capability: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    actorKind: z.enum(['human', 'agent', 'system', 'integration']).optional(),
    autonomyBelow: Autonomy.optional(),
    pathsMatch: z.string().min(1).optional(),
    hostClass: z.array(z.string().min(1)).optional(),
    scope: z.string().min(1).optional(),
    effectClass: EffectClass.optional(),
    tier: Tier.optional(),
  })
  .strict();

export type DenyCondition = z.infer<typeof DenyCondition>;

/**
 * A deny rule (pack 03 §4.7).
 */
export const DenyRule = z
  .object({
    id: z.string().min(1),
    when: DenyCondition,
  })
  .strict();

export type DenyRule = z.infer<typeof DenyRule>;

/**
 * The effect-class rules (pack 03 §4.7).
 *
 * `effectRules: { E0: allow, E1: allow, E2: allowIfResourceScoped, E3:
 * requireApproval, E4: requireApproval }`.
 */
export const EffectRuleValue = z.enum([
  'allow',
  'allowIfResourceScoped',
  'requireApproval',
]);

export type EffectRuleValue = z.infer<typeof EffectRuleValue>;

export const EffectRules = z
  .object({
    E0: EffectRuleValue.default('allow'),
    E1: EffectRuleValue.default('allow'),
    E2: EffectRuleValue.default('allowIfResourceScoped'),
    E3: EffectRuleValue.default('requireApproval'),
    E4: EffectRuleValue.default('requireApproval'),
  })
  .strict();

export type EffectRules = z.infer<typeof EffectRules>;

/**
 * The tier rules (pack 03 §4.7).
 *
 * `tierRules: { R3: { approveActions: requireApproval-security }, R4:
 * { agentChange: deny } }`.
 */
export const TierRule = z
  .object({
    approveActions: z.enum(['requireApproval-security']).optional(),
    agentChange: z.enum(['deny', 'requireApproval-security']).optional(),
  })
  .strict();

export type TierRule = z.infer<typeof TierRule>;

export const TierRules = z
  .object({
    R0: TierRule.optional(),
    R1: TierRule.optional(),
    R2: TierRule.optional(),
    R3: TierRule.optional(),
    R4: TierRule.optional(),
  })
  .strict();

export type TierRules = z.infer<typeof TierRules>;

/**
 * The policy bundle (pack 03 §4.7) — the shape of
 * `definition/policy-bundle.yaml`.
 *
 * `default: deny` is not a field with a default; it is **required** and must
 * be `deny`. checklist 02 trap 8: "Allowing by default at the end of the
 * algorithm. The default branch is `DENY`."
 */
export const PolicyBundle = z
  .object({
    apiVersion: z.literal('factory/v1'),
    kind: z.literal('PolicyBundle'),
    spec: z
      .object({
        denyRules: z.array(DenyRule).default([]),
        protectedPaths: z.array(z.string().min(1)).default([]),
        effectRules: EffectRules.default({
          E0: 'allow',
          E1: 'allow',
          E2: 'allowIfResourceScoped',
          E3: 'requireApproval',
          E4: 'requireApproval',
        }),
        tierRules: TierRules.default({}),
        default: z.literal('deny'),
      })
      .strict(),
  })
  .strict();

export type PolicyBundle = z.infer<typeof PolicyBundle>;

/**
 * The policy engine interface (pack 03 §3).
 *
 * PURE, total, fail-closed: it returns a `Decision` for every input and
 * never throws.
 */
export interface PolicyEngine {
  evaluate(input: PolicyInput, bundle: PolicyBundle): Decision;
}

/**
 * The reasons the engine can produce.
 *
 * The names are the `reason` strings of the seven-step algorithm in
 * checklist 02 T-1.05. They are contractual: the invariant tests and the
 * Health surface both key off them.
 */
export const POLICY_REASONS = [
  'invalid_input',
  'deny_rule',
  'equivalent_effect',
  'autonomy',
  'no_grant',
  'effect_class',
  'tier_rule',
  'default',
  'engine_error',
] as const;

export type PolicyReason = (typeof POLICY_REASONS)[number];

/**
 * The rule id recorded for a decision made by the algorithm itself rather
 * than by a rule in the bundle.
 */
export const ENGINE_RULE_IDS: Readonly<Record<PolicyReason, string>> = {
  invalid_input: 'policy.engine/invalid-input',
  deny_rule: 'policy.engine/deny-rule',
  equivalent_effect: 'policy.engine/equivalent-effect',
  autonomy: 'policy.engine/autonomy',
  no_grant: 'policy.engine/no-grant',
  effect_class: 'policy.engine/effect-class',
  tier_rule: 'policy.engine/tier-rule',
  default: 'policy.engine/default',
  engine_error: 'policy.engine/error',
};
