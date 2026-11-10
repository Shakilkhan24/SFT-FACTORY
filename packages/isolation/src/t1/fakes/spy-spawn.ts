/**
 * `t1/fakes/spy-spawn` — the spawn double.
 *
 * The spy **records every argv it is given**, which is what makes the
 * "hooks disabled" proof possible: the ticket's own wording is *"git is
 * invoked with hooks disabled (spy assertion)"*, so the assertion has to
 * read the argv the package actually built.
 *
 * The spy also **answers**: it returns a canned tar stream for `git
 * archive`, so the snapshot can be exercised without a repository and
 * without a subprocess.
 */

import type { SpawnFunction } from '../ports.js';

export interface SpyCall {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string | undefined;
}

export interface SpySpawnOptions {
  /** The stdout for a `git archive` call. */
  readonly stdout?: Uint8Array;
  /** The exit code for a `git archive` call. */
  readonly code?: number;
  /** The stderr for a `git archive` call. */
  readonly stderr?: string;
}

export class SpySpawn {
  /** Every call, in order. */
  public readonly calls: SpyCall[] = [];

  readonly #options: SpySpawnOptions;

  constructor(options: SpySpawnOptions = {}) {
    this.#options = options;
  }

  /** The spawn function to inject. */
  public get spawn(): SpawnFunction {
    return (argv, options): Promise<{
      stdout: Uint8Array;
      stderr: string;
      code: number;
    }> => {
      this.calls.push({ argv: [...argv], env: options.env, cwd: options.cwd });
      return Promise.resolve({
        stdout: this.#options.stdout ?? new Uint8Array(0),
        stderr: this.#options.stderr ?? '',
        code: this.#options.code ?? 0,
      });
    };
  }

  /** The argv of the last call, or `undefined` when nothing was called. */
  public get lastArgv(): readonly string[] | undefined {
    return this.calls[this.calls.length - 1]?.argv;
  }
}
