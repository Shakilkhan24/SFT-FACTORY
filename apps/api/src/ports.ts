/**
 * `api/ports` — what the access points need from the rest of the factory.
 *
 * ## Why ports, and not the packages
 *
 * pack `02` §3: apps wire packages together; they never import each other.
 * And the ticket says "AP-1…AP-6 per `04` §3 (**stubs for later-ticket
 * behaviours**)" — the approval, review and task behaviours belong to
 * `packages/approvals` and `packages/review`, which are R4 by HR-5 and are
 * **not** named by this ticket.
 *
 * So the app declares what each access point *needs*, and the composition
 * that satisfies it is injected. That keeps the ticket's boundary honest:
 * the HTTP layer, the auth, the problem shape, the idempotency, the rate
 * limit and the event emission are **real and tested here**, and the
 * domain work behind them is a port.
 *
 * ## The port that is not a port
 *
 * `EventSink` is the exception: the event log **is** the factory's single
 * source of truth (blueprint `09` §5.2), and `packages/eventlog` ships the
 * implementation. So the port is a thin shape the real `EventLog` already
 * satisfies — which is exactly how a port should be written when the
 * implementation exists.
 */

import type { Actor, Authority, EventType, NewEvent } from '@factory/contracts';
import type { Clock } from '@factory/core';

import type { Refusal } from './problem.js';
import type { StreamClass } from './stream.js';

/**
 * The result of an access-point call.
 *
 * A refusal is an **expected** failure, so it is a value (AGENTS.md §4).
 * The handler returns it; the error handler renders it.
 *
 * The `hijacked` flag is for the one route that writes its own body:
 * the SSE stream. Fastify's reply is built for a single body, and a
 * stream is a sequence of frames over a long-lived connection — so the
 * stream handler takes the raw response, writes the headers and the
 * frames itself, and tells the app "do not send a body". Without the
 * flag the app would send a second body after the frames, which is
 * exactly the corruption the SSE format forbids.
 */
export type HandlerResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly status: number;
      /** The handler wrote the response itself. Do not send a body. */
      readonly hijacked?: boolean;
    }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * The result of a **port** call — the shape every domain port returns.
 *
 * The same shape as `HandlerResult` minus the HTTP status, because a port
 * does not know the status: the port says "this worked" or "this was
 * refused", and the **handler** says what HTTP status that is. So the
 * status is attached once, at the edge, rather than being guessed at six
 * call sites inside the domain.
 */
export type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * A handler that succeeded.
 */
export const handled = <T>(
  value: T,
  status = 200,
): HandlerResult<T> => ({ ok: true, value, status });

/**
 * A handler that succeeded **and wrote the response itself**.
 *
 * The SSE stream is the only caller: it writes the headers and the
 * frames to the raw response, so the app must not send a body after it.
 */
export const hijacked = <T>(
  value: T,
  status = 200,
): HandlerResult<T> => ({ ok: true, value, status, hijacked: true });

/**
 * A handler that was refused.
 */
export const refused = <T>(refusal: Refusal): HandlerResult<T> => ({
  ok: false,
  refusal,
});

/**
 * The identity of a caller.
 *
 * pack `04` §3: "Every call emits an event with `actor=human:<login>` and
 * `authority.basis='human-access-point'`." So the login is the actor's id
 * and the actor's kind is `human`.
 */
export interface CallerIdentity {
  /** The login — `alice`. */
  readonly login: string;
  /** How the caller authenticated. */
  readonly via: 'session' | 'token';
}

/**
 * The event sink — where the access-point events go.
 *
 * The shape is a subset of `packages/contracts`' `EventLog`, so the real
 * event log satisfies it without an adapter.
 */
export interface EventSink {
  /** Append an event. */
  append(event: NewEvent): Promise<void>;
}

/**
 * The stream source — where `GET /v1/stream` reads from.
 *
 * The port is **one method**: `subscribe(afterSeq)` yields the events
 * after a sequence. The caller owns the cursor, so a resume from
 * `Last-Event-ID` is the caller's business — and the port cannot
 * express a "send me everything" that is not a resume.
 *
 * The source is **polled**, not woken. T-1.15's escalation recorded the
 * same for the projector: a `LISTEN` needs a dedicated connection held
 * open, and that belongs to the worker's ticket.
 */
export interface StreamSource {
  /** The events after `afterSeq`. */
  subscribe(afterSeq: number): AsyncIterable<StreamEvent>;
}

/**
 * One event on the stream.
 *
 * The shape is the **classified** event: the log's event plus the
 * stream class it maps to. The classification happens at the source, so
 * the stream carries six classes and not the log's sixty-odd types.
 */
export interface StreamEvent {
  /** The event's sequence in the log — the SSE `id:`. */
  readonly seq: number;
  /** The event's type. */
  readonly eventType: string;
  /** The class it maps to. */
  readonly class: StreamClass;
  /** The aggregate it belongs to. */
  readonly aggregate: { readonly kind: string; readonly id: string };
  /** When it happened. */
  readonly occurredAt: string;
  /** Its payload. */
  readonly payload: unknown;
}

/**
 * The access-point scope of a CLI token.
 *
 * A token is "scoped" (pack `04` §3), so a token minted for reading
 * cannot write. The scopes are the access points themselves — the
 * enumeration from blueprint `13` §3.1 — so a token's authority is
 * expressed in the same vocabulary the routes use.
 */
export const ACCESS_POINT_SCOPES = [
  'define-intent',
  'approve',
  'review',
  'inspect',
  'intervene',
  'amend-factory',
] as const;

export type AccessPointScope = (typeof ACCESS_POINT_SCOPES)[number];

/**
 * Is this a scope the factory knows?
 */
export const isAccessPointScope = (
  value: string,
): value is AccessPointScope =>
  (ACCESS_POINT_SCOPES as readonly string[]).includes(value);

/**
 * A CLI token.
 *
 * pack `04` §3: "CLI = bearer token `fac_…` (stored hashed, scoped,
 * expiring, revocable)."
 *
 * The token itself is never held here — only its **hash**, which is what
 * "stored hashed" means. The plaintext exists exactly once, at minting.
 */
export interface CliToken {
  /** The token's id. */
  readonly id: string;
  /** The hash of the token, as presented by the caller. */
  readonly tokenHash: `sha256:${string}`;
  /** The login the token belongs to. */
  readonly login: string;
  /** The scopes the token carries. */
  readonly scopes: readonly AccessPointScope[];
  /** When the token expires. */
  readonly expiresAt: string;
  /** When the token was revoked, if it was. */
  readonly revokedAt?: string;
}

/**
 * The browser session.
 *
 * A session is a cookie-backed identity. The **CSRF token** is separate
 * from the session id: the session proves who the caller is, and the CSRF
 * token proves the request came from the page the browser is showing,
 * not from a third-party site that borrowed the cookie.
 */
export interface BrowserSession {
  /** The session's id. */
  readonly id: string;
  /** The login the session belongs to. */
  readonly login: string;
  /** The session's CSRF token. */
  readonly csrfToken: string;
  /** When the session expires. */
  readonly expiresAt: string;
}

/**
 * The session store — browser sessions and CSRF tokens.
 */
export interface SessionStore {
  /** The session for a session id, if it is live. */
  bySessionId(sessionId: string): Promise<BrowserSession | undefined>;
  /** A new session for a login. */
  create(login: string, csrfToken: string, expiresAt: string): Promise<BrowserSession>;
  /** End a session. */
  destroy(sessionId: string): Promise<void>;
}

/**
 * The token store — CLI bearer tokens.
 */
export interface TokenStore {
  /** The token whose hash matches, if it is live. */
  byHash(tokenHash: `sha256:${string}`): Promise<CliToken | undefined>;
}

/**
 * The allow-list — the humans the factory accepts.
 *
 * The ticket's proof is "a non-allow-listed login is rejected", so this
 * list is the gate. It is **injected** — the definition owns who may
 * act (pack `04` §2.4: the allow-list is definition-driven), so the API
 * does not hard-code anyone's login (HR-10).
 */
export interface AllowList {
  /** Is this login allowed to act? */
  isAllowed(login: string): Promise<boolean>;
}

/**
 * The kill switch.
 *
 * pack `04` §3: "`POST /v1/factory/kill-switch` — `{engage:boolean,
 * reason}` — engaged ⇒ intake rejected, scheduler claims nothing, harness
 * containers killed, edge denies new model calls".
 *
 * The API owns the *intake* half of that; the scheduler and the harness
 * read the same state. So the port is the switch's state, and the
 * effect on intake is this app's.
 */
export interface KillSwitch {
  /** Is the switch engaged? */
  isEngaged(): Promise<boolean>;
  /** Engage or release the switch. */
  set(engaged: boolean, reason: string): Promise<void>;
}

/**
 * The intent intake.
 *
 * AP-1: "`POST /v1/intents` — `{repo, source:{kind:'github-issue',ref:
 * 'o/r#123'}|{kind:'manual',title,body}, workflow?, budgetUsdMicros?}` →
 * `202 {taskId}`".
 */
export interface IntentIntake {
  /** Record an intent and return the task id. */
  record(intent: {
    readonly repo: string;
    readonly source:
      | { readonly kind: 'github-issue'; readonly ref: string }
      | { readonly kind: 'manual'; readonly title: string; readonly body: string };
    readonly workflow?: string;
    readonly budgetUsdMicros?: number;
  }): Promise<{ readonly taskId: string }>;
}

/**
 * The approvals the API reads and decides.
 *
 * `packages/approvals` is R4 and not named by this ticket, so this is a
 * port with a fake. The **decide** half is here because AP-2's decision
 * is an access-point call whose authority rules the app must enforce
 * (the hash binding, the expiry, the approver list).
 */
export interface ApprovalPort {
  /** The approvals matching a status filter. */
  list(status?: string): Promise<
    readonly {
      readonly id: string;
      readonly taskId: string;
      readonly type: string;
      readonly artefactRef: string;
      readonly artefactSha256: `sha256:${string}`;
      readonly approvers: readonly string[];
      readonly status: string;
      readonly requestedAt: string;
      readonly expiresAt: string;
    }[]
  >;
  /** One approval, with its artefact view. */
  byId(
    id: string,
  ): Promise<
    | {
        readonly id: string;
        readonly taskId: string;
        readonly type: string;
        readonly artefactRef: string;
        readonly artefactSha256: `sha256:${string}`;
        readonly approvers: readonly string[];
        readonly status: string;
        readonly requestedAt: string;
        readonly expiresAt: string;
        readonly artefact: {
          readonly kind: string;
          readonly ref: string;
          readonly sha256: `sha256:${string}`;
          readonly blocks: readonly {
            readonly kind: string;
            readonly content: string;
            readonly untrusted: boolean;
          }[];
          readonly diff?: string;
        };
      }
    | undefined
  >;
  /** Decide an approval. */
  decide(
    id: string,
    decision: {
      readonly decision: 'grant' | 'refuse';
      readonly identity: string;
      readonly comment?: string;
      readonly securityScopeAck?: boolean;
      readonly reviewMinutes?: number;
    },
  ): Promise<
    | { readonly ok: true; readonly value: { readonly id: string; readonly status: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
  /** Revoke an approval. */
  revoke(
    id: string,
    reason: string,
  ): Promise<
    | { readonly ok: true; readonly value: { readonly id: string; readonly status: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
}

/**
 * The reviews the API reads and decides.
 *
 * `packages/review` is R4 and not named by this ticket, so this is a port.
 */
export interface ReviewPort {
  /** The review queue, risk-ordered. */
  list(): Promise<
    readonly {
      readonly taskId: string;
      readonly risk: string;
      readonly rationale: readonly string[];
      readonly queuedAt: string;
    }[]
  >;
  /** One review's evidence bundle. */
  byTaskId(
    taskId: string,
    includeTranscript: boolean,
  ): Promise<
    | {
        readonly taskId: string;
        readonly spec: string;
        readonly oracleResult: string;
        readonly gateReport: string;
        readonly panelResult: string;
        readonly blastRadius: string;
        readonly diffLink: string;
        readonly transcript?: string;
      }
    | undefined
  >;
  /** Decide a review. */
  decide(
    taskId: string,
    decision: {
      readonly decision: 'approve' | 'reject' | 'defer';
      readonly rationale: string;
      readonly identity: string;
    },
  ): Promise<
    | { readonly ok: true; readonly value: { readonly taskId: string; readonly status: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
}

/**
 * The operational reads.
 *
 * AP-4. The answers come from the **projections**, which are T-1.15's
 * ticket — so the port is injected here, and the routes exist.
 */
export interface InspectionPort {
  /** The one view. */
  overview(): Promise<{
    readonly needsYou: readonly unknown[];
    readonly inFlight: readonly unknown[];
    readonly recentOutcomes: readonly unknown[];
    readonly health: Record<string, unknown>;
    readonly cost: Record<string, unknown>;
  }>;
  /** The tasks, filtered. */
  tasks(filter: {
    readonly state?: string;
    readonly repo?: string;
    readonly workflow?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<{ readonly items: readonly unknown[]; readonly nextCursor?: string }>;
  /** One task. */
  task(id: string): Promise<Record<string, unknown> | undefined>;
  /** A task's events. */
  taskEvents(id: string): Promise<readonly unknown[]>;
  /** A task's runs. */
  taskRuns(id: string): Promise<readonly unknown[]>;
  /** One run. */
  run(id: string): Promise<Record<string, unknown> | undefined>;
  /** A run's artefact, by name. */
  runArtefact(runId: string, name: string): Promise<
    | {
        readonly name: string;
        readonly url: string;
        readonly expiresAt: string;
        readonly sha256: `sha256:${string}`;
      }
    | undefined
  >;
  /** The metrics subset. */
  metricsSummary(): Promise<Record<string, unknown>>;
  /** The audit walk for one event. */
  auditExplain(eventId: string): Promise<Record<string, unknown> | undefined>;
}

/**
 * The intervention port.
 *
 * AP-5: "`POST /v1/tasks/{id}/{pause|resume|cancel|escalate|rerun}`".
 */
export interface InterventionPort {
  /** Act on an in-flight task. */
  act(
    taskId: string,
    action: 'pause' | 'resume' | 'cancel' | 'escalate' | 'rerun',
    reason: string,
    identity: string,
  ): Promise<
    | { readonly ok: true; readonly value: { readonly taskId: string; readonly action: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
  /** Flag a defect. */
  flagDefect(taskId: string, note: string): Promise<
    | { readonly ok: true; readonly value: { readonly taskId: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
  /** Create a temporary grant. */
  createTemporaryGrant(input: {
    readonly taskId: string;
    readonly capability: string;
    readonly scope: string;
    readonly ttlSeconds: number;
    readonly reason: string;
    readonly identity: string;
  }): Promise<
    | { readonly ok: true; readonly value: { readonly approvalId: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
}

/**
 * The definition port.
 *
 * AP-6. `packages/definition` ships the real plan and the real approval
 * check, so this port is thin — but it is still a port, because
 * `packages/definition` is R4 and the API must not reach into its
 * internals.
 */
export interface DefinitionPort {
  /** The plan between the applied bundle and a candidate. */
  plan(sha?: string): Promise<
    | {
        readonly fromSha256: `sha256:${string}`;
        readonly toSha256: `sha256:${string}`;
        readonly changes: readonly unknown[];
        readonly rendered: string;
      }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
  /**
   * Apply a definition.
   *
   * **The API never writes the live definition.** This returns the plan
   * the reviewed change carries and refuses when the approval does not
   * bind it — blueprint `13` §3.3: "A control-surface write that is not
   * backed by a reviewed change in the definition is rejected."
   */
  apply(input: {
    readonly sha: string;
    readonly approvalId: string;
    readonly identity: string;
  }): Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly sha: string;
          readonly bundleSha256: `sha256:${string}`;
          readonly plan: unknown;
        };
      }
    | { readonly ok: false; readonly refusal: Refusal }
  >;
}

/**
 * The clock and the id source.
 *
 * AGENTS.md §4: "Time via an injected `Clock`; ids via `core`."
 */
export interface ApiDeps {
  /** The clock. */
  readonly clock: Clock;
  /** The id source. */
  readonly nextId: () => string;
  /** The event sink. */
  readonly events: EventSink;
  /** The stream source — where `GET /v1/stream` reads from. */
  readonly stream: StreamSource;
  /** The browser sessions. */
  readonly sessions: SessionStore;
  /** The CLI tokens. */
  readonly tokens: TokenStore;
  /** The allow-list. */
  readonly allowList: AllowList;
  /** The kill switch. */
  readonly killSwitch: KillSwitch;
  /** The intent intake. */
  readonly intents: IntentIntake;
  /** The approvals. */
  readonly approvals: ApprovalPort;
  /** The reviews. */
  readonly reviews: ReviewPort;
  /** The operational reads. */
  readonly inspection: InspectionPort;
  /** The interventions. */
  readonly intervention: InterventionPort;
  /** The definition. */
  readonly definition: DefinitionPort;
}

/**
 * The event an access-point call emits.
 *
 * blueprint `13` §3.3: every access-point call "is recorded in the event
 * log with the authority and the resulting state change".
 */
export interface AccessPointEvent {
  /** The event type — from the registered vocabulary. */
  readonly type: EventType;
  /** The actor — always a human at an access point. */
  readonly actor: Actor;
  /** The authority — always `human-access-point`. */
  readonly authority: Authority;
  /** The aggregate the event belongs to. */
  readonly aggregate: { readonly kind: string; readonly id: string };
  /** The payload. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The correlation id — the request id. */
  readonly correlationId: string;
}
