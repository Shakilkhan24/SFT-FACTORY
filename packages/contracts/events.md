# Event vocabulary

The registered event types for v1, and the provenance of each.

pack 03 §5:

> v1 uses the blueprint's 61-type vocabulary [BP: 09 §4.3] plus the **pack
> additions** below (each addition must be listed in `packages/contracts/events.md`
> — adding an event without an entry fails the contract test).

The contract test (`tests/unit/contracts.test.ts`, case A1.19) asserts that
every pack addition appears in this file. An event type added to
`EVENT_TYPES` without an entry here fails CI.

## The rule that governs every row

* **Schema versioning is mandatory** (pack 03 §1, Versioning row; blueprint
  `09` §4: "The schema is versioned; fields may be added, never
  repurposed"). The event log and the run-artefact store are **historical
  records** — an event written in 2026 must still parse in 2030.
* An event carries **both** `actor` and `authority` (invariant I-3; pack 03
  §2 makes `authority jsonb NOT NULL` for every row).
* Payload shapes are Zod-validated and registered by `eventType@schemaVersion`
  (pack 03 §5). The minimum fields below are the contract.

## Blueprint vocabulary — 61 types (blueprint `09` §4.3)

| Group | Event types |
|---|---|
| Intake | `intent.recorded`, `intent.rejected`, `request.triaged`, `request.classified` |
| Specification | `spec.refined`, `spec.accepted`, `spec.escalated`, `spec.criteriaAdded` |
| Planning | `plan.produced`, `plan.validated`, `plan.rejected`, `plan.replanned` |
| Execution | `node.ready`, `node.leased`, `node.executionStarted`, `stage.completed`, `stage.failed`, `stage.incomplete`, `tool.invoked`, `tool.denied`, `tool.failed`, `model.requested`, `model.failed`, `model.failedOver` |
| Verification | `gate.started`, `gate.passed`, `gate.failed`, `verification.blocked`, `calibration.completed` |
| Review | `review.queued`, `review.opened`, `review.commentAdded`, `review.approved`, `review.rejected`, `review.deferred`, `review.escalated` |
| Integration | `change.merged`, `change.mergeFailed`, `release.deployed`, `release.failed`, `release.rolledBack` |
| Governance | `policy.allowed`, `policy.denied`, `policy.escalated`, `approval.requested`, `approval.granted`, `approval.expired`, `approval.revoked`, `autonomy.promoted`, `autonomy.revoked` |
| Improvement | `proposal.created`, `proposal.evaluated`, `proposal.approved`, `proposal.rejected`, `harness.changeRolledBack` |
| System | `definition.applied`, `definition.driftDetected`, `environment.provisioned`, `environment.cleaned`, `budget.exhausted`, `run.replayed` |

## Pack additions

These are the additions pack 03 §5 lists with the `[PACK]` marker. Each one
is a **pack** addition, not a blueprint one, and each needs an entry here.

| Event type | Why it exists | Minimum payload fields |
|---|---|---|
| `webhook.received` | An inbound webhook was accepted and verified. pack 03 §5. | — |
| `webhook.rejected` | An inbound webhook failed verification. **Security event.** pack 03 §5. | — |
| `oracle.constructed` | An acceptance oracle was built. pack 03 §5. | `oracleId`, `route`, `manifestSha256`, `author`, `implementationRunId` |
| `oracle.admitted` | An oracle passed admission against the pre-change report. pack 03 §5. | `oracleId`, `beforeReportSha256`, `perCheck` |
| `oracle.admissionFailed` | An oracle failed admission. pack 03 §5. | `oracleId`, `mismatches` |
| `patch.extracted` | A patch was extracted from a stage run. pack 03 §5. | `runId`, `files`, `bytes`, `patchSha256` |
| `patch.rejected` | A patch was rejected. **Security event.** pack 03 §5. | `reasons` |
| `gate.weakeningDetected` | A gate's strength degraded between runs. pack 03 §5. | `signals`, `tierRaisedTo` |
| `change.opened` | A pull request was opened. pack 03 §5. | `changeId`, `prNumber`, `branch`, `baseSha`, `headSha` |
| `change.updated` | A change's head moved. pack 03 §5. | — |
| `credential.minted` | A scoped credential was minted. pack 03 §5. | `credId`, `provider`, `scope`, `expiresAt` |
| `credential.revoked` | A credential was revoked. pack 03 §5. | `credId`, `reason` |
| `net.egress.denied` | A network egress was refused. **Security event.** pack 03 §5. | `envId`, `host`, `port`, `reason` |
| `net.egress.summary` | A per-environment egress roll-up. pack 03 §5. | `envId`, `hosts` |
| `kill.switch.engaged` | The kill switch was engaged. pack 03 §5. | `by`, `reason` |
| `kill.switch.released` | The kill switch was released. pack 03 §5. | `by`, `reason` |

### `node.duplicateExecution`

Recorded when a node's handler runs twice because a lease expired
(blueprint `09` §3: "A duplicate execution after lease expiry is detected by
the scheduler and recorded as `node.duplicateExecution`, and the first
committed result wins").

It appears in blueprint `09` §3 but not in the `09` §4.3 vocabulary table,
so it is registered here as a pack addition.

| Event type | Why it exists | Minimum payload fields |
|---|---|---|
| `node.duplicateExecution` | A node was executed twice for one lease. | `nodeId`, `attempt`, `winnerRunId` |

## Security events

pack 03 §5: "`tool.denied`, `policy.denied`, `net.egress.denied`,
`patch.rejected`, `webhook.rejected` are **security events**: counted,
alerted on, shown on the Health region."

| Event type | In the blueprint vocabulary? | In the pack additions? |
|---|---|---|
| `tool.denied` | yes (`09` §4.3) | — |
| `policy.denied` | yes (`09` §4.3) | — |
| `net.egress.denied` | no | yes |
| `patch.rejected` | no | yes |
| `webhook.rejected` | no | yes |

`SECURITY_EVENT_TYPES` in `packages/contracts/src/event-log.ts` is the
machine-readable form of this table.
