# ADR-0018 — Use a GitHub App with per-task installation tokens; no PATs

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The factory acts on a real repository with real write permissions, so its credentials are the highest-
value secret in the system and the most attractive to leak. The corpus is unambiguous about the
failure it must prevent: a credential that lives longer than the task and is broader than the task is
a standing capability for whoever obtains it.

The pack also names the consequence of getting this wrong in one sentence — a leaked App credential
can rewrite a repository's CI, which is how a compromise becomes a supply-chain event.

## Decision

Credentials are a **GitHub App** with **per-task installation tokens**.

1. No PATs. No long-lived tokens of any kind.
2. A token is minted per task, **narrowed to the single repository** and to the **minimum permissions
   for that stage** (`contents:read` for read-only stages; write permissions only where the stage
   writes).
3. The token lives inside the broker step that uses it. `git push` authenticates via `GIT_ASKPASS`
   reading a one-shot environment variable — the token never appears in argv, in a URL, in logs or in
   events.
4. At the terminal state (and by the reaper), the token is revoked via
   `DELETE /installation/token` and the lease is marked revoked.
5. Human login is via GitHub OAuth with an owner allow-list.

### Scope limits

This ADR does not decide the App's exact permission set — that is recorded in ADR-0018's companion
note in `docs/stack-profile.md` and in the checklist's T-0.01 row, and it is verified against GitHub's
current App settings by spike S-2. It does not decide the secret *storage* mechanism (that is D8 /
ADR-0025's sops+age).

## Consequences

**Positive**
- A leaked token expires with the task, so the blast radius of a leak is one task on one repository rather than the whole account.
- Narrowing permissions per stage means a read-only stage physically cannot push, even if it were compromised.
- The token never enters argv or logs, so the ordinary log-scrubbing path cannot miss it.

**Negative**
- Token minting adds a round trip to every task, and a token that expires mid-task must be re-minted — a failure mode that is invisible until it bites.
- A revoked token cannot be used to audit what happened during the task, so forensic questions about a completed task cannot be answered with the credential.
- The App must be installed on the target repository by the owner, which is a manual step that blocks the first automated run.

**Neutral**
- The `GIT_ASKPASS` mechanism is standard git behaviour, so it does not require a custom git wrapper.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Personal access tokens | Long-lived, broad, and the credential type that turns any leak into a repository compromise. Explicitly rejected. |
| A single long-lived App installation token | Better than a PAT but still a standing credential; the per-task narrowing is the whole point of the design. |
| OAuth user tokens for the agent | Would grant the agent the owner's authority, collapsing the separation between the factory and the person reviewing it. |
| Short-lived OIDC tokens from a CI provider | Viable where the CI provider is trusted, but it couples the factory's trust path to that provider and complicates the local-development path. |

## Validation

- The capability registry contains no credential that outlives a task, and the integration test proves a token is revoked at the terminal state.
- If the owner needs the factory to run unattended for longer than a token lifetime and re-minting proves unreliable, this ADR is revisited rather than the token lifetime quietly extended.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0018)
- Related: ADR-0016 (merge model), ADR-0025 (hosting and secrets)
