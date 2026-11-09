# 10 — Production deployment, backups and observability

> **Phase W7 (4 days) · Tickets T-6.01 … T-6.03**
>
> Three tickets that move the factory out of the developer's machine and onto a real
> host, and then make it visible when things go wrong.
>
> **The security posture of this phase is the whole point.** The factory holds a GitHub
> App key and drives rootless Docker. Its deployment must make it impossible for the
> sandbox to reach the control plane.

---

## PREREQUISITES

* Checklist 06 complete (secret scanning), checklist 07 complete (the fault suite runs
  against the production compose topology in checklist 13).
* T-0.01's D3 (hosting) is answered.
* A Linux VM with rootless Docker (≥4 vCPU / 8 GB), Postgres 16+ with PITR, and an
  S3-compatible bucket with versioning.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-6.01 | `factory doctor --prod` green; **only `/webhooks/github` is reachable publicly** (an external probe); no docker socket in any container; secrets absent from `docker inspect` of T2 containers | R-G |
| T-6.02 | the RTO is measured and recorded; the hash chains verify after the restore | R-G |
| T-6.03 | each alert **fires in a drill** | R-G |

---

## STAGE 1 — The work

### T-6.01 · Production deployment · W7 · L · R3

**Open ONLY:** pack `04` §7 + §10, pack `01` §6 ADR-0025.

**Build:** the VM provisioning notes, the production compose, Caddy, the worker systemd
unit, rootless Docker, the networks, the sops secrets, the DB roles, bucket versioning,
private access, and `factory doctor --prod`.

**The deployment topology** (pack `02` §7):

* **Caddy** terminates TLS and routes **only `/webhooks/github` publicly**. Everything
  else is reachable over the private network only (VPN/tunnel).
* The **worker** runs as a non-root systemd service that owns the rootless Docker
  socket. **Never mount the socket into a container.**
* The `sandbox` Docker network is `internal: true`; it holds the T2 task containers,
  the gateway passthrough and the egress proxy.
* Postgres (with PITR) and the S3-compatible bucket (versioned) sit outside the sandbox.
* **DB roles:** `factory_owner` (migrations), `factory_app`, `factory_projector`,
  `factory_applier`, `factory_edge`, `factory_readonly`.
* Secrets via sops+age (or a cloud manager), decrypted into the service environment at start.
* Dev uses `docker compose` (Postgres, MinIO, the apps); prod uses the same images.

**The three hard checks:**

1. **Only `/webhooks/github` is publicly reachable** — verify with an **external probe**,
   not from inside the network.
2. **No docker socket in any container.**
3. **Secrets absent from `docker inspect`** of the T2 containers.

---

### T-6.02 · Backups and restore drill · W7 · M · R2

**Open ONLY:** pack `01` §1.2 (PRD-6).

**Build:** the Postgres PITR/dump schedule, bucket versioning + lifecycle, the restore
script, and the drill on a clean host.

**The drill is the deliverable, not the backup.** Restore → rebuild the projections →
verify the hash chains → smoke a task. Record the **RTO** (suggested ≤ 4 h).

> A backup that has never been restored is a hypothesis, not a backup. The PRD-6 row is
> "restore drill on a clean host within the owner's RTO" — the *drill*, not the schedule.

---

### T-6.03 · Self-observability and alerts · W7 · M · R2

**Open ONLY:** blueprint `15` §3.

**Build:** structured logs, Prometheus metrics, and alerts for:

`tool.denied` · `net.egress.denied` · `policy.denied` spikes · an event gap or chain
break · stuck leases · projection staleness · the spend rate · a budget breach ·
webhook rejects · orphan credential leases.

**Every alert must fire in a drill.** An alert that has never fired is an untested
assumption about your observability.

---

## STAGE 2 — Review

Standard reviewer pass. T-6.01 is **R3** and the owner probes the public surface
personally — from outside the network, not from the dashboard.

---

## GATE ROWS — evidence produced here, closed at the PRR

This phase produces the **evidence** for four G4 rows. The rows themselves are
**closed** at the production readiness review in checklist 13, against that evidence.

| Row (closed later) | Statement | Closed in |
|---|---|---|
| CL-G4-11 🔒 | Only `/webhooks/github` is publicly reachable (external probe); the dashboard/API are private | checklist 13 |
| CL-G4-05 🔒 | Zero secret findings; no long-lived credential reachable from any T2 container | checklist 13 |
| CL-G4-06 | Restore drill on a clean host within the owner's RTO; the chains verify | checklist 13 |
| CL-G4-08 | The overview answers "doing / needs me" in ≤2 clicks; the kill switch halts intake, the scheduler and the harness ≤10 s; the alerts fire in drills | checklist 13 |

---

## EXIT CRITERIA — before checklist 11

- [ ] `factory doctor --prod` is green.
- [ ] An **external** probe confirms that only `/webhooks/github` responds publicly.
- [ ] No container has the docker socket mounted.
- [ ] `docker inspect` of a T2 container shows no secret.
- [ ] The restore drill ran on a clean host; the RTO is measured and recorded; the hash
      chains verify after the restore.
- [ ] Every alert fired at least once in a drill.
- [ ] The kill switch halts intake, the scheduler and the harness within 10 s.

---

## TRAPS

1. **Probing the public surface from inside the private network.** It will always look
   fine. The probe must come from outside.
2. **Mounting the docker socket into a container** "so the worker inside can manage
   sandboxes". That is container escape by configuration. The worker runs on the host
   and drives the docker CLI.
3. **Believing the backup is the deliverable.** The drill is. Run it on a genuinely
   clean host.
4. **Adding alerts and never testing them.** The dashboard becomes a picture of a
   system nobody has watched fail.
5. **Exposing the dashboard on a public port with a password.** It is on a private
   network. A password is not a network boundary.
6. **Deploying with a wide-open S3 bucket policy** or without versioning. Bucket
   versioning is what makes a bad write recoverable.
7. **Leaving the sops key on the host in plaintext.** The secret file is decrypted into
   the service environment at start; the key material itself is not on the box.
