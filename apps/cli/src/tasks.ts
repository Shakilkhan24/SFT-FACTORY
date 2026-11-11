/**
 * `cli` — `factory login`, `factory whoami` and `factory tasks`.
 *
 * ## Why `login` is token-based
 *
 * The proper flow is the GitHub OAuth device flow: the CLI shows a code,
 * the operator confirms it in a browser, and the CLI exchanges it for a
 * token. That needs a **GitHub OAuth app**, and HR-9 forbids putting a
 * real secret in this repository. So `login` takes a token the operator
 * already holds (`--token fac_…`), and the device flow is a proposed
 * ticket once the owner creates the app.
 *
 * This is not a shortcut around the contract — the token is the same
 * artefact the device flow would produce, and the API treats it
 * identically. Only the *way it is obtained* differs.
 *
 * ## Why `login` proves the token before storing it
 *
 * `login` calls the API and stores the token only if the call **succeeds**.
 * A token that cannot be used is worse than no token: it would sit in
 * the credentials file and fail every later command, with the operator
 * looking at the wrong thing. So `login` verifies, then stores.
 *
 * ## What `tasks` reads
 *
 * `GET /v1/tasks` — AP-4. The API owns the projection-backed views, so
 * the CLI does not re-implement them and cannot drift from them.
 */

import { buildApiClient, problemLines, type ApiClient, type ApiOutcome, type FetchLike } from './client.js';
import { readCredentials, writeCredentials, type StoredCredentials } from './credentials.js';

/**
 * The result of one command.
 */
export interface CommandResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * The options the access-point commands read.
 */
export interface AccessPointOptions {
  /** The API's base URL. Overrides the stored one. */
  readonly apiUrl?: string;
  /** The `fetch` to use. Injected, so a test needs no server. */
  readonly fetch?: FetchLike;
  /** The environment the credentials live in. */
  readonly environment?: NodeJS.ProcessEnv;
  /** The idempotency key source. */
  readonly idempotencyKey?: () => string;
}

/**
 * The credentials, or the reason there are none.
 */
type CredentialsOrReason =
  | { readonly ok: true; readonly credentials: StoredCredentials }
  | { readonly ok: false; readonly reason: string };

/**
 * The stored credentials, or a reason there are none.
 *
 * The reason is **not** an exception: "you are not logged in" is an
 * expected outcome of a command, and the CLI reports it.
 */
export const loadCredentials = async (
  options: AccessPointOptions = {},
): Promise<CredentialsOrReason> => {
  const stored = await readCredentials(options.environment ?? process.env);
  if (stored === undefined) {
    return {
      ok: false,
      reason:
        'not logged in. run `factory login --token fac_…` first.',
    };
  }
  return { ok: true, credentials: stored };
};

/**
 * The client the commands use.
 */
export const clientFor = (
  credentials: StoredCredentials,
  options: AccessPointOptions = {},
): ApiClient =>
  buildApiClient({
    baseUrl: options.apiUrl ?? credentials.apiUrl,
    token: credentials.token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: options.idempotencyKey }),
  });

/**
 * Run `factory login --token fac_…`.
 *
 * The token is **not** echoed. A CLI that printed the token would put it
 * in the operator's scrollback, in a terminal recording, and in a CI
 * log. The confirmation says how many characters the token has, which
 * is enough to tell two tokens apart and not enough to use one.
 */
export const runLogin = async (
  token: string | undefined,
  options: AccessPointOptions = {},
): Promise<CommandResult> => {
  if (token === undefined || token === '') {
    return {
      lines: [
        'usage: factory login --token fac_…',
        '',
        'the OAuth device flow arrives once the GitHub OAuth app exists;',
        'until then the CLI takes a token the operator already holds.',
      ],
      exitCode: 2,
    };
  }

  const apiUrl = options.apiUrl ?? 'http://127.0.0.1:3001';
  const client = buildApiClient({
    baseUrl: apiUrl,
    token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: options.idempotencyKey }),
  });

  // The proof. `GET /v1/tasks` is `inspect`-scoped and needs nothing
  // else, so a token that can call it can do the work the CLI does.
  const probe = await client.get('/v1/tasks');
  if (!probe.ok) {
    return {
      lines: ['the token was refused by the API.', ...problemLines(probe.problem, probe.status)],
      exitCode: 1,
    };
  }

  const credentials: StoredCredentials = {
    apiUrl,
    token,
    storedAt: new Date().toISOString(),
  };
  await writeCredentials(credentials, options.environment ?? process.env);

  return {
    lines: [
      `logged in to ${apiUrl}`,
      `token: fac_…${token.slice(-4)} (${String(token.length)} characters)`,
    ],
    exitCode: 0,
  };
};

/**
 * Run `factory whoami`.
 *
 * The answer comes from the API, not from the credentials file: the file
 * says what the CLI holds, and the API says what the token *means*.
 */
export const runWhoami = async (
  options: AccessPointOptions = {},
): Promise<CommandResult> => {
  const loaded = await loadCredentials(options);
  if (!loaded.ok) {
    return { lines: [loaded.reason], exitCode: 2 };
  }
  const client = clientFor(loaded.credentials, options);
  const outcome = await client.get('/v1/tasks');
  if (!outcome.ok) {
    return {
      lines: problemLines(outcome.problem, outcome.status),
      exitCode: 1,
    };
  }
  return {
    lines: [
      `api: ${client.baseUrl}`,
      'token: accepted',
    ],
    exitCode: 0,
  };
};

/**
 * One task, as the CLI shows it.
 */
const formatTask = (task: unknown): string => {
  if (typeof task !== 'object' || task === null) {
    return String(task);
  }
  const record = task as Record<string, unknown>;
  const id = record['id'] ?? record['taskId'];
  const state = record['state'] ?? record['status'];
  const workflow = record['workflow'];
  const parts = [
    typeof id === 'string' ? id : id === undefined ? '?' : JSON.stringify(id),
    typeof state === 'string' ? state : state === undefined ? '?' : JSON.stringify(state),
  ];
  if (typeof workflow === 'string' && workflow !== '') {
    parts.push(workflow);
  }
  return parts.join('  ');
};

/**
 * Run `factory tasks ls`.
 *
 * The list is the API's — the CLI formats it, it does not filter it.
 */
export const runTasksList = async (
  options: AccessPointOptions & { readonly limit?: number; readonly state?: string } = {},
): Promise<CommandResult> => {
  const loaded = await loadCredentials(options);
  if (!loaded.ok) {
    return { lines: [loaded.reason], exitCode: 2 };
  }
  const client = clientFor(loaded.credentials, options);

  const query: string[] = [];
  if (options.limit !== undefined) {
    query.push(`limit=${String(options.limit)}`);
  }
  if (options.state !== undefined) {
    query.push(`state=${encodeURIComponent(options.state)}`);
  }
  const path = query.length === 0 ? '/v1/tasks' : `/v1/tasks?${query.join('&')}`;

  const outcome = await client.get(path);
  if (!outcome.ok) {
    return { lines: problemLines(outcome.problem, outcome.status), exitCode: 1 };
  }
  const items = itemsOf(outcome.body);
  if (items.length === 0) {
    return { lines: ['no tasks'], exitCode: 0 };
  }
  return { lines: items.map(formatTask), exitCode: 0 };
};

/**
 * The items of a task list, whatever shape it arrived in.
 *
 * The API answers `{items, nextCursor}` — but the CLI does not assume
 * that, because a list that arrived as a bare array would then read as
 * empty and the operator would see "no tasks" for a factory full of
 * them.
 */
export const itemsOf = (body: unknown): readonly unknown[] => {
  if (Array.isArray(body)) {
    return body;
  }
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const record = body as Record<string, unknown>;
  const items = record['items'];
  return Array.isArray(items) ? items : [];
};

/**
 * Run `factory tasks show <taskId>`.
 */
export const runTasksShow = async (
  taskId: string | undefined,
  options: AccessPointOptions = {},
): Promise<CommandResult> => {
  if (taskId === undefined || taskId === '') {
    return { lines: ['usage: factory tasks show <taskId>'], exitCode: 2 };
  }
  const loaded = await loadCredentials(options);
  if (!loaded.ok) {
    return { lines: [loaded.reason], exitCode: 2 };
  }
  const client = clientFor(loaded.credentials, options);
  const outcome = await client.get(`/v1/tasks/${encodeURIComponent(taskId)}`);
  if (!outcome.ok) {
    return { lines: problemLines(outcome.problem, outcome.status), exitCode: 1 };
  }
  if (typeof outcome.body !== 'object' || outcome.body === null) {
    return { lines: [`no task ${taskId}`], exitCode: 1 };
  }
  const record = outcome.body as Record<string, unknown>;
  const lines: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return { lines, exitCode: 0 };
};

/**
 * The outcome of a call, as the CLI reports it.
 *
 * Exported so the kill-switch command reports a refusal the same way
 * the tasks command does.
 */
export const report = (
  outcome: ApiOutcome<unknown>,
  successLines: readonly string[],
): CommandResult => {
  if (!outcome.ok) {
    return { lines: problemLines(outcome.problem, outcome.status), exitCode: 1 };
  }
  return { lines: successLines, exitCode: 0 };
};
