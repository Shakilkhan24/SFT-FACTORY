/**
 * `runtime/fakes/fake-executor` — the fake stage executors.
 *
 * ## Why the fake records what it was asked
 *
 * The oracle's second proof is "an idempotent node handler", and the
 * runner's order is "build the input → run → persist → transition". Both
 * are only observable if the test can see **what the executor was given**.
 *
 * So the fake records its inputs, and the test asserts on them — in
 * particular on the fact that the input carries the **upstream artefact
 * only**, and not the whole history.
 */

import type {
  CancellationToken,
  HarnessAdapter,
  StageExecutor,
  StageInput,
  StageResult,
} from '../ports.js';

/**
 * A fake executor.
 */
export class FakeExecutor implements StageExecutor {
  /** The inputs the executor was called with, in order. */
  readonly calls: StageInput[] = [];
  /** The tokens the executor was called with, in order. */
  readonly tokens: CancellationToken[] = [];

  readonly #kind: string;
  readonly #result: StageResult | (() => StageResult | Promise<StageResult>);
  readonly #throws: Error | undefined;

  /**
   * @param kind the executor kind
   * @param result what to return — a result, or a function producing one
   * @param throws an error to throw instead of returning
   */
  public constructor(
    kind: string,
    result: StageResult | (() => StageResult | Promise<StageResult>) = {
      status: 'success',
    },
    throws?: Error,
  ) {
    this.#kind = kind;
    this.#result = result;
    this.#throws = throws;
  }

  public get kind(): string {
    return this.#kind;
  }

  public run(input: StageInput, token: CancellationToken): Promise<StageResult> {
    this.calls.push(input);
    this.tokens.push(token);
    if (this.#throws !== undefined) {
      return Promise.reject(this.#throws);
    }
    if (typeof this.#result === 'function') {
      return Promise.resolve(this.#result());
    }
    return Promise.resolve(this.#result);
  }
}

/**
 * A fake harness adapter.
 */
export class FakeHarnessAdapter implements HarnessAdapter {
  /** The runs that were killed, in order. */
  readonly killed: string[] = [];
  /** The inputs the adapter ran, in order. */
  readonly calls: StageInput[] = [];

  readonly #result: StageResult;
  readonly #killThrows: Error | undefined;

  public constructor(
    result: StageResult = { status: 'success' },
    killThrows?: Error,
  ) {
    this.#result = result;
    this.#killThrows = killThrows;
  }

  public run(input: StageInput, _token: CancellationToken): Promise<StageResult> {
    this.calls.push(input);
    return Promise.resolve(this.#result);
  }

  public kill(runId: string): Promise<void> {
    if (this.#killThrows !== undefined) {
      return Promise.reject(this.#killThrows);
    }
    this.killed.push(runId);
    return Promise.resolve();
  }
}
