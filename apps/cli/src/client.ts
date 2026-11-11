/**
 * `cli` — the API client for the access-point commands.
 *
 * ## The two backends, and why the new commands use this one
 *
 * The CLI has two kinds of command:
 *
 * * **ops** commands (`db`, `events`, `projections`, `definition`) run as a
 *   Postgres role and read the database directly. An operator with the
 *   database already has the authority; the log is the truth they want.
 * * **access-point** commands (`login`, `whoami`, `tasks`, `kill-switch`)
 *   run as a **human** with a `fac_…` bearer token, and they go through
 *   the API.
 *
 * The distinction is not cosmetic. pack `04` §3 says every call emits an
 * event with `actor=human:<login>` and
 * `authority.basis='human-access-point'`. A command that wrote to the
 * database directly would produce **no event** — or an event with the
 * wrong actor — so the audit trail would not say what actually happened.
 *
 * So `factory kill-switch on` goes through `POST /v1/factory/kill-switch`
 * even though a durable switch store does not exist yet. The switch's
 * **state** is the API's business; the CLI is a client of it.
 *
 * ## The problem document
 *
 * pack `04` §3: failures are `application/problem+json` (RFC 9457) with a
 * closed `code` set. So the client reads that document and turns it into a
 * message — the code, the title, the detail — rather than dumping a body
 * of JSON at the operator. The code is kept in the message because it is
 * the part a script would want to match on.
 */

/**
 * The base URL of the API.
 *
 * `FACTORY_API_URL`, defaulting to `http://127.0.0.1:3001`. The default
 * is the loopback: the API is a private access point, and a CLI that
 * defaulted to a public host would be a foot-gun.
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/**
 * The header a mutating call must carry.
 *
 * pack `04` §3: `Idempotency-Key` is required on the creating POSTs. The
 * CLI generates one per call — a retry of the same command must not
 * perform the action twice.
 */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * A problem document, as the API sends it.
 */
export interface ProblemDocument {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly requestId?: string;
}

/**
 * The outcome of one call.
 *
 * A refusal is a **value** (AGENTS.md §4), not an exception: the CLI's
 * job is to report it, and a thrown error would lose the code.
 */
export type ApiOutcome<T> =
  | { readonly ok: true; readonly status: number; readonly body: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly problem: ProblemDocument;
    };

/**
 * The `fetch` the client uses.
 *
 * Injected, so a test can drive the client without a server — and so the
 * client never reaches for a global.
 */
export type FetchLike = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * The client's options.
 */
export interface ApiClientOptions {
  /** The API's base URL. */
  readonly baseUrl?: string;
  /** The bearer token, when there is one. */
  readonly token?: string;
  /** The `fetch` to use. */
  readonly fetch?: FetchLike;
  /**
   * The source of the idempotency key.
   *
   * Injected so a test can pin the key. The default is a counter with a
   * random suffix — unique per process, which is what the header is for.
   */
  readonly idempotencyKey?: () => string;
}

/**
 * A problem document, as the API sends it.
 */
interface MutableProblem {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  requestId?: string;
}

/**
 * Read a problem document out of a response body.
 *
 * A body that is not a problem document — a proxy's HTML error page, an
 * empty body — yields an empty document rather than a throw. The status
 * still tells the operator what happened.
 */
export const parseProblem = (body: string): ProblemDocument => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const problem: MutableProblem = {};
    if (typeof record['type'] === 'string') {
      problem.type = record['type'];
    }
    if (typeof record['title'] === 'string') {
      problem.title = record['title'];
    }
    if (typeof record['status'] === 'number') {
      problem.status = record['status'];
    }
    if (typeof record['code'] === 'string') {
      problem.code = record['code'];
    }
    if (typeof record['detail'] === 'string') {
      problem.detail = record['detail'];
    }
    if (typeof record['requestId'] === 'string') {
      problem.requestId = record['requestId'];
    }
    return problem;
  } catch {
    return {};
  }
};

/**
 * A client's dependency on the network.
 */
export interface ApiClient {
  /** The API's base URL. */
  readonly baseUrl: string;
  /** Whether a token is set. */
  readonly authenticated: boolean;
  /** A `GET`. */
  get<T>(path: string): Promise<ApiOutcome<T>>;
  /** A `POST` with a JSON body. */
  post<T>(path: string, body: unknown): Promise<ApiOutcome<T>>;
}

/**
 * The default idempotency key.
 *
 * A counter plus a random suffix. It has to be unique per **call**, not
 * per process — two calls in one process must not share a key, or the
 * second would be a replay of the first.
 */
const defaultIdempotencyKey = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  const counter = (defaultIdempotencyKey as unknown as { count?: number }).count ?? 0;
  (defaultIdempotencyKey as unknown as { count?: number }).count = counter + 1;
  return `cli-${String(counter)}-${random}`;
};

/**
 * Build the client.
 *
 * @param options the client's options
 */
export const buildApiClient = (options: ApiClientOptions = {}): ApiClient => {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const token = options.token;
  const fetchImpl: FetchLike =
    options.fetch ??
    ((url, init) =>
      Promise.resolve(
        globalThis.fetch(url, {
          method: init.method,
          headers: { ...init.headers },
          ...(init.body === undefined ? {} : { body: init.body }),
        }),
      ));
  const nextKey = options.idempotencyKey ?? defaultIdempotencyKey;

  const call = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<ApiOutcome<T>> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token !== undefined) {
      headers['authorization'] = `Bearer ${token}`;
    }
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      headers[IDEMPOTENCY_HEADER] = nextKey();
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        problem: parseProblem(text),
      };
    }
    if (text.trim() === '') {
      return { ok: true, status: response.status, body: undefined as T };
    }
    try {
      return { ok: true, status: response.status, body: JSON.parse(text) as T };
    } catch {
      // A success with a body that is not JSON. The status says it
      // worked, so the outcome is a success with no parsed body.
      return { ok: true, status: response.status, body: undefined as T };
    }
  };

  return {
    baseUrl,
    authenticated: token !== undefined,
    get: <T>(path: string): Promise<ApiOutcome<T>> => call<T>('GET', path),
    post: <T>(path: string, body: unknown): Promise<ApiOutcome<T>> =>
      call<T>('POST', path, body),
  };
};

/**
 * The lines a refusal becomes.
 *
 * The code comes first because it is the stable part — a script matches
 * on it, and a human reads the detail.
 */
export const problemLines = (problem: ProblemDocument, status: number): readonly string[] => {
  const lines: string[] = [];
  const code = problem.code ?? 'unknown';
  const title = problem.title ?? 'the request was refused';
  lines.push(`${code}: ${title}`);
  if (problem.detail !== undefined && problem.detail !== '') {
    lines.push(`  ${problem.detail}`);
  }
  if (problem.requestId !== undefined) {
    lines.push(`  requestId: ${problem.requestId}`);
  }
  lines.push(`  status: ${String(status)}`);
  return lines;
};
