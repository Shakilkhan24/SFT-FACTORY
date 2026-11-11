/**
 * **A0.4** — two runs of the same trivial task resolve an identical
 * context (T-1.17).
 *
 * ## The oracle this file carries
 *
 * checklist 03's CL-G1-04: "*A0.4* two runs of the same trivial task
 * resolve an identical context".
 *
 * So the load-bearing assertion is that the **context** two runs
 * resolve is **identical** — not merely that both runs succeeded.
 *
 * ## Why this matters more than it looks
 *
 * checklist 04 §"the context envelope" says it outright:
 *
 * > Same inputs ⇒ same envelope (golden-file tests; A0.4, A1.10).
 *
 * The context is what **pins** the run (INV-8). If two runs of the same
 * task resolved different contexts, then neither the artefact nor the
 * record could be compared, and every later audit — the hash chain, the
 * projections, the cost attribution — would be comparing runs that did
 * not do the same work.
 *
 * ## What is compared, and **where it is read from**
 *
 * The **context manifest** as it reaches the **record** — element 2 of
 * the twelve. The record is read back **from the object store**, as the
 * bytes that were actually written, and parsed. It is not read from the
 * run's return value.
 *
 * That distinction is load-bearing. The run's outcome carries
 * `recordUri` and `recordSha256` — **not** the record itself. A test
 * that compared `outcome.record` would compare `undefined` with
 * `undefined`, assert `toEqual` on two `undefined`s, and pass against
 * a build whose context resolution was **random**. The first version
 * of this file made exactly that mistake, and a mutation — making the
 * resolved digest random — did **not** fail it. The test was rewritten
 * to read the bytes, and the mutation now fails it.
 *
 * The manifest is compared **field for field**, not by digest: a digest
 * says "these differ", and an operator needs "this field differs".
 *
 * ## The determinism is **injected**, not hoped for
 *
 * The clock is a **fixed** instant and the id generator is a
 * **counter**, so the two runs differ in nothing but the run's own
 * identity. If the run read the wall clock, or generated a random id,
 * two runs would differ for reasons that have nothing to do with the
 * context resolution — and the test would be measuring the clock.
 *
 * ## Why the two runs are in **separate** harnesses
 *
 * Because a shared harness would share its stores, and the second run
 * would write over the first one's objects. Two runs that share state
 * are not two runs. The harnesses are built independently so the only
 * thing the two runs have in common is their **inputs**.
 */

import { describe, expect, it } from 'vitest';

import type { RoutingPolicy } from '@factory/contracts';
import type { RunRecord } from '@factory/artefacts';
import {
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeStateSink,
  InMemoryRunStore,
  runHello,
  type HelloContext,
} from '@factory/orchestrator';

import { harness as artefactHarness } from '../helpers/artefacts.ts';
import { THE_POLICY, buildGateway } from '../helpers/gateway.ts';

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The task's id.
 *
 * The **same** for both runs — it is the same trivial task.
 */
const TASK_ID = 'tsk_a0_4_0001';

/**
 * The context the run's stages see.
 *
 * A **real** manifest — an envelope id, a resolved digest, one item and
 * one gap — because the manifest is element 2 of the record and the
 * record must carry it verbatim.
 */
const CONTEXT: HelloContext = {
  manifest: {
    envelopeId: 'ctx_a0_4_0001',
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
 * A harness for **one** run.
 *
 * Each call builds its own stores, so two harnesses share nothing but
 * their inputs.
 *
 * @param runId the run's id — the only thing that differs between the
 *   two runs, and it differs on purpose so the test can tell the runs
 *   apart
 */
const buildHarness = (runId: string) => {
  const gatewayFixture = buildGateway({
    policy: THE_HELLO_POLICY,
    alpha: { usage: { tokensIn: 11, tokensOut: 7 } },
  });

  const artefacts = artefactHarness();
  const runs = new InMemoryRunStore();

  let counter = 0;

  const options = {
    gateway: gatewayFixture.gateway,
    artefacts: artefacts.objectStore,
    records: artefacts.store,
    runs,
    environments: new FakeEnvironmentRegistry(),
    credentials: new FakeCredentialReclaimer(),
    state: new FakeStateSink(),
    context: CONTEXT,
    taskId: TASK_ID,
    runId,
    clock: CLOCK,
    nextRunId: () => {
      counter += 1;
      return `run_a0_4_stage_${String(counter)}`;
    },
  };

  return { options, artefacts, runs, gatewayFixture };
};

/**
 * Run the workflow and read the record back **from the object store**.
 *
 * The record is read from the bytes that were written, not from the
 * run's return value — the outcome carries only the record's location
 * and its digest.
 *
 * @param harness the harness to run in
 */
const runAndReadRecord = async (
  harness: ReturnType<typeof buildHarness>,
): Promise<RunRecord> => {
  await runHello(harness.options);

  const bytes = await harness.artefacts.objectStore.get(
    `runs/${harness.options.runId}/record.json`,
  );
  expect(bytes).toBeDefined();
  return JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;
};

/* -------------------------------------------------------------------------- */
/* The tests                                                                  */
/* -------------------------------------------------------------------------- */

describe('A0.4 · two runs of the same trivial task resolve an identical context', () => {
  it('resolves the SAME context manifest in both runs', async () => {
    const one = await runAndReadRecord(buildHarness('run_a0_4_first'));
    const two = await runAndReadRecord(buildHarness('run_a0_4_second'));

    // The **manifest** — element 2 of the record — is the artefact of
    // the resolution. Compared field for field: a digest would say
    // "these differ", and the operator needs "this field differs".
    expect(two.context).toEqual(one.context);
    expect(two.context.resolvedContextSha256).toBe(
      one.context.resolvedContextSha256,
    );
    expect(two.context.envelopeId).toBe(one.context.envelopeId);
    expect(two.context.items).toEqual(one.context.items);
    expect(two.context.gaps).toEqual(one.context.gaps);
  });

  it('the record actually carries a context — the comparison is not vacuous', async () => {
    // The guard on the guard. The first version of this file compared
    // `outcome.record`, which is **undefined** — the outcome carries the
    // record's *location*, not the record. So `toEqual(undefined,
    // undefined)` passed against a build whose context resolution was
    // random.
    //
    // So the test now asserts that a context **is present**, and that it
    // is the one the run was given. Without this, every assertion above
    // could pass on `undefined`.
    const record = await runAndReadRecord(buildHarness('run_a0_4_present'));

    expect(record.context).toBeDefined();
    expect(record.context.resolvedContextSha256).toBe(
      CONTEXT.manifest.resolvedContextSha256,
    );
    expect(record.context.envelopeId).toBe(CONTEXT.manifest.envelopeId);
    expect(record.context.items).toHaveLength(1);
    expect(record.context.items[0]?.id).toBe('skill.hello');
  });

  it('resolves the same context even when the run ids differ', async () => {
    // The two runs differ in their run id, so this is not a test that
    // two runs of the *same* id agree — it is a test that the **context
    // resolution** does not depend on the run's identity.
    const one = await runAndReadRecord(buildHarness('run_a0_4_alpha'));
    const two = await runAndReadRecord(buildHarness('run_a0_4_omega'));

    expect(two.context).toEqual(one.context);
  });

  it('produces the same artefact digest in both runs', async () => {
    // The **whole run**, not only the context. A test that compared only
    // the context would pass even if the rest of the run were
    // non-deterministic — and the point of A0.4 is that the *same inputs
    // produce the same run*.
    const first = buildHarness('run_a0_4_first');
    const second = buildHarness('run_a0_4_second');

    const one = await runHello(first.options);
    const two = await runHello(second.options);

    expect(two.artefacts.map((artefact) => artefact.sha256)).toEqual(
      one.artefacts.map((artefact) => artefact.sha256),
    );
  });

  it('records the same observations in both runs', async () => {
    // The record's node list — one entry per node the run executed. Two
    // runs that resolved the same context and took the same path must
    // record the same nodes.
    const one = await runAndReadRecord(buildHarness('run_a0_4_first'));
    const two = await runAndReadRecord(buildHarness('run_a0_4_second'));

    expect(two.nodes.map((node) => node.nodeId)).toEqual(
      one.nodes.map((node) => node.nodeId),
    );
  });

  it('spends the same cost in both runs', async () => {
    // The cost comes from the gateway's **report**, not from the model,
    // so it is a function of the inputs and the pricing table. Two runs
    // that spend differently would mean one of them was not the same
    // run.
    const first = buildHarness('run_a0_4_first');
    const second = buildHarness('run_a0_4_second');

    const one = await runHello(first.options);
    const two = await runHello(second.options);

    expect(two.costUsdMicros).toBe(one.costUsdMicros);
  });

  it('the SAME harness run twice also resolves the same context', async () => {
    // The strongest form: **one** harness, run **twice**. If the second
    // run's context differed, the difference would come from the run
    // rather than from the harness.
    const harness = buildHarness('run_a0_4_repeat');

    const one = await runAndReadRecord(harness);
    const two = await runAndReadRecord(harness);

    expect(two.context).toEqual(one.context);
    expect(two.context.resolvedContextSha256).toBe(
      one.context.resolvedContextSha256,
    );
  });
});
