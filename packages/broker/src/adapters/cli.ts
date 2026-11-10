/**
 * The CLI adapter.
 *
 * A capability implemented by an external program, reached by running it.
 *
 * ## Why argv arrays only
 *
 * The adapter accepts **argv arrays only**. A shell string is a **hard
 * error**, because a capability's arguments must never be concatenated into
 * a command line: that is command injection, and the factory's arguments
 * come from an agent, which is not a trusted source.
 *
 * So there is no `exec`, no `sh -c`, and no string interpolation anywhere in
 * this file. The spawn function is **injected**, so no test shells out to
 * `git` or to anything else.
 *
 * ## The credential
 *
 * The credential is passed through the **environment**, not the command
 * line. A command line is visible in the process table; the environment is
 * not (on Linux, `/proc/<pid>/environ` is readable only by the owner, but
 * the *command line* is world-readable). And a credential in an argv would
 * also end up in the invocation record's argument summary if the summary
 * echoed the argv.
 */

import { assertGuardToken } from './factory.js';
import type { AdapterCapability, ToolAdapterLike } from './types.js';

/**
 * The spawn function the adapter uses.
 *
 * It is injected, and its signature is deliberately narrow: an **argv
 * array** and an environment. There is no shell string parameter, so a
 * caller cannot ask for one.
 */
export type SpawnFunction = (
  argv: readonly string[],
  options: {
    readonly env: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
    readonly cwd?: string;
  },
) => Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }>;

/**
 * How a CLI capability is run.
 */
export interface CliCapability extends AdapterCapability {
  /** The program to run. */
  readonly program: string;
  /**
   * The arguments, as **tokens**.
   *
   * A token may contain `{arg}` placeholders, which are substituted from
   * the call's arguments — one token to one value, so a value can never
   * become two arguments and can never be re-parsed as a flag.
   */
  readonly args?: readonly string[];
  /** The environment variable the credential is passed in, when the capability needs one. */
  readonly credentialEnvVar?: string;
}

/**
 * The CLI adapter.
 */
export class CliAdapter implements ToolAdapterLike {
  readonly #capabilities: readonly CliCapability[];
  readonly #spawn: SpawnFunction;

  constructor(capabilities: readonly CliCapability[], spawn: SpawnFunction) {
    this.#capabilities = capabilities;
    this.#spawn = spawn;
  }

  public describe(): readonly AdapterCapability[] {
    return this.#capabilities;
  }

  /**
   * Invoke a capability.
   *
   * @throws {AdapterGuardError} when the guard token is not the factory's.
   */
  public async invoke(
    capabilityId: string,
    args: unknown,
    credential: unknown,
    signal: AbortSignal,
    token: symbol,
  ): Promise<unknown> {
    assertGuardToken(token);

    const capability = this.#capabilities.find((entry) => entry.id === capabilityId);
    if (capability === undefined) {
      throw new Error(`the CLI adapter does not serve ${capabilityId}`);
    }

    const argv = [
      capability.program,
      ...substituteTokens(capability.args ?? [], args),
    ];

    const env: Record<string, string> = {};
    if (credential !== undefined && capability.credentialEnvVar !== undefined) {
      const secret = secretOf(credential);
      if (secret !== undefined) {
        env[capability.credentialEnvVar] = secret;
      }
    }

    const result = await this.#spawn(argv, { env, signal });

    if (result.code !== 0) {
      throw new Error(
        `${capability.program} exited with code ${result.code}: ${result.stderr.trim()}`,
      );
    }

    // The stdout is JSON when it parses as JSON, and the raw text
    // otherwise — a CLI capability is not obliged to emit JSON, but most do.
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      return result.stdout;
    }
  }

  public health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'> {
    return Promise.resolve('healthy');
  }

  public close(): Promise<void> {
    // Nothing to release.
    return Promise.resolve();
  }
}

/**
 * Substitute `{arg}` placeholders in the argv tokens.
 *
 * ## Why a placeholder is one token to one value
 *
 * The substitution happens **per token**, and a substituted value is never
 * re-split. So a value containing a space is one argument, and a value
 * containing `; rm -rf /` is one argument — not a command.
 *
 * A placeholder with no matching argument is a **hard error**: a missing
 * argument must not silently become an empty token, because an empty token
 * can change what a program does (`git push --` behaves differently from
 * `git push`).
 */
export const substituteTokens = (
  tokens: readonly string[],
  args: unknown,
): string[] => {
  const record =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  return tokens.map((token) => {
    const match = /^\{([A-Za-z0-9_.]+)\}$/.exec(token);
    if (match === null) {
      return token;
    }
    const name = match[1] as string;
    if (!(name in record)) {
      throw new Error(`the argument ${name} is required by the capability but was not supplied`);
    }
    const value = record[name];
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    throw new Error(`the argument ${name} is not a string, number or boolean`);
  });
};

/**
 * The secret, from a credential.
 */
const secretOf = (credential: unknown): string | undefined => {
  if (typeof credential === 'object' && credential !== null) {
    const secret = (credential as { readonly secret?: unknown }).secret;
    if (typeof secret === 'string') {
      return secret;
    }
  }
  return undefined;
};
