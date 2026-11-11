/**
 * `hello/completion-executor` — the `completion` executor (T-1.17).
 *
 * ## What a `completion` executor is
 *
 * blueprint `09` §8.1's "Agent?" column splits the stage kinds into those
 * a model answers and those code answers. The model-answered ones are
 * *completions*: **one** structured model call through the gateway.
 *
 * So the executor is thin by design: it builds a {@link ModelRequest},
 * calls the gateway, and turns the answer into a {@link StageResult}. The
 * interesting parts are all in the gateway — the routing, the budget, the
 * failover, the idempotency — and this executor must not reimplement any
 * of them.
 *
 * ## Why the artefact is written **here**
 *
 * The stage that produces the artefact has to **write** it, because the
 * artefact's bytes must exist before the record names them: the record's
 * element 7 carries the artefact's `uri` and `sha256`, and a record that
 * names an artefact which does not exist is a record that lies.
 *
 * So the executor writes the artefact through the artefact store's
 * **object store** port, and returns its `ref` and digest. The record
 * stage then names it.
 *
 * ## The failure classes
 *
 * The executor returns failures, it does not throw them (the
 * {@link StageExecutor} contract). The classes are the **contracts'**
 * ten — blueprint `08` §4.3's vocabulary — and the executor does not get
 * to invent one:
 *
 * * the **gateway's** class is carried through unchanged, because the
 *   gateway is what knows whether the provider was down
 *   (`environment.failure`), the budget was spent (`budget.exhausted`),
 *   the model could not do the work (`model.capability`) or the answer
 *   was wrong (`model.reasoning`). Replacing that with a generic
 *   "the model call failed" would lose the distinction that decides
 *   whether the failure is retried, escalated or re-planned;
 * * `workflow.composition` — the executor could not do its job at all
 *   (the artefact store was unreachable, the prompt could not be built).
 *   That is a *composition* failure, not a model failure, and the
 *   distinction matters because the two are retried differently;
 * * `unknown` — an error that carries no recognisable class. The runner
 *   treats it as `workflow.composition`, which is what an
 *   unclassifiable failure is.
 */

import {
  FAILURE_CLASSES,
  type FailureClass,
  type ModelGateway,
  type ModelRequest,
  type ModelResponse,
} from '@factory/contracts';
import { toSha256Digest } from '@factory/core';

import type {
  CancellationToken,
  StageExecutor,
  StageInput,
  StageResult,
} from '../runtime/ports.js';

import type { RunObservations } from './observations.js';

/**
 * The object store the artefact is written through.
 *
 * The narrow slice of the artefact store's port the executor needs — it
 * writes a **produced artefact**, not a run record, so it does not need
 * the index or the spool.
 *
 * The `put` returns the object's **location**, because that is what the
 * artefact store's own port returns, and a port that a real
 * implementation cannot satisfy is a port that only works with a fake.
 * The executor does not need the location — the artefact's key is the
 * reference it names — but the port does not get to be narrower than the
 * thing it ports.
 */
export interface ArtefactSink {
  /**
   * Put an artefact's bytes under a key.
   *
   * @param key the store key — `runs/<runId>/<name>`
   * @param bytes the artefact's bytes
   */
  put(key: string, bytes: Uint8Array): Promise<unknown>;
}

/**
 * The digest form the artefact's hash takes — `sha256:<64 hex>`.
 */
export type ArtefactDigest = `sha256:${string}`;

/**
 * What the executor is told about the run.
 */
export interface CompletionExecutorOptions {
  /** The gateway the model call goes through. */
  readonly gateway: ModelGateway;
  /** Where the artefact's bytes go. */
  readonly artefacts: ArtefactSink;
  /** The observations the run's facts are recorded into. */
  readonly observations: RunObservations;
  /**
   * The prompt the stage sends.
   *
   * A function of the input, so the prompt is **derived** from what the
   * stage was given rather than hard-coded. A hard-coded prompt would
   * make the context irrelevant, and then the run would not prove that
   * the context reached the model.
   */
  readonly prompt: (input: StageInput) => string;
  /**
   * The name the artefact is stored under.
   *
   * A function of the stage input, so the key is **per stage**: two
   * completion stages in one run must not write to the same key, or the
   * second would overwrite the first and the record would name an
   * artefact that is not the one the stage produced.
   *
   * The default is the stage's id with a `.txt` suffix — the artefact is
   * the model's text answer, so it is stored as text.
   */
  readonly artefactName?: (input: StageInput) => string;
  /**
   * What the stage's output **is** — the run's artefact, or the
   * specification that is input to it.
   *
   * The distinction is the workflow's, not the executor's: the executor
   * cannot tell from the stage input which of the two it is producing, and
   * guessing would put the specification into the record's element 7
   * alongside the artefact.
   *
   * It is a function of the input for the same reason the name is: the
   * registry keys executors by *kind*, so one `completion` executor serves
   * every completion stage in the run, and the **stage** is what tells it
   * which of the two the output is.
   */
  readonly artefactKind?: (input: StageInput) => 'artefact' | 'specification';
}

/**
 * The failure classes this executor reports.
 *
 * They are the **contracts'** classes — blueprint `08` §4.3's ten — not
 * new ones. The executor does not get to invent a vocabulary: the runner
 * classifies a failure against the contracts' retry policy, and a class
 * the policy does not know has no policy, so it would be classified as
 * `unknown` and reported as `workflow.composition` whether or not that
 * was true.
 *
 * * `workflow.composition` — the executor could not do its job at all (the
 *   artefact store was unreachable, the prompt could not be built). That
 *   is a *composition* failure, not a model failure, and the distinction
 *   matters because the two are retried differently.
 * * `model.capability` — the gateway refused the call: the model cannot
 *   do this work, or the budget would not allow it.
 * * `model.reasoning` — the model answered, and the answer was wrong.
 * * `environment.failure` — the provider was down or rate-limited.
 */
export const COMPLETION_FAILURE_CLASSES = [
  'workflow.composition',
  'model.capability',
  'model.reasoning',
  'environment.failure',
] as const satisfies readonly FailureClass[];

/**
 * The `completion` stage executor.
 */
export class CompletionExecutor implements StageExecutor {
  public readonly kind = 'completion';

  readonly #options: CompletionExecutorOptions;

  public constructor(options: CompletionExecutorOptions) {
    this.#options = options;
  }

  public async run(
    input: StageInput,
    token: CancellationToken,
  ): Promise<StageResult> {
    // The cancellation check is a **step boundary** — pack `02` §4.9.
    // A cancelled stage does not start a model call.
    if (token.cancelled) {
      return {
        status: 'failure',
        failureClass: 'workflow.composition',
        summary: `the stage was cancelled before it ran: ${token.reason ?? 'no reason given'}`,
      };
    }

    // The node's observation is opened **before** anything happens, so a
    // stage that failed still appears in the record — a node that ran and
    // failed is a fact, and a record that omitted it would say the run
    // did less than it did.
    const node = this.#options.observations.node(input.nodeId);
    node.role = input.modelPolicy.role;
    node.attempts = input.attempt;

    // ---- 1. the prompt ------------------------------------------------
    let prompt: string;
    try {
      prompt = this.#options.prompt(input);
    } catch (error) {
      return {
        status: 'failure',
        failureClass: 'workflow.composition',
        summary: `the prompt could not be built: ${describe(error)}`,
      };
    }

    // The prompt is recorded **before** the call, so a run that died
    // mid-call still leaves the prompt in the record. Element 5 is "all
    // prompts and generated text", and a prompt that was sent is a fact
    // even if the answer never came.
    this.#options.observations.addPrompt({
      kind: 'prompt',
      role: 'user',
      text: prompt,
      sha256: toSha256Digest(prompt),
    });

    // ---- 2. the model call --------------------------------------------
    const request = this.#request(input, prompt);

    let response: ModelResponse;
    try {
      const outcome = await this.#options.gateway.complete(request);
      if (!outcome.ok) {
        // The gateway **classified** the failure — it knows whether the
        // budget was exhausted, the provider was down, or the model
        // could not do the work. So its class is carried, not replaced:
        // a class invented here would lose the distinction between "the
        // provider is down" (retried by the infrastructure) and "the
        // model cannot do this" (re-planned).
        return {
          status: 'failure',
          failureClass: failureClassOf(outcome.error),
          summary: `the model call failed: ${describe(outcome.error)}`,
        };
      }
      response = outcome.value;
    } catch (error) {
      // The gateway does not throw for an expected failure — but an
      // executor that dies here would take the loop with it, so the
      // throw is caught and reported. A throw is not a classified
      // failure, so it is `unknown` — which the runner treats as
      // `workflow.composition`.
      return {
        status: 'failure',
        failureClass: 'unknown',
        summary: `the model call threw: ${describe(error)}`,
      };
    }

    // ---- 3. the observations -------------------------------------------
    //
    // The usage comes from the **gateway's** report, not from the
    // model's answer. The gateway is the framework, and its report is
    // what the budget was checked against.
    this.#options.observations.addUsage({
      tokensIn: response.usage.tokensIn,
      tokensOut: response.usage.tokensOut,
      costUsdMicros: response.usage.costUsdMicros,
    });
    this.#options.observations.model = {
      provider: response.provider,
      model: response.model,
      version: response.model,
    };
    this.#options.observations.turns += 1;
    node.model = this.#options.observations.model;
    node.turns += 1;

    // The model's answer is **generated text** — element 5.
    this.#options.observations.addPrompt({
      kind: 'generated',
      role: 'assistant',
      text: response.content,
      sha256: toSha256Digest(response.content),
    });

    // ---- 4. the artefact ----------------------------------------------
    //
    // The bytes are written **before** the result names them, so the
    // record never names an artefact that is not there.
    //
    // The key is **per stage**, so the `specify` stage's answer and the
    // `implement` stage's answer are two different artefacts rather than
    // one overwriting the other.
    const name = this.#options.artefactName?.(input) ?? `${input.nodeId}.txt`;
    const key = `runs/${input.taskId}/${name}`;
    const bytes = new TextEncoder().encode(response.content);

    try {
      await this.#options.artefacts.put(key, bytes);
    } catch (error) {
      return {
        status: 'failure',
        failureClass: 'workflow.composition',
        summary: `the artefact could not be written: ${describe(error)}`,
      };
    }

    const digest = toSha256Digest(bytes);

    const produced = {
      kind: 'artefact',
      uri: key,
      sha256: digest,
      bytes: bytes.byteLength,
    };

    if (this.#options.artefactKind?.(input) === 'specification') {
      this.#options.observations.addSpecification(produced);
      // The specification is the node's own output, but it is **not** the
      // run's artefact — so it is not in element 7 and not in the node's
      // artefact list.
    } else {
      this.#options.observations.addArtefact(produced);
      node.artefacts.push(produced);
      // The authority named the change the run produced. The change's
      // digest is known **now** — so it is filled in now, before the
      // record stage assembles the record that carries the authority.
      this.#options.observations.nameAuthorisedArtefact(digest);
    }

    return {
      status: 'success',
      artefacts: [{ ref: key, sha256: digest }],
      observability: {
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        costUsdMicros: response.usage.costUsdMicros,
      },
      summary: `the model answered with ${String(response.content.length)} characters`,
    };
  }

  /**
   * Build the model request.
   */
  #request(input: StageInput, prompt: string): ModelRequest {
    const messages = [{ role: 'user' as const, content: prompt }];

    return {
      role: input.modelPolicy.role,
      taskId: input.taskId,
      nodeId: input.nodeId,
      attempt: input.attempt,
      messages,
      ...(input.modelPolicy.complexity === undefined
        ? {}
        : { routingHints: { complexity: input.modelPolicy.complexity } }),
    };
  }
}

/**
 * Describe a thrown value for a summary line.
 */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The failure class the gateway reported.
 *
 * The gateway's error is a `FactoryError`, whose `class` is one of the
 * contracts' ten. So the class is **read**, not guessed — and an error
 * that carries no recognisable class is `unknown`, which the runner
 * treats as `workflow.composition`.
 *
 * The check is against the **contracts'** ten classes, not against the
 * executor's own subset: the gateway may legitimately report
 * `policy.denied` or `budget.exhausted`, and narrowing the set here
 * would turn a precise refusal into a vague one.
 *
 * @param error the gateway's error
 */
const failureClassOf = (error: unknown): FailureClass => {
  if (typeof error === 'object' && error !== null && 'class' in error) {
    const candidate = (error as { readonly class: unknown }).class;
    if (
      typeof candidate === 'string' &&
      (FAILURE_CLASSES as readonly string[]).includes(candidate)
    ) {
      return candidate as FailureClass;
    }
  }
  return 'unknown';
};
