# ADR-0004 — Split deterministic policy authority from probabilistic orchestration authority

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Security
- **Evidence class:** [E2] synthesis of V07 (control plane), V09 (declaration), V11 (harness as privilege-bearing artefact), V15 (context integrity)
- **Supersedes:** none

---

## Context

In any agentic system, some decisions must be made by a probabilistic component (an LLM orchestrator deciding how to decompose a task, which tool to call next, whether the output looks acceptable) and some must be made deterministically (is this action permitted? is this workflow within its autonomy level? does this change exceed the blast-radius threshold? is this credential still valid?).

If a single component holds both kinds of authority, then the probabilistic component's authority is bounded only by the determinist's *absence* rather than by its *presence*. The most consequential mistake an orchestrator can make — issuing an instruction that exceeds its authority — becomes invisible, because the same component that made the mistake is also the one that would have had to object.

No source in the corpus states this explicitly. V07's architecture implies it; V11's observation that the harness is privilege-bearing implies it; V15's context-integrity work implies it. The corpus is also **silent on prompt injection** — the threat in which untrusted content read by an agent becomes an instruction the agent obeys.

## Decision

The control plane separates two kinds of authority, and **no single component holds both**:

### 1. Deterministic policy authority

Implemented as **policy as code** in the control plane. Policy makes every consequential decision:

- Is this workflow permitted to perform this action, at this autonomy level?
- Is this tool within the granted scope for this workflow?
- Does this change exceed the blast-radius threshold for automatic handling?
- Is this credential valid and scoped to this task?
- Does this content originate from an untrusted source, and is it therefore quarantined?

Policy is versioned, reviewed (as part of the factory definition, ADR-0001), deterministic, and **cannot be overridden by an agent's judgement**. A policy decision is fast, cheap, and auditable.

### 2. Probabilistic orchestration authority

The orchestrator agent decides *how* to achieve a goal that policy has already authorised: decomposition, sequencing, tool selection within scope, retry strategy, and interpretation of unstructured output. It **cannot** widen its own scope, escalate its autonomy level, mint credentials, or bypass a gate.

### 3. The arbitration rule

Where orchestration proposes an action and policy is uncertain, the resolution is **deny by default and escalate**, not "let the orchestrator try and see". Specifically:

- An action not enumerated in the workflow's granted capability set → denied, task fails to a human.
- An action in scope but not enumerated in policy's allow-list for the current state → escalated to an approval access point.
- An action explicitly denied by policy → denied, permanently, and the attempt is recorded as a security event.

### 4. Untrusted content is data, never instruction

Content originating from outside the trusted boundary — issue text, PR descriptions, code comments, documentation, web pages, dependency files, external tool output — is **tagged untrusted** and passed to agents inside a marked envelope. The content may be quoted, analysed, or summarised; it may never be treated as an instruction. Where an agent must act on untrusted content, the acting decision is made by the orchestrator under policy, not by the content.

This is the blueprint's principal contribution in response to a threat **no source in the corpus addresses**, and it is [E3] engineering judgement rather than a source finding.

## Consequences

**Positive**
- An orchestrator hallucination, misparse, or injection cannot produce an unauthorised action, because authorisation is not the orchestrator's to give.
- Policy changes are reviewable diffs in the factory definition, and the audit trail is a by-product.
- The deterministic path is fast and cheap; the LLM is used only where judgement is genuinely required.
- Untrusted-content tagging means a prompt injection is contained by construction rather than detected by inspection.

**Negative**
- Every tool call requires a policy evaluation — a real latency and complexity cost. Mitigation: policy evaluation is a cheap deterministic function; results are cached per (workflow, capability, resource) for the duration of a task.
- Policy authoring is a substantial skill. It is a first-class product surface with its own review, versioning, and test suite.
- The untrusted-content rule requires that agents are instructed not to follow embedded instructions, which is a probabilistic mitigation inside a deterministic boundary. The boundary is the real control; the instruction is defence in depth.

**Neutral**
- The policy schema and evaluation point are specified in `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md`.
- The threat model is specified in the same document; it is explicitly marked as [E3].

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Single orchestrator with full authority, gated only by a final approval | The approval gate is the only control, so the entire system's safety depends on that one step, and the orchestrator's failure modes are unconstrained until it reaches the gate. |
| Deterministic workflow engine for all logic | Would forbid the flexibility that makes agent work valuable (unstructured interpretation, novel decomposition). Rejected; policy governs *authority*, not method. |
| Trust the model | Directly contradicted by V14's evidence and by the general unreliability of probabilistic components. |
| Detect injection by scanning content for instruction-like text | Unreliable and evadable; the content can be in a diff, a test fixture, a base64 blob, or a filename. Rejected in favour of structural quarantine. |

## Validation

- The policy evaluation point must be un-bypassable: a test must demonstrate that a direct call to a data-plane capability without a policy decision fails.
- Policy must be independently unit-tested against a suite of adversarial cases (denied action, scope escalation, untrusted-content injection attempt).
- Every denial and escalation must appear in the event log with the policy rule that produced it.
- A red-team exercise is specified in `14_QUALITY_TESTING_AND_EVALUATION.md`.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-56, D-53, D-39, plus §4 gaps (prompt injection, secret scoping)
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-7, §8.4
- Related: ADR-0002, ADR-0005, ADR-0007
