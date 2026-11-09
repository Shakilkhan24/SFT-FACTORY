# ADR-0023 — Routing is configuration only, and the gateway refuses unknown models

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

Routing decisions must be auditable and changeable without a code change, and the factory must not
depend on the continued existence of any particular model. Both point the same way: routing is data.

The corollary is a hard requirement: a configuration file naming a model the gateway does not know
must fail closed, not silently fall back.

## Decision

Routing is **configuration only** (`routing-policy.yaml`).

1. Model names in configuration are **examples**, and are `[VERIFY]`-checked against the provider's
   current model list at startup.
2. The gateway **refuses unknown models**. It does not fall back to a default.
3. The second provider is an OpenAI-compatible adapter.
4. `FakeProvider` is used in CI.
5. The **failover test is a required check** — failover is a property that must be proven, not assumed.

### Scope limits

This ADR does not decide the per-class thresholds that are tuned from data (Q-16), nor the per-task
budget arithmetic, nor which provider is primary for a given task class.

## Consequences

**Positive**
- Routing changes need no code review and no release, so a threshold can be tuned from measurement within the plan rather than at the end of it.
- Refusing unknown models means a typo in configuration fails loudly at startup instead of silently degrading every task's quality.
- The configuration is a single readable file, which makes the routing policy reviewable in the same way as any other definition.

**Negative**
- The routing policy becomes a hot file: a policy change can alter the cost and the quality of every task at once.
- `FakeProvider` in CI means the CI path does not exercise the real provider's response format, so a provider-side format change is not caught by the fast suite.
- Startup-time model-list verification adds a dependency on the provider being reachable before the factory can start.

**Neutral**
- Model names, prices and provider hostnames appear in configuration and never in code (HR-10).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Hard-code routing in TypeScript | Every threshold tweak becomes a code change, a review and a release, and the hot path for cost control is the slowest path in the system. |
| A model call chooses the model | Non-deterministic, unauditable, and it lets a routing decision be influenced by the content it is routing — including untrusted text. |
| Let the gateway fall back to a default on an unknown model | A typo silently sends every task to one model at one price, and nothing in the logs says so. |

## Validation

- The startup check fails when a configured model is not on the provider's current list, and the failover test is a required CI check.
- If model availability changes faster than the startup check can track, the check's refresh interval is revisited rather than removed.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0023)
- Related: ADR-0017 (executor kinds), ADR-0024 (notifications)
