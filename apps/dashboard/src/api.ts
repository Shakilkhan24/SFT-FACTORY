/**
 * `dashboard/api` — the shapes the API returns, and the client that
 * fetches them.
 *
 * ## The dashboard never imports `apps/api`
 *
 * pack `02` §3: "apps/* wire packages together; they never import each
 * other." So the dashboard does not know the API's TypeScript types — it
 * knows the **wire** shapes, and it parses them.
 *
 * That is not a workaround; it is the boundary. The API's
 * `InspectionPort.overview()` returns `readonly unknown[]` because the
 * projections behind it are T-1.15's and T-2.09's — the rows are not
 * fixed yet. So the dashboard declares the shape it *renders* and is
 * **tolerant**: a missing field is absent, not a crash.
 *
 * ## Why tolerance, and not strictness
 *
 * blueprint `15` §6.2 gives the five regions' **content**, not their
 * schema. The content is normative; the encoding is the projections'
 * business, and those tables land in later tickets (T-2.09's
 * `approval_queue`, T-4.05's `cost_attribution`). So the dashboard reads
 * what is there and renders what it can.
 *
 * The tolerance is **deliberate and bounded**: a field that is present
 * but of the wrong type is treated as absent, and the region says so.
 * A dashboard that renders a blank region because the payload drifted is
 * *wrong*; a dashboard that renders a blank region and says "unknown"
 * is *honest*.
 *
 * ## The money is integer micro-USD
 *
 * AGENTS.md §4: "money as integer micro-USD". So `spentUsdMicros` is a
 * number of micro-dollars and never a float of dollars. The formatting
 * helper converts **once**, at the edge, for display.
 */

/**
 * The base path of the API.
 *
 * pack `04` §3: the API's base path is `/v1`. The dashboard's requests
 * are **same-origin** — the dev server proxies `/v1` to the API and the
 * API serves the built dashboard in production — so the path is
 * relative and CORS never applies.
 */
export const API_BASE = '/v1';

/**
 * The shape of an item in the **Needs you** region.
 *
 * blueprint `15` §6.2: "Approvals outstanding (risk-ordered),
 * escalations, failures needing a decision".
 *
 * Every field is optional because the region merges three kinds of item
 * — an approval, an escalation and a failure — and they do not share a
 * schema. `kind` says which one this is.
 */
export interface NeedsYouItem {
  /** What kind of thing this is. */
  readonly kind?: 'approval' | 'escalation' | 'failure';
  /** The task it belongs to. */
  readonly taskId?: string;
  /** The approval's id, when it is an approval. */
  readonly approvalId?: string;
  /** The review's id, when it is a review. */
  readonly reviewId?: string;
  /** A one-line description. */
  readonly title?: string;
  /** The blast-radius tier — `R0`…`R4`. The risk ordering's key. */
  readonly riskTier?: string;
  /** The recorded rationale for the ordering. */
  readonly rationale?: string;
  /** When it was asked for. */
  readonly requestedAt?: string;
  /** When it expires. */
  readonly expiresAt?: string;
}

/**
 * The shape of an item in the **In flight** region.
 *
 * blueprint `15` §6.2: "Every running task: workflow, stage, age, cost
 * so far, isolation tier, expected next event".
 */
export interface InFlightItem {
  /** The task's id. */
  readonly taskId?: string;
  /** The repository. */
  readonly repo?: string;
  /** The workflow it runs. */
  readonly workflow?: string;
  /** The stage it is in. */
  readonly stage?: string;
  /** The task's state. */
  readonly state?: string;
  /** The isolation tier it runs under. */
  readonly isolationTier?: string;
  /** How much it has spent, in integer micro-USD. */
  readonly spentUsdMicros?: number;
  /** Its budget, in integer micro-USD. */
  readonly budgetUsdMicros?: number;
  /** When it last did something. */
  readonly lastActivityAt?: string;
  /** What the factory expects to happen next. */
  readonly nextExpectedEvent?: string;
}

/**
 * The shape of an item in the **Recent outcomes** region.
 *
 * blueprint `15` §6.2: "Merged, rejected, failed, rolled back, with the
 * failure classification".
 */
export interface RecentOutcomeItem {
  /** The task's id. */
  readonly taskId?: string;
  /** The repository. */
  readonly repo?: string;
  /** The workflow it ran. */
  readonly workflow?: string;
  /** How it ended — `merged`, `rejected`, `failed`, `rolled-back`. */
  readonly outcome?: string;
  /** The failure classification, when it failed. */
  readonly failureClassification?: string;
  /** When it ended. */
  readonly completedAt?: string;
}

/**
 * The shape of an item in the **Health** region.
 *
 * blueprint `15` §6.2: "Degraded capabilities, failing gates, budget
 * consumption, queue depth, drift".
 */
export interface HealthItem {
  /** What is unhealthy. */
  readonly capability?: string;
  /** A one-line description. */
  readonly detail?: string;
  /** How bad — `degraded`, `failing`, `stale`. */
  readonly severity?: string;
}

/**
 * The shape of an item in the **Cost** region.
 *
 * blueprint `15` §6.2: "Today, this week, per accepted change, by
 * workflow and stage".
 */
export interface CostItem {
  /** The day, `YYYY-MM-DD`. */
  readonly day?: string;
  /** The workflow. */
  readonly workflow?: string;
  /** The stage. */
  readonly stage?: string;
  /** The cost, in integer micro-USD. */
  readonly usdMicros?: number;
  /** How many accepted changes it is attributed to. */
  readonly acceptedChangeCount?: number;
}

/**
 * The five regions — the one view.
 *
 * blueprint `15` §6.2's table, in the table's order. The order is the
 * pack's, so a reader comparing the two finds them in the same order.
 */
export interface Overview {
  /** What needs a human. */
  readonly needsYou: readonly NeedsYouItem[];
  /** What is running. */
  readonly inFlight: readonly InFlightItem[];
  /** What happened recently. */
  readonly recentOutcomes: readonly RecentOutcomeItem[];
  /** How the factory is doing. */
  readonly health: readonly HealthItem[];
  /** What it cost. */
  readonly cost: readonly CostItem[];
  /**
   * The number of stream events the view has absorbed.
   *
   * The dashboard re-reads the overview when an event arrives, so this
   * count is the **observable** proof that the live channel is live —
   * without it, "the stream works" would be an unfalsifiable claim.
   *
   * It is optional, because the API's overview does not have to carry
   * it: a view without it is still a correct view.
   */
  readonly streamTick?: number;
}

/**
 * The overview's raw payload — what the API sends.
 *
 * The API's overview is `{needsYou, inFlight, recentOutcomes, health,
 * cost}` — but `health` and `cost` are **records** at the port boundary
 * (`Record<string, unknown>`), and a record is not a list. So the
 * dashboard accepts both: a list, or a record whose values are the
 * list.
 */
export type OverviewPayload = Readonly<Record<string, unknown>>;

/**
 * Read a string out of an unknown value.
 */
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Read a number out of an unknown value.
 */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Read a record out of an unknown value.
 */
const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/**
 * Read a list of records out of an unknown value.
 *
 * A value that is not a list is **absent**, not an error — the region
 * renders empty and the health line says "unknown".
 */
const list = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Readonly<Record<string, unknown>> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : [];

/**
 * Read a region that may be a list **or** a record of lists.
 *
 * The API's port says `health` and `cost` are records; the projections
 * will eventually give them a list. So both are accepted, and the
 * record's values are flattened in the record's own key order.
 *
 * The flattening is deterministic — `Object.keys` order for string keys
 * is insertion order — so a region's ordering does not depend on
 * anything but the payload.
 */
const regionItems = (value: unknown): readonly Readonly<Record<string, unknown>>[] => {
  if (Array.isArray(value)) {
    return list(value);
  }
  const asRecord = record(value);
  if (asRecord === undefined) {
    return [];
  }
  const flattened: Readonly<Record<string, unknown>>[] = [];
  for (const key of Object.keys(asRecord)) {
    const nested = asRecord[key];
    if (Array.isArray(nested)) {
      for (const item of list(nested)) {
        flattened.push({ key, ...item });
      }
    } else if (typeof nested === 'object' && nested !== null) {
      flattened.push({ key, ...(nested as Readonly<Record<string, unknown>>) });
    }
  }
  return flattened;
};

/**
 * Parse an overview payload into the shape the dashboard renders.
 *
 * The parse is **total**: it never throws and never rejects. A payload
 * that is not an object at all yields five empty regions.
 */
export const parseOverview = (payload: unknown): Overview => {
  const root = record(payload);
  if (root === undefined) {
    return { needsYou: [], inFlight: [], recentOutcomes: [], health: [], cost: [] };
  }

  const needsYou = list(root['needsYou']).map((item): NeedsYouItem => {
    const kind = str(item['kind']);
    return {
      ...(kind === 'approval' || kind === 'escalation' || kind === 'failure'
        ? { kind }
        : {}),
      ...(str(item['taskId']) === undefined ? {} : { taskId: str(item['taskId']) as string }),
      ...(str(item['approvalId']) === undefined
        ? {}
        : { approvalId: str(item['approvalId']) as string }),
      ...(str(item['reviewId']) === undefined
        ? {}
        : { reviewId: str(item['reviewId']) as string }),
      ...(str(item['title']) === undefined ? {} : { title: str(item['title']) as string }),
      ...(str(item['riskTier']) === undefined
        ? {}
        : { riskTier: str(item['riskTier']) as string }),
      ...(str(item['rationale']) === undefined
        ? {}
        : { rationale: str(item['rationale']) as string }),
      ...(str(item['requestedAt']) === undefined
        ? {}
        : { requestedAt: str(item['requestedAt']) as string }),
      ...(str(item['expiresAt']) === undefined
        ? {}
        : { expiresAt: str(item['expiresAt']) as string }),
    };
  });

  const inFlight = list(root['inFlight']).map((item) => ({
    ...(str(item['taskId']) === undefined ? {} : { taskId: str(item['taskId']) as string }),
    ...(str(item['repo']) === undefined ? {} : { repo: str(item['repo']) as string }),
    ...(str(item['workflow']) === undefined ? {} : { workflow: str(item['workflow']) as string }),
    ...(str(item['stage']) === undefined ? {} : { stage: str(item['stage']) as string }),
    ...(str(item['state']) === undefined ? {} : { state: str(item['state']) as string }),
    ...(str(item['isolationTier']) === undefined
      ? {}
      : { isolationTier: str(item['isolationTier']) as string }),
    ...(num(item['spentUsdMicros']) === undefined
      ? {}
      : { spentUsdMicros: num(item['spentUsdMicros']) as number }),
    ...(num(item['budgetUsdMicros']) === undefined
      ? {}
      : { budgetUsdMicros: num(item['budgetUsdMicros']) as number }),
    ...(str(item['lastActivityAt']) === undefined
      ? {}
      : { lastActivityAt: str(item['lastActivityAt']) as string }),
    ...(str(item['nextExpectedEvent']) === undefined
      ? {}
      : { nextExpectedEvent: str(item['nextExpectedEvent']) as string }),
  }));

  const recentOutcomes = list(root['recentOutcomes']).map((item) => ({
    ...(str(item['taskId']) === undefined ? {} : { taskId: str(item['taskId']) as string }),
    ...(str(item['repo']) === undefined ? {} : { repo: str(item['repo']) as string }),
    ...(str(item['workflow']) === undefined ? {} : { workflow: str(item['workflow']) as string }),
    ...(str(item['outcome']) === undefined ? {} : { outcome: str(item['outcome']) as string }),
    ...(str(item['failureClassification']) === undefined
      ? {}
      : { failureClassification: str(item['failureClassification']) as string }),
    ...(str(item['completedAt']) === undefined
      ? {}
      : { completedAt: str(item['completedAt']) as string }),
  }));

  const health = regionItems(root['health']).map((item) => ({
    ...(str(item['capability']) === undefined
      ? {}
      : { capability: str(item['capability']) as string }),
    ...(str(item['detail']) === undefined ? {} : { detail: str(item['detail']) as string }),
    ...(str(item['severity']) === undefined ? {} : { severity: str(item['severity']) as string }),
  }));

  const cost = regionItems(root['cost']).map((item) => ({
    ...(str(item['day']) === undefined ? {} : { day: str(item['day']) as string }),
    ...(str(item['workflow']) === undefined ? {} : { workflow: str(item['workflow']) as string }),
    ...(str(item['stage']) === undefined ? {} : { stage: str(item['stage']) as string }),
    ...(num(item['usdMicros']) === undefined ? {} : { usdMicros: num(item['usdMicros']) as number }),
    ...(num(item['acceptedChangeCount']) === undefined
      ? {}
      : { acceptedChangeCount: num(item['acceptedChangeCount']) as number }),
  }));

  return {
    needsYou,
    inFlight,
    recentOutcomes,
    health,
    cost,
    ...(num(root['streamTick']) === undefined ? {} : { streamTick: num(root['streamTick']) as number }),
  };
};

/**
 * The cost, formatted for a human.
 *
 * The input is integer micro-USD; the output is dollars. The conversion
 * happens **once**, here, at the display edge — the value that crosses
 * the wire is never a float of dollars.
 */
export const formatUsd = (micros: number | undefined): string => {
  if (micros === undefined) {
    return 'unknown';
  }
  const dollars = micros / 1_000_000;
  return `$${dollars.toFixed(2)}`;
};

/**
 * The age of a timestamp, formatted for a human.
 *
 * The `now` is **injected** — AGENTS.md §4: "Time via an injected
 * `Clock`". So this is a pure function of two arguments, and a test
 * can pin both.
 */
export const formatAge = (
  since: string | undefined,
  now: Date,
): string => {
  if (since === undefined) {
    return 'unknown';
  }
  const parsed = Date.parse(since);
  if (!Number.isFinite(parsed)) {
    return 'unknown';
  }
  const seconds = Math.max(0, Math.round((now.getTime() - parsed) / 1000));
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h`;
  }
  return `${String(Math.round(hours / 24))}d`;
};

/**
 * The API client.
 *
 * The client is **injected** into the React layer rather than created
 * there, so a test can hand it a `fetch` of its own — and so the
 * browser's `fetch` is the only thing that touches the network.
 */
export interface ApiClient {
  /** The one view. */
  overview(): Promise<Overview>;
  /** One task's detail. */
  task(taskId: string): Promise<Readonly<Record<string, unknown>> | undefined>;
  /** One task's events — the timeline. */
  taskEvents(taskId: string): Promise<readonly Readonly<Record<string, unknown>>[]>;
  /**
   * Engage or release the kill switch.
   *
   * pack `04` §3: "`POST /v1/factory/kill-switch` — `{engage:boolean,
   * reason:string}`". Engaged ⇒ intake refuses, and the refusal is
   * `kill_switch`.
   *
   * A mutating call needs the **CSRF token**, because the browser is
   * authenticated with a session cookie. So the caller must supply it.
   * The dashboard reads it from the page's meta tag.
   */
  setKillSwitch(engage: boolean, reason: string): Promise<void>;
}

/**
 * The `fetch`-shaped function the client uses.
 *
 * Declared structurally so the browser's `fetch` satisfies it without a
 * cast, and so a test can supply one.
 */
export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly credentials?: 'include' | 'omit' | 'same-origin';
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>;

/**
 * The client's options.
 */
export interface ApiClientOptions {
  /** The `fetch` to use. Defaults to the browser's. */
  readonly fetch?: FetchLike;
  /** The base path. Defaults to `/v1`. */
  readonly base?: string;
  /**
   * The CSRF token, for mutating calls.
   *
   * pack `04` §3: the browser is authenticated with a **session cookie**,
   * so a mutating call carries the **CSRF token** as well — the cookie
   * alone would let a cross-site form post. The token is read from the
   * page, so it is supplied here rather than read from `document` inside
   * the client: the client stays testable without a DOM.
   */
  readonly csrfToken?: string | undefined;
}

/**
 * The idempotency key's counter.
 *
 * A module-level counter, so two calls in the same page get different
 * keys, and a **retry of the same call** — the one place a duplicate
 * matters — reuses the key it was first given.
 */
let idempotencyCounter = 0;

/**
 * A fresh idempotency key.
 *
 * pack `04` §3: "`Idempotency-Key` on creating POSTs". The key has to
 * be unique per logical request and stable across a retry of it. The
 * client's `post` builds one per call, so a retry at the HTTP layer
 * (a browser's own retry, a proxy's) carries the same header.
 */
const idempotencyKey = (): string => {
  idempotencyCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `dash-${String(idempotencyCounter)}-${random}`;
};

/**
 * Build an API client.
 *
 * The requests are **same-origin** and carry the session cookie, so the
 * browser's `credentials: 'same-origin'` is set. The API authenticates
 * the browser with the session cookie and the CSRF token; the
 * dashboard's reads need no CSRF token, because only a mutating call
 * does.
 *
 * A response that is not `ok` becomes a **rejection** carrying the
 * problem document, because the API's failures are
 * `application/problem+json` with a `code` the caller may want to
 * branch on.
 */
export const buildApiClient = (options: ApiClientOptions = {}): ApiClient => {
  const doFetch: FetchLike =
    options.fetch ??
    ((input, init) =>
      // The global `fetch` — the browser's. `globalThis.fetch` is typed
      // as a wider function, so it is narrowed here rather than at
      // every call site.
      globalThis.fetch(input, init as RequestInit) as ReturnType<FetchLike>);
  const base = options.base ?? API_BASE;

  const get = async (path: string): Promise<unknown> => {
    const response = await doFetch(`${base}${path}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`the factory API answered ${String(response.status)} for ${path}`);
    }
    return response.json();
  };

  /**
   * The mutating call.
   *
   * pack `04` §3: a mutating POST carries the **CSRF token**, because the
   * browser's session cookie would otherwise let a cross-site form post.
   * And it carries an **`Idempotency-Key`** — the same pack's rule for
   * creating POSTs, so a retry of the same request does not engage the
   * switch twice.
   */
  const post = async (path: string, body: unknown): Promise<void> => {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey(),
    };
    if (options.csrfToken !== undefined && options.csrfToken !== '') {
      headers['x-csrf-token'] = options.csrfToken;
    }
    const response = await doFetch(`${base}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`the factory API answered ${String(response.status)} for ${path}`);
    }
  };

  return {
    overview: async () => parseOverview(await get('/views/overview')),
    task: async (taskId) => {
      const payload = await get(`/tasks/${encodeURIComponent(taskId)}`);
      const asRecord =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Readonly<Record<string, unknown>>)
          : undefined;
      return asRecord;
    },
    taskEvents: async (taskId) => {
      const payload = await get(`/tasks/${encodeURIComponent(taskId)}/events`);
      const items =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Readonly<Record<string, unknown>>)['items']
          : undefined;
      return list(items);
    },
    setKillSwitch: async (engage, reason) => {
      await post('/factory/kill-switch', { engage, reason });
    },
  };
};
