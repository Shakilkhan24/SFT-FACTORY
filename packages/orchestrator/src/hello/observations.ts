/**
 * `hello/observations` — **the framework's observations of a run** (T-1.17).
 *
 * ## Why this is a separate thing
 *
 * blueprint `15` §2.4: "The runtime and control plane write the artefact.
 * An agent never writes it, and never writes a field of it (MEAS-02)."
 *
 * So the record is assembled from what the **framework** observed, and
 * the collector is where those observations are *recorded* as the run
 * proceeds. It is deliberately a separate object from the record
 * executor, so the question "who wrote this field?" has an answer: the
 * collector was written by the framework's own code paths, and the record
 * executor only *reads* it.
 *
 * ## What the collector refuses to do
 *
 * It refuses to take a value from a **model**. The model's answer enters
 * the record in exactly two places, and both are facts about what the
 * model *said*:
 *
 * * the **produced artefact** — the bytes the model produced, with their
 *   digest;
 * * the **generated text** — element 5, "all prompts and generated text".
 *
 * There is no third door. A field that could be set from a model's
 * answer — the outcome, the cost, the authority — is not on the
 * collector's interface.
 *
 * ## Why the collector is a *class* and not a plain object
 *
 * Because the observations are **accumulated**: the model call reports
 * its usage, the artefact stage reports the artefact, and the record
 * stage reads the accumulation. A plain object would have to be threaded
 * through every signature; a collector is shared by reference, and its
 * methods are the only way to change it.
 */

import type {
  ContextManifest,
  ModelRef,
  ProducedArtefact,
  PromptRecord,
  ToolCallRecord,
  VerificationResult,
  AuthorityRecord,
  PolicyDecisionRecord,
} from '@factory/artefacts';

/**
 * The observation of one **node** of a run.
 *
 * The shape of blueprint `15` §2.3's `nodes[]` entry, but mutable — the
 * collector fills it in as the node runs, and the record executor reads
 * it when it assembles the record.
 */
export interface NodeObservation {
  /** The node's id. */
  readonly nodeId: string;
  /** The role the node played. */
  role: string;
  /** The model the node used — `undefined` for a node that used none. */
  model: ModelRef | undefined;
  /** How many attempts the node took. */
  attempts: number;
  /** How many turns the node took. */
  turns: number;
  /** How long the node ran, in milliseconds. */
  durationMs: number;
  /** The node's tool calls — element 4. */
  readonly toolCalls: ToolCallRecord[];
  /** The node's artefacts — element 7. */
  readonly artefacts: ProducedArtefact[];
  /** The node's verification results — element 6. */
  readonly verification: VerificationResult[];
}

/**
 * The collector of a run's observations.
 */
export class RunObservations {
  /** The prompts and generated text — element 5. */
  readonly prompts: PromptRecord[] = [];
  /** The artefacts produced — element 7. */
  readonly artefacts: ProducedArtefact[] = [];
  /**
   * The specifications produced.
   *
   * A specification is **input** to the artefact, not the artefact. It is
   * kept apart so element 7 names the artefact and only the artefact — a
   * record that listed the specification among the artefacts would say
   * the run produced two things when it produced one.
   */
  readonly specifications: ProducedArtefact[] = [];
  /** The tool calls — element 4. */
  readonly toolCalls: ToolCallRecord[] = [];
  /** The verification results — element 6. */
  readonly verification: VerificationResult[] = [];
  /** The authorities — element 9. */
  readonly authority: AuthorityRecord[] = [];
  /** The policy decisions — element 12. */
  readonly policyDecisions: PolicyDecisionRecord[] = [];
  /**
   * The **nodes** the run executed — blueprint `15` §2.3's `nodes[]`.
   *
   * The record carries one entry per node, each with its own model, its
   * own tool calls, its own artefacts and its own verification. A run
   * that collapsed all of that into one entry would say the `record`
   * stage did the work the `implement` stage did.
   */
  readonly nodes: NodeObservation[] = [];

  /** The model the run used. */
  model: ModelRef | undefined;
  /** The input tokens the run consumed. */
  tokensIn = 0;
  /** The output tokens the run consumed. */
  tokensOut = 0;
  /** The model's cost, in micro-USD. */
  modelUsdMicros = 0;
  /** The turns the run took. */
  turns = 0;
  /** When the run started. */
  startedAt = '';
  /** When the run completed. */
  completedAt = '';

  /**
   * The observation of one **node** of the run.
   */
  public node(nodeId: string): NodeObservation {
    const existing = this.nodes.find((entry) => entry.nodeId === nodeId);
    if (existing !== undefined) {
      return existing;
    }
    const created: NodeObservation = {
      nodeId,
      role: '',
      model: undefined,
      attempts: 1,
      turns: 0,
      durationMs: 0,
      toolCalls: [],
      artefacts: [],
      verification: [],
    };
    this.nodes.push(created);
    return created;
  }

  /**
   * Record a prompt.
   *
   * @param prompt the prompt
   */
  public addPrompt(prompt: PromptRecord): void {
    this.prompts.push(prompt);
  }

  /**
   * Record a produced artefact.
   *
   * @param artefact the artefact
   */
  public addArtefact(artefact: ProducedArtefact): void {
    this.artefacts.push(artefact);
  }

  /**
   * Record a produced specification.
   *
   * @param specification the specification
   */
  public addSpecification(specification: ProducedArtefact): void {
    this.specifications.push(specification);
  }

  /**
   * Name the artefact the run's authority was given over.
   *
   * The authority is recorded at the **start** of the run — the intent
   * existed before the artefact did — but it names the change the run
   * produced, and the change's digest is only known once the artefact has
   * been written. So the digest is filled in at that moment.
   *
   * It is filled in **before** the record stage runs, not after: the
   * record is the thing that carries the authority, so a digest patched
   * after the record was written would be a digest the record does not
   * carry — the record would name one artefact and the observation would
   * name another.
   *
   * @param sha256 the artefact's digest
   */
  public nameAuthorisedArtefact(sha256: string): void {
    const index = this.authority.findIndex((entry) => entry.action === 'run');
    if (index === -1) {
      return;
    }
    const authority = this.authority[index];
    if (authority === undefined) {
      return;
    }
    this.authority[index] = { ...authority, artefactSha256: sha256 };
  }

  /**
   * Record a model call's usage.
   *
   * The usage comes from the **gateway's** report, not from the model's
   * answer — the gateway is the framework, and its report is what the
   * budget was checked against.
   */
  public addUsage(usage: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly costUsdMicros: number;
  }): void {
    this.tokensIn += usage.tokensIn;
    this.tokensOut += usage.tokensOut;
    this.modelUsdMicros += usage.costUsdMicros;
  }

  /**
   * The cost summary — element 10.
   *
   * `H.hello` makes no tool calls and runs no infrastructure, so the tool
   * and infrastructure costs are zero — which is a **fact about this
   * workflow**, not a default that would be wrong for another one.
   */
  public cost(): {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly tokensCacheRead: number;
    readonly tokensCacheWrite: number;
    readonly modelUsdMicros: number;
    readonly toolUsdMicros: number;
    readonly infraUsdMicros: number;
    readonly totalUsdMicros: number;
  } {
    return {
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      modelUsdMicros: this.modelUsdMicros,
      toolUsdMicros: 0,
      infraUsdMicros: 0,
      totalUsdMicros: this.modelUsdMicros,
    };
  }
}

/**
 * The context manifest a run's stages see.
 *
 * Element 2 of the record. It is injected, because the context
 * assembler's own output belongs to T-2.01 and this run's job is to
 * prove that a manifest **reaches the model** and **reaches the record**.
 */
export interface HelloContext {
  /** The manifest — the *index* of the context. */
  readonly manifest: ContextManifest;
  /**
   * The context's **body** — what the model is told.
   *
   * The manifest is the index and the body is the context itself. Both
   * travel, so the run proves the stage input carries the context and
   * not merely a reference to it.
   */
  readonly body: string;
}
