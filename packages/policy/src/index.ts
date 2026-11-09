/**
 * `policy` — the deterministic policy engine (T-1.05).
 *
 * pack 02 §3: "`policy` … are **pure**: no `node:fs/net/child_process`, no
 * `pg`, no network, no clock/randomness except injected." The dependency
 * rules enforce it (`pure-packages-have-no-io`), and the rule is why
 * `definition/policy-bundle.yaml` is *read* elsewhere: the engine takes an
 * already-parsed bundle.
 *
 * **What is here.** The seven-step fail-closed algorithm (pack 02 §4.4), the
 * deny-rule matcher, the grant check, the glob matcher for the protected-path
 * set, and the bundle digest.
 *
 * **What is not here.** Loading the YAML (that is I/O, so it lives in the
 * definition loader), and persisting the decision (`policy_decisions` is
 * written by the orchestrator).
 *
 * The engine is the **security core** of the factory: blueprint 13 §2.3's
 * "deny by default and escalate", and SG-12's "the failure mode of the
 * policy engine is deny".
 */

export {
  denyRules,
  effectRules,
  loadPolicyBundle,
  policyBundleSha256,
  protectedPaths,
  tierRules,
  type LoadedPolicyBundle,
} from './bundle.js';

export {
  evaluate,
  resourceKeyOf,
  tierOf,
  type PolicyEvaluationContext,
} from './engine.js';

export {
  matchDenyRules,
  ruleMatches,
  touchesProtectedPath,
  type DenyEvaluationContext,
  type DenyMatchResult,
} from './deny-rules.js';

export {
  checkEffectiveGrant,
  checkGrant,
  resourceInScope,
  scopeAllowed,
  type EffectiveGrant,
  type GrantCheckResult,
} from './grants.js';

export { matchesAnyGlob, matchesGlob } from './glob.js';

export {
  DefaultPolicyEngine,
  type PolicyEngineImplementation,
} from './engine-class.js';
