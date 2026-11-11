/**
 * `cli` — the token store.
 *
 * ## Where the token lives
 *
 * `~/.config/factory/credentials.json`, mode `0600`. The location follows
 * the XDG convention when `XDG_CONFIG_HOME` is set, and falls back to
 * `~/.config` otherwise.
 *
 * ## What is stored
 *
 * The **plaintext** token. That is deliberate and it is not a leak:
 * the CLI has to *present* the token on every call, so it has to hold
 * the thing it presents. The **server** stores it hashed — that is the
 * API's business, and T-1.14 does it (`hashToken`). The asymmetry is
 * the point of a bearer token: the holder can always re-present it, so
 * the client's copy is the sensitive part and the file's mode matters.
 *
 * HR-9: no real secrets here. The token in a test is a fake, and the
 * store never logs one.
 *
 * ## The mode is set, not hoped for
 *
 * The file is written with mode `0600` and the directory with `0700`.
 * `writeFile` honours the mode only when the file does **not** already
 * exist — so the mode is also set explicitly afterwards, with `chmod`.
 * A store that created the file with the default `0644` would put a
 * bearer token in every user's home directory, readable by every user
 * on the machine.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The credentials file's name.
 */
export const CREDENTIALS_FILE = 'credentials.json';

/**
 * The directory the credentials live in.
 *
 * `XDG_CONFIG_HOME` when it is set, and `~/.config` otherwise. The
 * environment is injected so a test can point it somewhere temporary —
 * the real home directory is never written to by a test.
 */
export const credentialsDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const xdg = environment['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg !== '') {
    return join(xdg, 'factory');
  }
  const home = environment['HOME'] ?? homedir();
  return join(home, '.config', 'factory');
};

/**
 * The credentials file's path.
 */
export const credentialsPath = (
  environment: NodeJS.ProcessEnv = process.env,
): string => join(credentialsDirectory(environment), CREDENTIALS_FILE);

/**
 * The stored credentials.
 */
export interface StoredCredentials {
  /** The API's base URL. */
  readonly apiUrl: string;
  /** The bearer token, in plaintext. */
  readonly token: string;
  /** When the token was stored. */
  readonly storedAt: string;
}

/**
 * Read the stored credentials.
 *
 * `undefined` when there are none, or when the file cannot be read or
 * parsed. A corrupt credentials file is treated as no credentials: the
 * CLI then says "not logged in", which the operator can fix, rather than
 * crashing with a parse error.
 */
export const readCredentials = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials | undefined> => {
  let raw: string;
  try {
    raw = await readFile(credentialsPath(environment), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    const apiUrl = record['apiUrl'];
    const token = record['token'];
    if (typeof apiUrl !== 'string' || typeof token !== 'string') {
      return undefined;
    }
    const storedAt = typeof record['storedAt'] === 'string' ? record['storedAt'] : '';
    return { apiUrl, token, storedAt };
  } catch {
    return undefined;
  }
};

/**
 * Store the credentials.
 *
 * The write is **atomic**: the file is written to a temporary name and
 * then renamed over the target. A crash halfway through must not leave a
 * half-written credentials file — a truncated JSON file would read as
 * "not logged in" and quietly lose the operator's token.
 *
 * The mode is set on the file **and** the directory.
 */
export const writeCredentials = async (
  credentials: StoredCredentials,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const path = credentialsPath(environment);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);

  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
};

/**
 * Remove the stored credentials.
 *
 * `true` when there were credentials to remove.
 */
export const clearCredentials = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> => {
  const existing = await readCredentials(environment);
  if (existing === undefined) {
    return false;
  }
  const { unlink } = await import('node:fs/promises');
  await unlink(credentialsPath(environment)).catch(() => undefined);
  return true;
};
