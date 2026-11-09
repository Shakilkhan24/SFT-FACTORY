# ADR-0024 — Approval decisions come from the access points; notifications come from a generic webhook

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

Approval is the one place where the factory's authority is exercised, so where the decision comes
*from* is a security property, not a UX preference. A decision delivered through a chat channel has
no verified author, no authenticated transport and no durable record of who decided what — which means
the provenance that the blueprint requires for every approval cannot be established.

Notifications have the opposite requirement: they must reach the owner wherever they are, and they
must never be able to *decide* anything.

## Decision

1. **Approval decisions** are made only via the **authenticated access points** — the dashboard or the
   CLI. Never by replying in chat, never by a webhook, never by an email.
2. **Notifications** (the "needs you" pings) go through a **generic webhook adapter** — Slack,
   Telegram, Discord or email — chosen later. The adapter is notification-only: it carries a link to
   the access point, and it has no path to record a decision.

### Scope limits

This ADR does not decide which notification provider, nor whether a second provider is run in
parallel, nor the retry and escalation policy for a notification that is never delivered. It does not
decide the access point's authentication mechanism beyond the requirement that it is authenticated.

## Consequences

**Positive**
- Every approval has a verified author and a durable record, because it was made inside an authenticated system that logs it.
- The chat channel is safe to use for discussion: a comment carrying an instruction has no path to the authority, so prompt injection through comments cannot grant an approval.
- The notification adapter is swappable, so the owner is not locked into one chat vendor.

**Negative**
- The owner must open the dashboard or CLI to approve anything, even when a notification is sitting in the chat they already have open.
- An approval round-trip is longer than a chat reply, which adds latency to every gated change.
- A generic webhook adapter means notifications can be silently dropped by a provider outage, and the owner may not learn that a decision is waiting.

**Neutral**
- The GitHub App is not subscribed to `issue_comment` or `pull_request_review_comment`, so comment text is not a channel in the first place.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Approve by replying in chat | The approval's author is unverifiable and the decision leaves no durable provenance record — the exact property the blueprint requires. |
| Approve by comment on the pull request | Same problem, and it also creates an instruction channel from untrusted issue text. |
| A single hard-wired notification provider | Simpler, but it makes a vendor choice a structural dependency with no swap path. |

## Validation

- The access-point API rejects an approval that did not arrive through an authenticated access point, and the route inventory contains no other approval path.
- If the review latency proves to be the binding constraint on throughput, this ADR is revisited by adding an authenticated path — not by loosening the provenance requirement.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0024)
- Related: ADR-0016 (merge model), ADR-0002 (blueprint no-chat-channel)
