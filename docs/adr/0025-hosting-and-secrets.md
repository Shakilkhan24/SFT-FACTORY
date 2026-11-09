# ADR-0025 — One Linux VM with rootless Docker; sops+age for secrets

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The factory's trust boundary is the runner host: it executes untrusted repository code, so the host's
configuration is what separates a contained failure from a compromised control plane. The pack's
choice of a single VM with rootless Docker is the smallest footprint that keeps the sandbox off the
control plane's trust path.

The corpus also names the trigger for splitting them: the first workflow that handles untrusted
content.

## Decision

**Runner host.** A Linux VM with rootless Docker (≥4 vCPU / 8 GB).

**Data.** Postgres 16+ with PITR (managed, or pgBackRest / WAL-G). An S3-compatible bucket with
versioning.

**Edge.** Caddy for TLS. The dashboard sits on a **private network** (VPN or tunnel); only
`/webhooks/github` is public.

**Secrets.** sops + age, or a cloud secret manager.

### Scope limits

This ADR does not decide the cloud provider, the managed-Postgres vendor, or the bucket vendor — all
are adapters (ADR-0027). It does not decide the PITR retention window or the backup verification
schedule, which are in the production-readiness checklist.

## Consequences

**Positive**
- One host with rootless Docker is the smallest configuration that keeps untrusted code execution off the control plane.
- Managed Postgres with PITR removes the operator's job of proving backups work — which, without PITR, is the single most commonly skipped operational task.
- A private dashboard with one public webhook endpoint minimises the exposed surface of the factory's authority.
- sops + age keeps encrypted secrets in git, so the secret store is versioned and reviewable without a second system.

**Negative**
- A single host is a single point of failure: a host loss stops the factory and takes the database with it unless PITR is exercised.
- The 4 vCPU / 8 GB floor is a sizing assumption, not a measurement; real concurrency needs may exceed it, and the constraint is imposed by the isolation design.
- A private dashboard means the owner needs the VPN or tunnel running to see anything — an availability cost paid on the most common path.
- sops + age requires the owner to be able to run `age` wherever they decrypt, which adds friction to every manual operation.

**Neutral**
- PostgreSQL is the one fixed infrastructure dependency; everything else sits behind an adapter.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Kubernetes for the runner pool | Explicitly forbidden by HR-6, and disproportionate to a two-to-four-person team with a single owner. |
| Managed containers for the runner | Would put the sandbox on a shared control plane, which is exactly the boundary the design keeps it away from. |
| A separate runner host from day one | The safer end of the trade-off, paid for before there is untrusted-content handling to justify it. The split is the documented trigger, not a default. |
| A cloud secret manager instead of sops + age | Also acceptable; the choice is recorded in D8 and either satisfies the requirement. |

## Validation

- A restore from the PITR backup is rehearsed and the runner host is confirmed to be running rootless Docker with the no-`docker.sock` rule in place.
- The first workflow handling untrusted content forces the runner/control-plane split, regardless of this ADR's status.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0025)
- Related: ADR-0020 (isolation), ADR-0027 (adapters)
