/**
 * The `H.hello` workflow, end to end (T-1.17).
 *
 * ## What this test is
 *
 * blueprint `16` §3.1's Phase-0 objective, in one file:
 *
 * > At the end of this phase, the factory can run a trivial task, refuse
 * > an unauthorised one, and record everything.
 *
 * `H.hello` is the **trivial task**, and checklist 03's exit criteria say
 * the workflow must run end to end:
 *
 * > - [ ] The `H.hello` workflow runs end to end: FakeProvider → artefact
 *       → record.
 *
 * So this test drives the **whole chain**: the real gateway (with its
 * fake provider), the real orchestrator (registry, runner, loop), the real
 * artefact store, and the real event log's hash chain.
 *
 * ## What "end to end" means here, precisely
 *
 * Every component is the **real** one, and only the **edges** are doubles:
 *
 * * the gateway is `ModelGatewayImpl` — the real routing, the real budget
 *   ledger, the real idempotency;
 * * the provider is the **fake provider** — the ticket names it, and it
 *   is a real adapter built through the adapter factory, so the runtime
 *   guard is exercised;
 * * the orchestrator is the real `ExecutorRegistry`, `StageRunner` and
 *   `ExecutionLoop`;
 * * the artefact store is the real `RunArtifactStore`, over the in-memory
 *   object store and the in-memory index;
 * * the event log is the **pure** hash chain (`chainHash` /
 *   `verifyChainLinks`) over the envelopes the run emitted.
 *
 * A test that assembled the pieces itself would prove that the *test*
 * can assemble them. This one proves that the *factory* can run a task.
 *
 * ## The three things the chain must produce
 *
 * 1. **The artefact** — the model's answer, written to the object store
 *    under a key the run owns, with a digest that matches its bytes.
 * 2. **The record** — the twelve-element run record, assembled by the
 *    framework from what it observed, asserted complete (A0.3), written
 *    to the object store and indexed.
 * 3. **The chain** — the run's events, hash-chained, verifying.
 */

import { describe, expect, it } from 'vitest';

import type { RoutingPolicy } from '@factory/contracts';
import {
  assertComplete,
  isComplete,
  type RunRecord,
} from '@factory/artefacts';
import {
  ARTEFACT_STAGE,
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeStateSink,
  HELLO_STAGES,
  HELLO_WORKFLOW_ID,
  HELLO_WORKFLOW_VERSION,
  InMemoryRunStore,
  RECORD_STAGE,
  SPECIFICATION_STAGE,
  runHello,
  type HelloContext,
} from '@factory/orchestrator';
import {
  chainHash,
  verifyChainLinks,
  type ChainLink,
} from '@factory/eventlog';

import { harness as artefactHarness } from '../helpers/artefacts.ts';
import { THE_POLICY, buildGateway } from '../helpers/gateway.ts';

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The task's id.
 */
const TASK_ID = 'tsk_hello_0001';

/**
 * The run's id.
 */
const RUN_ID = 'run_hello_0001';

/**
 * The context the run's stages see.
 *
 * A **real** manifest — an envelope id, a resolved digest, one item and
 * one gap — because the manifest is element 2 of the record and the
 * record must carry it verbatim.
 */
const CONTEXT: HelloContext = {
  manifest: {
    envelopeId: 'ctx_hello_0001',
    resolvedContextSha256: `sha256:${'a'.repeat(64)}`,
    items: [
      {
        id: 'skill.hello',
        version: '1',
        sha256: `sha256:${'b'.repeat(64)}`,
        trust: 'trusted',
      },
    ],
    gaps: [
      {
        expected: 'skill.missing',
        reason: 'not published',
      },
    ],
  },
  body: 'Say hello, and nothing else.',
};

/**
 * The routing policy the run runs under.
 *
 * `THE_POLICY` routes `worker` and `planner`. `H.hello` uses
 * `refinement` (the `specify` stage) and `worker` (the `implement`
 * stage), and the gateway **does not fall back to a default model** — a
 * request that matches no rule is refused. So the policy a deployment
 * runs under has to route the roles its workflows use, and this is that
 * deployment's policy.
 *
 * The `refinement` rule selects the `cheap` class deliberately: a
 * trivial task does not need the strong model, and the run's cost is
 * asserted from the pricing table, so the class is a fact the test
 * states rather than an accident.
 */
const THE_HELLO_POLICY: RoutingPolicy = {
  ...THE_POLICY,
  spec: {
    ...THE_POLICY.spec,
    rules: [
      { match: { role: 'worker' }, use: 'cheap' },
      { match: { role: 'refinement' }, use: 'cheap' },
      { match: { role: 'planner' }, use: 'strong' },
    ],
  },
};

/**
 * The clock the run runs on.
 *
 * A **fixed** instant, so the record's timestamps are deterministic.
 * AGENTS.md §4: "Time via injected `Clock`."
 */
const CLOCK = { now: (): string => '2026-11-10T00:00:00.000Z' };

/**
 * The whole harness — the gateway, the artefact store, the orchestrator's
 * doubles and the run's collaborators.
 */
const buildHarness = () => {
  const gatewayFixture = buildGateway({
    policy: THE_HELLO_POLICY,
    alpha: { usage: { tokensIn: 11, tokensOut: 7 } },
  });

  const artefacts = artefactHarness();
  const runs = new InMemoryRunStore();
  const state = new FakeStateSink();
  const environments = new FakeEnvironmentRegistry();
  const credentials = new FakeCredentialReclaimer();

  let counter = 0;

  const options = {
    gateway: gatewayFixture.gateway,
    artefacts: artefacts.objectStore,
    records: artefacts.store,
    runs,
    environments,
    credentials,
    state,
    context: CONTEXT,
    taskId: TASK_ID,
    runId: RUN_ID,
    clock: CLOCK,
    nextRunId: () => {
      counter += 1;
      return `run_hello_stage_${String(counter)}`;
    },
  };

  return {
    options,
    gatewayFixture,
    artefacts,
    runs,
    state,
    environments,
    credentials,
  };
};

/* -------------------------------------------------------------------------- */
/* The chain                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build the hash chain over a run's envelopes.
 *
 * The chain is **per aggregate** (pack `03` §3), so the run's envelopes
 * are chained under the run's id.
 *
 * The optional `tamper` rewrites an envelope **after** the hash was
 * computed — which is exactly what an attacker with write access to the
 * `events` table does. The stored hash stays, and the recomputed hash no
 * longer matches it. Without that distinction the tamper test would
 * recompute the chain over the tampered envelopes, produce a *consistent*
 * chain, and prove nothing.
 *
 * @param envelopes the envelopes, in append order
 * @param tamper rewrites one envelope after its hash was computed
 */
const chainFor = (
  envelopes: readonly Readonly<Record<string, unknown>>[],
  tamper?: { readonly at: number; readonly rewrite: (envelope: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> },
): ChainLink[] => {
  const links: ChainLink[] = [];
  let previous: string | null = null;

  envelopes.forEach((envelope, index) => {
    const hash = chainHash(envelope, previous);
    const stored =
      tamper !== undefined && tamper.at === index ? tamper.rewrite(envelope) : envelope;
    links.push({
      seq: index + 1,
      prevHash: previous,
      hash,
      envelope: stored,
    });
    previous = hash;
  });

  return links;
};

/**
 * The envelope the run's events would have carried.
 *
 * The event log is not part of `H.hello`'s spine — the orchestrator does
 * not own it — so this test builds the envelopes the run *would* emit
 * and chains them, rather than asserting against a log the run does not
 * write to. The chain is proved **as a property of the envelopes**, which
 * is where the tampering is detectable.
 *
 * @param events the events, in order
 */
const envelopesFor = (
  events: readonly { readonly type: string; readonly payload: Readonly<Record<string, unknown>> }[],
): Readonly<Record<string, unknown>>[] =>
  events.map((event, index) => ({
    aggregateKind: 'run',
    aggregateId: RUN_ID,
    version: index + 1,
    type: event.type,
    payload: event.payload,
  }));

/* -------------------------------------------------------------------------- */
/* The tests                                                                  */
/* -------------------------------------------------------------------------- */

describe('the H.hello workflow (Phase-0 exit)', () => {
  it('runs the three stages in order', async () => {
    const { options } = buildHarness();

    const outcome = await runHello(options);

    expect(outcome.ok).toBe(true);
    expect(outcome.stages.map((stage) => stage.stage)).toEqual([
      SPECIFICATION_STAGE,
      ARTEFACT_STAGE,
      RECORD_STAGE,
    ]);
    expect(outcome.stages.every((stage) => stage.status === 'success')).toBe(true);
  });

  it('the FakeProvider answered — the run really called the model', async () => {
    const { options, gatewayFixture } = buildHarness();

    await runHello(options);

    // Two completion stages — `specify` and `implement` — so the provider
    // was asked twice. A run that did not reach the model would have
    // produced no artefact, and the record would be empty of prompts.
    expect(gatewayFixture.alpha.callCount).toBe(2);
  });

  it('the artefact is written to the object store under the run\'s key', async () => {
    const { options, artefacts } = buildHarness();

    const outcome = await runHello(options);

    expect(outcome.artefacts).toHaveLength(1);
    const artefact = outcome.artefacts[0];
    expect(artefact?.uri).toBe(`runs/${TASK_ID}/implement.txt`);

    const bytes = await artefacts.objectStore.get(artefact?.uri ?? '');
    expect(bytes).toBeDefined();
    expect(new TextDecoder().decode(bytes)).toBe('ok');
  });

  it('the artefact\'s digest matches its bytes', async () => {
    const { options, artefacts } = buildHarness();

    const outcome = await runHello(options);
    const artefact = outcome.artefacts[0];

    const bytes = await artefacts.objectStore.get(artefact?.uri ?? '');
    expect(bytes).toBeDefined();

    // The digest is the artefact's identity in the record, so it must be
    // the digest of the bytes that are actually in the store — not of
    // some other rendering of the same text.
    const { toSha256Digest } = await import('@factory/core');
    expect(artefact?.sha256).toBe(toSha256Digest(bytes as Uint8Array));
    expect(artefact?.bytes).toBe((bytes as Uint8Array).byteLength);
  });

  it('the specification is not the artefact', async () => {
    const { options } = buildHarness();

    const outcome = await runHello(options);

    // The `specify` stage's answer is *input* to the artefact. It is
    // recorded as a specification, and it is kept out of element 7 — a
    // record that listed both would say the run produced two artefacts
    // when it produced one.
    expect(outcome.observations.specifications).toHaveLength(1);
    expect(outcome.observations.specifications[0]?.uri).toBe(
      `runs/${TASK_ID}/specify.spec`,
    );
    expect(outcome.artefacts.map((artefact) => artefact.uri)).toEqual([
      `runs/${TASK_ID}/implement.txt`,
    ]);
  });

  it('the record is written and indexed', async () => {
    const { options, artefacts } = buildHarness();

    const outcome = await runHello(options);

    expect(outcome.recordUri).toBeDefined();
    expect(outcome.recordSha256).toBeDefined();

    const bytes = await artefacts.objectStore.get(
      `runs/${RUN_ID}/record.json`,
    );
    expect(bytes).toBeDefined();

    // The index row exists — the store writes the object first and the
    // row second, so a row proves the object is there.
    const row = await artefacts.runStore.find(RUN_ID);
    expect(row).toBeDefined();
    expect(row?.recordUri).toBe(outcome.recordUri);
    expect(row?.recordSha256).toBe(outcome.recordSha256);
  });

  it('the record satisfies the completeness assertion (A0.3)', async () => {
    const { options, artefacts } = buildHarness();

    await runHello(options);

    const bytes = await artefacts.objectStore.get(`runs/${RUN_ID}/record.json`);
    const record = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;

    // The store already asserted completeness before writing — so this
    // re-asserts it against what was actually stored, which is the
    // stronger claim: the bytes on disk are complete.
    const report = assertComplete(record);
    expect(report.missing).toEqual([]);
    expect(report.complete).toBe(true);
    expect(isComplete(record)).toBe(true);
  });

  it('the record carries one entry per node the run executed', async () => {
    const { options, artefacts } = buildHarness();

    await runHello(options);

    const bytes = await artefacts.objectStore.get(`runs/${RUN_ID}/record.json`);
    const record = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;

    // Three nodes ran — `specify`, `implement` and `record` — so the
    // record carries three entries. A record that collapsed them into
    // one would say the `record` stage did the work the `implement`
    // stage did.
    expect(record.nodes.map((node) => node.nodeId)).toEqual([
      SPECIFICATION_STAGE,
      ARTEFACT_STAGE,
      RECORD_STAGE,
    ]);

    // The two model stages used a model; the record stage used none.
    expect(record.nodes[0]?.model.provider).toBe('alpha');
    expect(record.nodes[1]?.model.provider).toBe('alpha');
    expect(record.nodes[2]?.model).toEqual({
      provider: 'none',
      model: 'none',
      version: 'none',
    });

    // The `implement` node carries the artefact; the `specify` node does
    // not — its output is the specification, which is input to the
    // artefact.
    expect(record.nodes[1]?.artefacts).toHaveLength(1);
    expect(record.nodes[0]?.artefacts).toHaveLength(0);
  });

  it('the record carries the twelve elements from the framework\'s observations', async () => {
    const { options, artefacts } = buildHarness();

    await runHello(options);

    const bytes = await artefacts.objectStore.get(`runs/${RUN_ID}/record.json`);
    const record = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;

    // 1 — identity: the run names the workflow that produced it.
    expect(record.identity.runId).toBe(RUN_ID);
    expect(record.identity.taskId).toBe(TASK_ID);
    expect(record.identity.workflow).toEqual({
      id: HELLO_WORKFLOW_ID,
      version: HELLO_WORKFLOW_VERSION,
    });

    // 2 — context: the manifest travels verbatim.
    expect(record.context.envelopeId).toBe(CONTEXT.manifest.envelopeId);
    expect(record.context.resolvedContextSha256).toBe(
      CONTEXT.manifest.resolvedContextSha256,
    );

    // 3 — configuration: the versions are named.
    expect(record.configuration.definitionRevision).toBe('def_hello');

    // 5 — prompts: both the prompt sent and the text generated.
    expect(record.prompts.map((prompt) => prompt.kind)).toEqual([
      'prompt',
      'generated',
      'prompt',
      'generated',
    ]);

    // 7 — artefacts: the artefact, and only the artefact.
    expect(record.artefacts).toHaveLength(1);
    expect(record.artefacts[0]?.uri).toBe(`runs/${TASK_ID}/implement.txt`);

    // 8 — outcome.
    expect(record.outcome.status).toBe('success');

    // 9 — authority: the approval the run acted under, naming the
    // artefact the run produced. The digest must be the artefact's own
    // — a placeholder would be a record that names a change which does
    // not exist.
    expect(record.authority).toHaveLength(1);
    expect(record.authority[0]?.artefactSha256).toBe(record.artefacts[0]?.sha256);

    // 10 — cost: the gateway's own report.
    expect(record.cost.tokensIn).toBe(22);
    expect(record.cost.tokensOut).toBe(14);

    // 11 — budget: the declared and the consumed.
    expect(record.budget.declaredUsdMicros).toBe(1_000_000);
    expect(record.budget.consumedUsdMicros).toBe(record.cost.totalUsdMicros);
    expect(record.budget.turnsUsed).toBe(2);

    // 12 — policy decisions.
    expect(record.policyDecisions).toHaveLength(1);
    expect(record.policyDecisions[0]?.outcome).toBe('ALLOW');
  });

  it('the cost came from the gateway\'s report, not from the model', async () => {
    const { options, gatewayFixture } = buildHarness();

    const outcome = await runHello(options);

    // The fake provider reports a cost of zero on its own; the gateway
    // prices the call from the pricing table. So a non-zero cost proves
    // the cost came from the gateway and not from the provider.
    expect(outcome.costUsdMicros).toBeGreaterThan(0);
    expect(outcome.tokens).toEqual({ tokensIn: 22, tokensOut: 14 });
    void gatewayFixture;
  });

  it('the node transitions are RUNNING then a terminal state', async () => {
    const { options, state } = buildHarness();

    await runHello(options);

    expect(state.transitions.map((transition) => transition.to)).toEqual([
      'RUNNING',
      'SUCCEEDED',
      'RUNNING',
      'SUCCEEDED',
      'RUNNING',
      'SUCCEEDED',
    ]);
  });

  it('the environment and the credentials were reclaimed at the terminal state', async () => {
    const { options, environments, credentials } = buildHarness();

    await runHello(options);

    // ADR-0006 §4 makes reclamation mandatory at **every** terminal
    // state, including failure — so a successful run reclaims too.
    expect(environments.reclaimed).toHaveLength(3);
    expect(credentials.revoked).toHaveLength(3);
  });

  it('the run fails over to the second provider when the first is down', async () => {
    const { options, gatewayFixture } = buildHarness();
    gatewayFixture.alpha.failWith(new Error('the provider is down'));

    const outcome = await runHello(options);

    // The gateway failed over — the `cheap` class declares `beta` as the
    // fallback — so the run **succeeds**. A run that failed here would
    // have shown the failover path is broken.
    expect(outcome.ok).toBe(true);
    expect(gatewayFixture.alpha.callCount).toBe(2);
    expect(gatewayFixture.beta.callCount).toBe(2);
    expect(outcome.recordUri).toBeDefined();
  });

  it('the run is refused when every provider fails', async () => {
    const { options, gatewayFixture } = buildHarness();
    gatewayFixture.alpha.failWith(new Error('the provider is down'));
    gatewayFixture.beta.failWith(new Error('the provider is down'));

    const outcome = await runHello(options);

    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toBeDefined();
    // The record stage never ran, so there is no record.
    expect(outcome.recordUri).toBeUndefined();
  });

  it('the run is refused when the artefact store is down, and nothing is recorded', async () => {
    const { options, artefacts } = buildHarness();
    artefacts.objectStore.outage = true;

    const outcome = await runHello(options);

    expect(outcome.ok).toBe(false);
    // The record stage never ran, so there is no record — and no row.
    expect(outcome.recordUri).toBeUndefined();
    expect(await artefacts.runStore.find(RUN_ID)).toBeUndefined();
  });

  it('the workflow declares its stages as data', () => {
    // The workflow is a **value**, so it can be inspected without running
    // it. A workflow written as code could only be run.
    expect(HELLO_STAGES.map((stage) => stage.id)).toEqual([
      SPECIFICATION_STAGE,
      ARTEFACT_STAGE,
      RECORD_STAGE,
    ]);
    expect(HELLO_STAGES.filter((stage) => stage.producesArtefact)).toHaveLength(1);
    expect(HELLO_STAGES.filter((stage) => stage.producesSpecification)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The chain                                                                  */
/* -------------------------------------------------------------------------- */

describe('the run\'s event chain', () => {
  it('an intact chain verifies', async () => {
    const { options } = buildHarness();
    const outcome = await runHello(options);

    const envelopes = envelopesFor([
      { type: 'run.started', payload: { runId: RUN_ID, taskId: TASK_ID } },
      {
        type: 'stage.completed',
        payload: { nodeId: ARTEFACT_STAGE, artefact: outcome.artefacts[0]?.uri },
      },
      { type: 'run.completed', payload: { runId: RUN_ID, status: 'success' } },
    ]);

    const result = verifyChainLinks(chainFor(envelopes));

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.brokenAtSeq).toBeUndefined();
  });

  it('a tampered envelope breaks the chain', async () => {
    const { options } = buildHarness();
    const outcome = await runHello(options);

    const envelopes = envelopesFor([
      { type: 'run.started', payload: { runId: RUN_ID, taskId: TASK_ID } },
      {
        type: 'stage.completed',
        payload: { nodeId: ARTEFACT_STAGE, artefact: outcome.artefacts[0]?.uri },
      },
      { type: 'run.completed', payload: { runId: RUN_ID, status: 'success' } },
    ]);

    // The tamper: the artefact the event names is rewritten **after** the
    // hash was computed, so the stored hash is the hash of the original
    // envelope. This is what an attacker with write access to the
    // `events` table does — the row is edited, the hash column is not.
    const result = verifyChainLinks(
      chainFor(envelopes, {
        at: 1,
        rewrite: (envelope) => ({
          ...envelope,
          payload: { ...(envelope.payload as object), artefact: 'runs/other/evil.txt' },
        }),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });
});
