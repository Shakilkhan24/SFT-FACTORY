/**
 * `hello/workflow` — **the `H.hello` workflow** (T-1.17).
 *
 * ## What this workflow is for
 *
 * blueprint `16` §3.1 states the Phase-0 objective:
 *
 * > Build the control plane's spine … At the end of this phase, the
 * > factory can run a trivial task, refuse an unauthorised one, and
 * > record everything.
 *
 * `H.hello` is the **trivial task**, and it is the *exit criterion* for
 * Phase 0. checklist 03's exit criteria say:
 *
 * > - [ ] The `H.hello` workflow runs end to end: FakeProvider → artefact
 *       → record.
 *
 * So the workflow is deliberately the **smallest** thing that exercises the
 * whole spine. It has three stages and no branch:
 *
 * | # | Stage | Executor | What it does |
 * |---|---|---|---|
 * | 1 | `specify` | `completion` | asks the model for the specification |
 * | 2 | `implement` | `completion` | asks the model for the artefact |
 * | 3 | `record` | `deterministic` | assembles and writes the run record |
 *
 * ## Why `implement` runs the `completion` executor and not `harness`
 *
 * ADR-0017 permits the `harness` executor for `implement` — but the
 * harness is "a coding agent inside the T2 sandbox", and T2 is a later
 * ticket. So `H.hello` declares `executor: completion` for its
 * `implement` stage, which the registry permits for any implemented stage
 * kind that is not excluded.
 *
 * The declaration is **explicit** rather than defaulted, because the whole
 * point of `H.hello` is that the workflow says what it means: the stage
 * that produces the artefact says "I am a model completion", not "I am a
 * sandboxed coding agent".
 *
 * ## Why the workflow is *data*, not code
 *
 * The stage sequence is a **value** — a list of stages — rather than a
 * sequence of calls to the runner. That is what lets the same list be
 * used three ways:
 *
 * * the {@link ExecutionLoop} runs it;
 * * the record writer reads it to know which stages produced what;
 * * a test can assert on it without running anything.
 *
 * A workflow written as code could only be run, never inspected.
 *
 * ## The three stages and what each proves
 *
 * * `specify` — the **context** reaches the model. The stage's input
 *   carries the assembled context envelope, and the specification is the
 *   model's answer to it. If the context did not reach the model, the
 *   artefact could not cite it.
 * * `implement` — the **artefact** is produced. The stage's result carries
 *   the artefact's ref and digest, and the digest is the artefact's
 *   identity in the run record.
 * * `record` — the **record** is written. The stage assembles the
 *   twelve-element record from what the framework observed and hands it
 *   to the artefact store, which asserts its completeness (A0.3) and
 *   writes it.
 *
 * The chain is **the Phase-0 claim itself**: *the factory can run a
 * trivial task and record everything*.
 */

import type { ExecutorKind, StageKind } from '@factory/contracts';

/**
 * A stage of the `H.hello` workflow.
 */
export interface HelloStage {
  /** The stage's id — unique within the workflow. */
  readonly id: string;
  /** The stage kind — decides the *default* executor, and the guards. */
  readonly kind: StageKind;
  /** The executor the stage declares. */
  readonly executor: ExecutorKind;
  /** The role the stage plays. */
  readonly role: string;
  /**
   * Whether the stage's result is the run's **artefact**.
 *
   * Exactly one stage carries the artefact — the `implement` stage. The
   * `specify` stage produces a specification, which is *input* to the
   * artefact rather than the artefact itself.
   */
  readonly producesArtefact: boolean;
  /**
   * Whether the stage's result is the run's **specification**.
   *
   * Exactly one stage carries it — the `specify` stage.
   */
  readonly producesSpecification: boolean;
}

/**
 * The workflow's id.
 *
 * `H.hello` is the name the checklist and the blueprint use, so it is the
 * name the workflow carries — not `wf_hello`, and not a generated id.
 */
export const HELLO_WORKFLOW_ID = 'H.hello';

/**
 * The workflow's version.
 *
 * The workflow id and version are the **spec version** in the run record's
 * element 1, so a record says exactly which workflow produced it.
 */
export const HELLO_WORKFLOW_VERSION = '1.0.0';

/**
 * The `H.hello` workflow's stages, in order.
 *
 * The order is the **dependency order**: `specify` before `implement`
 * before `record`. The loop does not re-sort it (the caller establishes
 * the topological order), so this list is the order.
 */
export const HELLO_STAGES: readonly HelloStage[] = [
  {
    id: 'specify',
    kind: 'specify',
    executor: 'completion',
    role: 'refinement',
    producesArtefact: false,
    producesSpecification: true,
  },
  {
    id: 'implement',
    kind: 'implement',
    executor: 'completion',
    role: 'worker',
    producesArtefact: true,
    producesSpecification: false,
  },
  {
    id: 'record',
    kind: 'record',
    executor: 'deterministic',
    role: 'worker',
    producesArtefact: false,
    producesSpecification: false,
  },
];

/**
 * The stage that carries the run's specification.
 */
export const SPECIFICATION_STAGE = 'specify';

/**
 * The stage that carries the run's artefact.
 */
export const ARTEFACT_STAGE = 'implement';

/**
 * The stage that writes the run's record.
 */
export const RECORD_STAGE = 'record';

/**
 * The stage by id.
 *
 * @param id the stage's id
 */
export const helloStage = (id: string): HelloStage | undefined =>
  HELLO_STAGES.find((stage) => stage.id === id);
