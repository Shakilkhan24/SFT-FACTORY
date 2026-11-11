/**
 * `hello/record-executor` — the `record` stage executor (T-1.17).
 *
 * ## What this stage does
 *
 * It assembles the **twelve-element run record** from what the framework
 * observed, and hands it to the artefact store, which asserts its
 * completeness (A0.3) and writes it.
 *
 * blueprint `15` §2.4 is the rule this stage exists to satisfy:
 *
 * > "The runtime and control plane write the artefact. An agent never
 * > writes it, and never writes a field of it (MEAS-02)."
 *
 * So every element here comes from the **framework's** observation — the
 * gateway's reported usage, the collector's records, the policy engine's
 * decisions — and **not** from the model. The model's answer appears in
 * the record only as a *produced artefact* and as *generated text*, which
 * is what it is.
 *
 * ## Why the record is written by a **stage** and not by the runner
 *
 * Because the record is **incremental** (blueprint `15` §2.4: "Partial
 * artefacts are written during the run, so a killed run still leaves a
 * record"), the writing has to happen *inside* the run. The stage is the
 * natural place: it runs after the stages that produced the facts, and
 * before the run ends.
 *
 * The alternative — the runner writing the record after the last stage —
 * would produce a record for a successful run and **nothing** for a run
 * that died, which is the opposite of what the rule wants.
 *
 * ## The framework's observations are injected
 *
 * The executor does not reach for the gateway or the broker. It is handed
 * what they observed. That is what keeps the stage **pure of side
 * effects** beyond the one write it performs, and it is what lets a test
 * assemble a record from observations it controls.
 */

import type {
  RecordParts,
  RetentionClass,
  RunIndexEntry,
} from '@factory/artefacts';

import type {
  CancellationToken,
  StageExecutor,
  StageInput,
  StageResult,
} from '../runtime/ports.js';

import type { RunObservations } from './observations.js';

/**
 * The artefact store's slice the record stage needs.
 *
 * The stage writes the record; it does not index it and does not spool
 * it. Those are the store's own business (pack 04 INT-08), and the store
 * does them.
 */
export interface RecordSink {
  /**
   * Finalise a run's record.
   *
   * The store assembles it, asserts its completeness, writes the object
   * and indexes it — in that order, so a run whose object write failed
   * has no row.
   */
  finalise(
    parts: RecordParts,
    index: RunIndexEntry,
    retentionClass: RetentionClass,
  ): Promise<{ readonly recordUri: string; readonly recordSha256: string }>;
}

/**
 * The record stage's options.
 */
export interface RecordExecutorOptions {
  /** Where the record goes. */
  readonly records: RecordSink;
  /** The observations the record is assembled from. */
  readonly observations: RunObservations;
  /**
   * The clock — the injected time.
   *
   * The record stage reads the clock itself, because the record's
   * `completedAt` is the instant **the record was written** — which is
   * the run's completion. Waiting for the caller to stamp it would mean
   * the record carried the instant the loop finished rather than the
   * instant the run finished, and a record whose completion instant is
   * unset cannot be finalised at all (the store derives the retention
   * expiry from it).
   */
  readonly clock: { now(): string };
  /**
   * The run's identity — element 1.
   *
   * Injected, because the identity is the **run's**, not the stage's: the
   * record names the run, and every stage of the run shares it.
   */
  readonly identity: RecordParts['identity'];
  /** The context manifest — element 2. */
  readonly context: RecordParts['context'];
  /** The configuration versions — element 3. */
  readonly configuration: RecordParts['configuration'];
  /** The declared budget — element 11. */
  readonly budget: RecordParts['budget'];
  /** The redaction receipt. */
  readonly redaction: RecordParts['redaction'];
  /** The retention class and expiry. */
  readonly retention: RecordParts['retention'];
  /**
   * The run's outcome — element 8.
   *
   * Supplied by the caller rather than derived, because the outcome is a
   * fact about the **run**, and only the caller knows whether the run as
   * a whole succeeded.
   */
  readonly outcome: RecordParts['outcome'];
}

/**
 * The `record` stage executor.
 *
 * The executor kind is `deterministic` — no model, no sandbox. It
 * assembles what the framework already knows and writes it.
 */
export class RecordExecutor implements StageExecutor {
  public readonly kind = 'deterministic';

  readonly #options: RecordExecutorOptions;

  public constructor(options: RecordExecutorOptions) {
    this.#options = options;
  }

  public async run(
    input: StageInput,
    _token: CancellationToken,
  ): Promise<StageResult> {
    const observations = this.#options.observations;

    // The run completed **now** — the record stage is the last thing the
    // run does, and the record's completion instant is the instant the
    // record was written.
    observations.completedAt = this.#options.clock.now();

    // ---- the cost, from the gateway's reported usage ------------------
    const cost = observations.cost();

    // The record stage is a node of the run too, so it appears in the
    // record's `nodes[]` — with no model, because it used none.
    const self = observations.node(input.nodeId);
    self.role = input.modelPolicy.role;
    self.attempts = input.attempt;

    const parts: RecordParts = {
      identity: this.#options.identity,
      context: this.#options.context,
      configuration: this.#options.configuration,
      // One entry per node the run executed, in the order they ran.
      // Collapsing them into one entry would say the `record` stage did
      // the work the `implement` stage did.
      nodes: observations.nodes.map((node) => ({
        nodeId: node.nodeId,
        role: node.role,
        model: node.model ?? {
          provider: 'none',
          model: 'none',
          version: 'none',
        },
        attempts: node.attempts,
        turns: node.turns,
        durationMs: node.durationMs,
        toolCalls: node.toolCalls,
        artefacts: node.artefacts,
        verification: node.verification,
      })),
      prompts: observations.prompts,
      outcome: this.#options.outcome,
      authority: observations.authority,
      cost,
      budget: {
        declaredUsdMicros: this.#options.budget.declaredUsdMicros,
        consumedUsdMicros: cost.totalUsdMicros,
        turnsDeclared: this.#options.budget.turnsDeclared,
        turnsUsed: observations.turns,
      },
      policyDecisions: observations.policyDecisions,
      redaction: this.#options.redaction,
      retention: this.#options.retention,
      startedAt: observations.startedAt,
      completedAt: observations.completedAt,
    };

    // ---- the write ------------------------------------------------------
    try {
      const written = await this.#options.records.finalise(
        parts,
        {
          runId: this.#options.identity.runId,
          taskId: this.#options.identity.taskId,
          nodeId: input.nodeId,
          attempt: input.attempt,
          role: input.modelPolicy.role,
          stageKind: input.stageKind,
          executorKind: input.executorKind,
          status: 'completed',
          outcome: this.#options.outcome.status,
          startedAt: observations.startedAt,
          endedAt: observations.completedAt,
          costUsdMicros: cost.totalUsdMicros,
          tokens: {
            tokensIn: cost.tokensIn,
            tokensOut: cost.tokensOut,
          },
          retentionClass: this.#options.retention.class,
        },
        this.#options.retention.class,
      );

      return {
        status: 'success',
        artefacts: [{ ref: written.recordUri, sha256: written.recordSha256 }],
        observability: {
          costUsdMicros: cost.totalUsdMicros,
          tokensIn: cost.tokensIn,
          tokensOut: cost.tokensOut,
        },
        summary: `the run record was written to ${written.recordUri}`,
      };
    } catch (error) {
      // An incomplete record is refused by the store, and a refusal here
      // means the run did **not** produce a complete artefact. That is a
      // stage failure, not a silent success.
      return {
        status: 'failure',
        failureClass: 'workflow.composition',
        summary: `the run record could not be written: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
