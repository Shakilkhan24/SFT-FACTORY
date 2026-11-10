/**
 * `definition` — the drift **job**.
 *
 * pack 02 §4.1: "Drift job (nightly): compare the applied bundle to the git
 * SHA it claims; emit `definition.driftDetected`; **never auto-correct**
 * (FR-26)."
 *
 * ## The job, as opposed to the check
 *
 * `drift.ts` holds the *pure* half: it compares two bundles and reports what
 * it finds. This module holds the half that **acts** — it reads the applied
 * version, runs the check, and appends the `definition.driftDetected` event
 * to the log.
 *
 * The split matters because of what the job must *not* do. The job writes
 * exactly one kind of thing: an event. It never writes `definition_versions`,
 * never applies a bundle, and never touches the applied version. There is no
 * code path from this module to a write, so "the drift job does not
 * auto-correct" is a structural property, not a promise.
 *
 * ## The event's shape
 *
 * The contract requires three fields on `definition.driftDetected`
 * (`packages/contracts/src/event-log.ts`):
 * `expectedSha`, `observedSha`, `diff`.
 *
 * * `expectedSha` — the SHA the applied version claims to come from.
 * * `observedSha` — the SHA the repository actually holds at that point.
 * * `diff` — what changed.
 *
 * When the SHA cannot be read at all there is no observed SHA, so the field
 * carries the applied version's own digest. That keeps the field non-empty
 * and non-optional, as the contract requires, without inventing a SHA that
 * was never observed.
 *
 * ## Why the event is worth appending
 *
 * A drift that nobody sees is a drift nobody acts on. The event is what makes
 * the drift *visible* to the operator — it lands in the same log as everything
 * else, so the audit trail shows that the applied definition stopped matching
 * its source. And because the event is in the log, the projector can build a
 * view of it, and the chain covers it: a drift event that was tampered with
 * breaks the chain like any other event.
 */

import type { NewEvent } from '@factory/contracts';

import {
  checkDrift,
  type DriftFinding,
  type DriftReport,
} from './drift.js';
import type { DefinitionBundle } from './documents.js';

/**
 * The event type the drift job appends.
 */
export const DRIFT_EVENT_TYPE = 'definition.driftDetected';

/**
 * What the drift job needs to append its event.
 *
 * The narrow port the job writes through. It is a port rather than the
 * `PostgresEventLog` directly so the job can be tested without a database,
 * and so the package does not depend on the event log's implementation.
 */
export interface DriftEventSink {
  append(events: readonly NewEvent[]): Promise<readonly unknown[]>;
}

/**
 * The applied version the job checks.
 *
 * The store port is reused rather than duplicated: the job reads the applied
 * version through the same interface the applier writes through, so there is
 * one definition of "the active version" in the codebase.
 */
export interface AppliedVersionReader {
  /**
   * The SHA the applied version claims to come from, and the bundle it
   * applied.
   *
   * `undefined` when nothing has been applied yet — there is nothing to drift
   * from, and an empty definition is not drift.
   */
  activeVersion(): Promise<{ readonly sha: string; readonly bundle: DefinitionBundle } | undefined>;
}

/**
 * What the drift job needs from the repository.
 */
export interface DriftRepository {
  /**
   * Load the bundle the repository produces at a SHA.
   *
   * Returns `undefined` when the SHA can no longer be read.
   */
  loadAtSha(sha: string): Promise<DefinitionBundle | undefined>;
}

/**
 * The inputs to one run of the drift job.
 */
export interface DriftJobInputs {
  /** The applied version. */
  readonly reader: AppliedVersionReader;
  /** The repository to compare against. */
  readonly repository: DriftRepository;
  /** Where the event is appended. */
  readonly sink: DriftEventSink;
  /** The correlation id for the job's events. */
  readonly correlationId: string;
  /** The id of the job run, for the event's causation. */
  readonly jobRunId: string;
}

/**
 * The outcome of one run of the drift job.
 */
export interface DriftJobOutcome {
  /** The report the check produced. */
  readonly report: DriftReport;
  /** The events the job appended. Empty when there was no drift. */
  readonly appended: readonly unknown[];
}

/**
 * The aggregate the drift event belongs to.
 *
 * The `definition` aggregate is addressed by its SHA — the aggregate
 * registry binds `definition` to `definition_versions.keyColumns = ['sha']`.
 * The *applied* version's SHA is used, because that is the version the drift
 * is about: the applied one no longer matches its source.
 */
const driftAggregate = (sha: string): { kind: 'definition'; id: string; version: number } => ({
  kind: 'definition',
  id: sha,
  // `definition_versions` has no `version` column, so the log records the
  // version but does not bump it (the aggregate registry's `versioned` is
  // `false` for `definition`). Zero is the version of a row the log does not
  // version.
  version: 0,
});

/**
 * The payload of one drift event.
 *
 * `diff` is a short human-readable summary of what diverged — the same
 * summary the finding carries — rather than the whole bundle diff, because
 * the event is a *signal* that a human must act on, not a document.
 */
export interface DriftEventPayload {
  readonly expectedSha: string;
  readonly observedSha: string;
  readonly diff: string;
}

/**
 * Build the payload of a drift event.
 */
export const driftEventPayload = (
  finding: DriftFinding,
  appliedSha256: `sha256:${string}`,
): DriftEventPayload => ({
  // The SHA the applied version claims. When the repository no longer holds
  // it, this is still what the applied version says — which is exactly the
  // discrepancy worth reporting.
  expectedSha: finding.claimedSha,
  // The SHA actually observed. When the repository could not be read there is
  // no observed SHA, so the applied bundle's digest stands in: it is the
  // thing that was observed, and it is not the expected one.
  observedSha: finding.repositorySha256 ?? appliedSha256,
  diff: finding.detail,
});

/**
 * Run the drift job once.
 *
 * **Never corrects.** The job's only output is the event it appends; the
 * applied version is left exactly as it was, and no apply path is reachable
 * from here.
 */
export const runDriftJob = async (inputs: DriftJobInputs): Promise<DriftJobOutcome> => {
  const { reader, repository, sink, correlationId, jobRunId } = inputs;

  const active = await reader.activeVersion();

  // Nothing has been applied. There is no claim to have drifted from, and
  // reporting "drift" against an empty definition would be noise.
  if (active === undefined) {
    return {
      report: { findings: [], drifted: false, autoCorrected: false },
      appended: [],
    };
  }

  const report = await checkDrift({
    claimedSha: active.sha,
    appliedBundle: active.bundle,
    loadAtSha: (sha) => repository.loadAtSha(sha),
  });

  if (!report.drifted) {
    return { report, appended: [] };
  }

  const appliedSha256 = report.findings[0]?.appliedSha256;
  if (appliedSha256 === undefined) {
    // `drifted` is true only when there is at least one finding, so this is
    // unreachable. The check is here so the type checker can see the
    // total-ness rather than asserting it away.
    return { report, appended: [] };
  }

  const events: NewEvent[] = report.findings.map((finding) => ({
    eventType: DRIFT_EVENT_TYPE,
    aggregate: driftAggregate(finding.claimedSha),
    correlationId,
    causationId: jobRunId,
    // The job is the factory acting on itself, with no human behind it and
    // no grant — it is the system reporting on its own state.
    actor: { kind: 'system', id: 'definition-drift-job' },
    authority: { basis: 'system-rule' },
    subject: { sha: finding.claimedSha },
    payload: driftEventPayload(finding, appliedSha256),
    context: { items: [] },
  }));

  const appended = await sink.append(events);
  return { report, appended };
};
