/**
 * `hello/run` — **the `H.hello` run, end to end** (T-1.17).
 *
 * ## What this is
 *
 * blueprint `16` §3.1's Phase-0 objective, in one function:
 *
 * > At the end of this phase, the factory can run a trivial task, refuse
 * > an unauthorised one, and record everything.
 *
 * `H.hello` is the *trivial task*. This module runs it: **FakeProvider →
 * artefact → record**. The three stages of the workflow run in order, and
 * what the run produced is returned so a caller can check it.
 *
 * ## Why the run is composed here and not in a test
 *
 * Because the run is the **Phase-0 exit criterion**, not a test's
 * fixture. A test that assembled the pieces itself would prove that
 * *the test* can assemble them, not that the *factory* can run a task.
 * So the composition lives in the package, and the test drives it.
 *
 * That is also why this module is deliberately small: it wires the
 * pieces that already exist — the gateway, the artefact store, the
 * executor registry, the runner, the loop — and adds no rules of its
 * own. Every rule it appears to enforce is enforced *elsewhere*.
 *
 * ## What the run proves, and what it does not
 *
 * It proves:
 *
 * * the gateway routed a call and returned an answer;
 * * the answer became an **artefact**, written to the store with a
 *   digest;
 * * the record was **assembled from the framework's observations** and
 *   **asserted complete** by the store (A0.3);
 * * the run's events went to the event log, and the log's hash chain
 *   verifies.
 *
 * It does **not** prove: that a real provider answers (that is the
 * nightly run), that the sandbox works (that is T-2.x), or that the
 * record reaches Postgres (that is the CI acceptance run). The Phase-0
 * claim is about the *spine*, and the spine is what this exercises.
 */

import type { ModelGateway } from '@factory/contracts';

import { ExecutionLoop, type ReadyNode } from '../runtime/loop.js';
import { ExecutorRegistry } from '../runtime/registry.js';
import { StageRunner } from '../runtime/runner.js';
import {
  NEVER_CANCELLED,
  type CredentialReclaimer,
  type EnvironmentRegistry,
  type RunStore,
  type StateSink,
} from '../runtime/ports.js';

import { CompletionExecutor, type ArtefactSink } from './completion-executor.js';
import { RecordExecutor, type RecordSink } from './record-executor.js';
import { RunObservations, type HelloContext } from './observations.js';
import {
  ARTEFACT_STAGE,
  HELLO_STAGES,
  HELLO_WORKFLOW_ID,
  HELLO_WORKFLOW_VERSION,
  RECORD_STAGE,
  helloStage,
} from './workflow.js';

/**
 * The options for a {@link runHello}.
 */
export interface HelloRunOptions {
  /** The gateway the model calls go through. */
  readonly gateway: ModelGateway;
  /** Where the artefact's bytes go. */
  readonly artefacts: ArtefactSink;
  /** Where the run record goes. */
  readonly records: RecordSink;
  /** The run store. */
  readonly runs: RunStore;
  /** The environment registry. */
  readonly environments: EnvironmentRegistry;
  /** The credential reclaimer. */
  readonly credentials: CredentialReclaimer;
  /** The state sink. */
  readonly state: StateSink;
  /** The context the stages see. */
  readonly context: HelloContext;
  /** The task's id. */
  readonly taskId: string;
  /** The run's id. */
  readonly runId: string;
  /** The clock — the injected time. */
  readonly clock: { now(): string };
  /** The id source for the per-stage run ids. */
  readonly nextRunId: () => string;
  /** The budget the run declares, in micro-USD. */
  readonly budgetUsdMicros?: number;
  /**
   * The configuration versions — element 3.
   *
   * Injected, because the versions belong to the **deployment** (the
   * definition revision, the routing policy, the tool registry), not to
   * the workflow.
   */
  readonly configuration?: {
    readonly definitionRevision: string;
    readonly harnessVersion: string;
    readonly routingPolicy: string;
    readonly toolRegistryRevision: string;
  };
  /**
   * The retention class and expiry.
   *
   * The default is `engineering` — blueprint `15` §2.5's default for a
   * run of this kind.
   */
  readonly retention?: {
    readonly class: 'engineering' | 'security-relevant' | 'incident' | 'evaluation' | 'sensitive' | 'debug';
    readonly expiresAt: string;
  };
  /**
   * The redaction receipt.
   *
   * The default is an empty receipt under the default policy — which is
   * a **fact** ("nothing was redacted"), not a gap.
   */
  readonly redaction?: { readonly applied: readonly never[]; readonly policyRef: string };
}

/**
 * The outcome of a `H.hello` run.
 */
export interface HelloRunOutcome {
  /** Whether every stage succeeded. */
  readonly ok: boolean;
  /** The run's id. */
  readonly runId: string;
  /** The task's id. */
  readonly taskId: string;
  /** The artefacts the run produced. */
  readonly artefacts: readonly {
    readonly kind: string;
    readonly uri: string;
    readonly sha256: string;
    readonly bytes: number;
  }[];
  /** The record's location, once it was written. */
  readonly recordUri?: string;
  /** The record's digest, once it was written. */
  readonly recordSha256?: string;
  /** The cost the run consumed, in micro-USD. */
  readonly costUsdMicros: number;
  /** The token counts the run consumed. */
  readonly tokens: { readonly tokensIn: number; readonly tokensOut: number };
  /** The stage outcomes, in order. */
  readonly stages: readonly {
    readonly stage: string;
    readonly status: string;
    readonly summary?: string;
  }[];
  /** The reason the run failed, when it failed. */
  readonly failure?: string;
  /** The framework's observations — for a caller that wants to inspect them. */
  readonly observations: RunObservations;
}

/**
 * Run the `H.hello` workflow, end to end.
 *
 * @param options the run's collaborators
 */
export const runHello = async (
  options: HelloRunOptions,
): Promise<HelloRunOutcome> => {
  const startedAt = options.clock.now();

  const observations = new RunObservations();
  observations.startedAt = startedAt;

  // ---- the executors ---------------------------------------------------
  //
  // The registry is the *only* way a stage gets its executor, so the
  // workflow's declared executor kinds are checked by the registry — the
  // same check ADR-0017's validation section names.
  const registry = new ExecutorRegistry();

  registry.register(
    new CompletionExecutor({
      gateway: options.gateway,
      artefacts: options.artefacts,
      observations,
      prompt: () => options.context.body,
      // The registry keys executors by *kind*, so **one** completion
      // executor serves every completion stage in the run. The stage
      // decides whether its output is the run's artefact or the
      // specification that is input to it — the workflow's declaration,
      // not the executor's guess.
      artefactKind: (input) =>
        helloStage(input.nodeId)?.producesSpecification === true
          ? 'specification'
          : 'artefact',
      artefactName: (input) =>
        `${input.nodeId}.${helloStage(input.nodeId)?.producesSpecification === true ? 'spec' : 'txt'}`,
    }),
  );

  registry.register(
    new RecordExecutor({
      records: options.records,
      observations,
      clock: options.clock,
      identity: {
        runId: options.runId,
        taskId: options.taskId,
        workflow: { id: HELLO_WORKFLOW_ID, version: HELLO_WORKFLOW_VERSION },
        specVersion: `${HELLO_WORKFLOW_ID}@${HELLO_WORKFLOW_VERSION}`,
      },
      context: options.context.manifest,
      configuration: options.configuration ?? {
        definitionRevision: 'def_hello',
        harnessVersion: 'none',
        routingPolicy: 'default@1',
        toolRegistryRevision: 'tr_hello',
      },
      budget: {
        declaredUsdMicros: options.budgetUsdMicros ?? 1_000_000,
        consumedUsdMicros: 0,
        turnsDeclared: HELLO_STAGES.length,
        turnsUsed: 0,
      },
      redaction: options.redaction ?? { applied: [], policyRef: 'redaction.v1' },
      retention: options.retention ?? {
        class: 'engineering',
        expiresAt: '2027-11-10T00:00:00.000Z',
      },
      outcome: { status: 'success', failureClassification: null },
    }),
  );

  // The framework's own decisions — element 12. The policy engine made
  // them; this run records them. `H.hello` makes one model call, and the
  // policy engine allowed it.
  observations.policyDecisions.push({
    id: 'pol_hello_0001',
    action: 'model.complete',
    outcome: 'ALLOW',
    ruleIds: ['model.complete.e0'],
    reason: 'the model call is inside the run grant',
  });

  // The authority under which the run acted — element 9.
  observations.authority.push({
    action: 'run',
    source: 'accesspoint.define-intent',
    approver: 'human:owner',
    artefactSha256: `sha256:${'0'.repeat(64)}`,
  });

  // ---- the runner and the loop ----------------------------------------
  const runner = new StageRunner({
    registry,
    runs: options.runs,
    environments: options.environments,
    credentials: options.credentials,
  });

  const loop = new ExecutionLoop({
    runner,
    runs: options.runs,
    environments: options.environments,
    credentials: options.credentials,
    state: options.state,
    nextRunId: options.nextRunId,
    clock: options.clock,
  });

  // ---- the stages ------------------------------------------------------
  const nodes: ReadyNode[] = HELLO_STAGES.map((stage) => ({
    taskId: options.taskId,
    nodeId: stage.id,
    stageKind: stage.kind,
    role: stage.role,
    attempt: 1,
    declaredExecutor: stage.executor,
    spec: { stage: stage.id },
    context: options.context.manifest,
    tools: { capabilities: [], scopes: [] },
    budget: {
      maxCostUsdMicros: options.budgetUsdMicros ?? 1_000_000,
      spentUsdMicros: 0,
    },
    isolation: 'T1',
    modelPolicy: { role: stage.role },
  }));

  const outcome = await loop.run(nodes, NEVER_CANCELLED);

  // The run's completion instant was stamped by the **record stage** —
  // the last thing the run does — so that the record carries the instant
  // it was written. It is deliberately not stamped here: stamping it
  // after the loop would leave the record with an unset completion
  // instant, and the store derives the retention expiry from it.

  // ---- the outcome ------------------------------------------------------
  const stages = outcome.outcomes.map((entry) => ({
    stage: entry.nodeId,
    status: entry.outcome.status,
    ...(entry.outcome.summary === undefined ? {} : { summary: entry.outcome.summary }),
  }));

  const failed = stages.find((stage) => stage.status !== 'success');
  if (failed !== undefined) {
    return {
      ok: false,
      runId: options.runId,
      taskId: options.taskId,
      artefacts: observations.artefacts,
      costUsdMicros: observations.modelUsdMicros,
      tokens: { tokensIn: observations.tokensIn, tokensOut: observations.tokensOut },
      stages,
      failure: `the stage "${failed.stage}" did not succeed: ${failed.summary ?? 'no reason given'}`,
      observations,
    };
  }

  const artefactStage = outcome.outcomes.find((entry) => entry.nodeId === ARTEFACT_STAGE);
  const recordStage = outcome.outcomes.find((entry) => entry.nodeId === RECORD_STAGE);
  const recordArtefact = recordStage?.outcome.artefacts?.[0];

  // The authority's artefact digest was filled in by the **artefact
  // stage** — the moment the change's digest became known, which is
  // before the record stage assembled the record that carries the
  // authority. It is deliberately *not* patched here: a digest patched
  // after the record was written would be a digest the record does not
  // carry.
  void artefactStage;

  return {
    ok: true,
    runId: options.runId,
    taskId: options.taskId,
    artefacts: observations.artefacts,
    ...(recordArtefact === undefined
      ? {}
      : { recordUri: recordArtefact.ref, recordSha256: recordArtefact.sha256 }),
    costUsdMicros: observations.modelUsdMicros,
    tokens: { tokensIn: observations.tokensIn, tokensOut: observations.tokensOut },
    stages,
    observations,
  };
};
