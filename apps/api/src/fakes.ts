/**
 * `api/fakes` — the doubles for every port (T-1.14).
 *
 * ## Why the doubles live in the app
 *
 * `packages/approvals`, `packages/review` and the projections are R4 and
 * are not this ticket's to build. So the API's ports have no production
 * implementation yet, and the tests need doubles.
 *
 * They live in `apps/api/src/fakes.ts` rather than in a `packages/` tree
 * because a **fake of a port the app declares** is part of the app. The
 * moment a real package implements a port, the fake is deleted — and
 * `packages/` would then own a package that duplicates an app.
 *
 * ## The doubles are not no-ops
 *
 * Each double **records what it was asked to do**, so a test can assert
 * the call reached the port with the right arguments — and, more
 * importantly, so a test can assert a call did **not** reach it. A
 * double that returns a constant and records nothing cannot tell
 * "the handler called the port once" from "the handler never called the
 * port and the constant happened to be right".
 */

import type { NewEvent } from '@factory/contracts';
import { fixedClock, sequentialIds, type Clock } from '@factory/core';

import type { Refusal } from './problem.js';
import type {
  AllowList,
  ApprovalPort,
  BrowserSession,
  CliToken,
  DefinitionPort,
  EventSink,
  InspectionPort,
  IntentIntake,
  InterventionPort,
  KillSwitch,
  ReviewPort,
  SessionStore,
  StreamEvent,
  StreamSource,
  TokenStore,
} from './ports.js';
import { classify } from './stream.js';

/**
 * The recording event sink.
 *
 * It keeps every event it was handed, so a test can assert the actor,
 * the authority and the payload — the three things the ticket's proof
 * is about.
 */
export class RecordingEventSink implements EventSink {
  readonly #events: NewEvent[] = [];

  public append(event: NewEvent): Promise<void> {
    this.#events.push(event);
    return Promise.resolve();
  }

  /** The events, in the order they were appended. */
  public get events(): readonly NewEvent[] {
    return this.#events;
  }

  /** How many events were appended. */
  public get count(): number {
    return this.#events.length;
  }

  /** The last event, if there is one. */
  public get last(): NewEvent | undefined {
    return this.#events[this.#events.length - 1];
  }

  /** Forget everything — for a test that resets between phases. */
  public clear(): void {
    this.#events.length = 0;
  }
}

/**
 * The recording stream source.
 *
 * It holds the events a test pushed into it and yields the ones after
 * the cursor — so a test can assert what the stream carried, and a
 * test can assert what it **did not** carry.
 *
 * The events are **classified** as they are pushed, so the double
 * exercises the same mapping the real source does. A double that
 * accepted pre-classified events would let the mapping go untested.
 */
export class RecordingStreamSource implements StreamSource {
  readonly #events: StreamEvent[] = [];

  /**
   * Push an event onto the stream.
   *
   * An event whose type the stream does not carry is **dropped** — the
   * same rule the real source applies.
   */
  public push(event: {
    readonly seq: number;
    readonly eventType: string;
    readonly aggregate: { readonly kind: string; readonly id: string };
    readonly occurredAt: string;
    readonly payload: unknown;
  }): void {
    const classified = classify(event);
    if (classified === undefined) {
      return;
    }
    this.#events.push(classified);
  }

  /**
   * The events after `afterSeq`, in sequence order.
   */
  public async *subscribe(afterSeq: number): AsyncIterable<StreamEvent> {
    const ordered = [...this.#events].sort((left, right) => left.seq - right.seq);
    for (const event of ordered) {
      if (event.seq > afterSeq) {
        yield await Promise.resolve(event);
      }
    }
  }

  /** The events the source holds. */
  public get events(): readonly StreamEvent[] {
    return this.#events;
  }
}

/**
 * The in-memory session store.
 */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, BrowserSession>();

  public bySessionId(sessionId: string): Promise<BrowserSession | undefined> {
    return Promise.resolve(this.#sessions.get(sessionId));
  }

  public create(
    login: string,
    csrfToken: string,
    expiresAt: string,
  ): Promise<BrowserSession> {
    const session: BrowserSession = {
      id: `sess-${String(this.#sessions.size + 1).padStart(6, '0')}`,
      login,
      csrfToken,
      expiresAt,
    };
    this.#sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  public destroy(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    return Promise.resolve();
  }

  /** Add a session with an explicit id — for a test that pins the id. */
  public put(session: BrowserSession): void {
    this.#sessions.set(session.id, session);
  }
}

/**
 * The in-memory token store.
 *
 * The token is stored **hashed** — the plaintext is never held here,
 * which is what "stored hashed" means. A test mints a plaintext token,
 * hashes it, and stores the hash.
 */
export class InMemoryTokenStore implements TokenStore {
  readonly #tokens = new Map<string, CliToken>();

  public byHash(
    tokenHash: `sha256:${string}`,
  ): Promise<CliToken | undefined> {
    return Promise.resolve(this.#tokens.get(tokenHash));
  }

  /** Store a token under its hash. */
  public put(token: CliToken): void {
    this.#tokens.set(token.tokenHash, token);
  }
}

/**
 * The allow-list.
 *
 * The list is a set of logins, and it is **injected** — the API does not
 * hard-code anyone's login (HR-10).
 */
export class InMemoryAllowList implements AllowList {
  readonly #allowed = new Set<string>();

  public isAllowed(login: string): Promise<boolean> {
    return Promise.resolve(this.#allowed.has(login));
  }

  /** Allow a login. */
  public allow(login: string): void {
    this.#allowed.add(login);
  }
}

/**
 * The kill switch.
 */
export class InMemoryKillSwitch implements KillSwitch {
  #engaged = false;
  #reason = '';

  public isEngaged(): Promise<boolean> {
    return Promise.resolve(this.#engaged);
  }

  public set(engaged: boolean, reason: string): Promise<void> {
    this.#engaged = engaged;
    this.#reason = reason;
    return Promise.resolve();
  }

  /** The reason the switch was last set — for a test to assert. */
  public get reason(): string {
    return this.#reason;
  }
}

/**
 * The intent intake.
 *
 * It assigns a task id per intent and remembers the intents it was
 * given, so a test can assert the intent reached the port intact.
 */
export class InMemoryIntentIntake implements IntentIntake {
  readonly #recorded: {
    readonly repo: string;
    readonly source: unknown;
    readonly workflow?: string;
    readonly budgetUsdMicros?: number;
  }[] = [];

  #next = 1;

  public record(intent: {
    readonly repo: string;
    readonly source: unknown;
    readonly workflow?: string;
    readonly budgetUsdMicros?: number;
  }): Promise<{ readonly taskId: string }> {
    this.#recorded.push(intent);
    const taskId = `task-${String(this.#next).padStart(6, '0')}`;
    this.#next += 1;
    return Promise.resolve({ taskId });
  }

  /** The intents that were recorded. */
  public get recorded(): readonly {
    readonly repo: string;
    readonly source: unknown;
  }[] {
    return this.#recorded;
  }
}

/**
 * An approval, as the fake stores it.
 */
export interface FakeApproval {
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

/**
 * The in-memory approvals store.
 */
export class InMemoryApprovalPort implements ApprovalPort {
  readonly #approvals = new Map<string, FakeApproval>();

  /** The decisions that were made — for a test to assert. */
  readonly decisions: {
    readonly id: string;
    readonly decision: string;
    readonly identity: string;
  }[] = [];

  /** The revocations that were made — for a test to assert. */
  readonly revocations: { readonly id: string; readonly reason: string }[] = [];

  public list(
    status?: string,
  ): Promise<readonly FakeApproval[]> {
    const all = [...this.#approvals.values()];
    return Promise.resolve(
      status === undefined ? all : all.filter((a) => a.status === status),
    );
  }

  public byId(id: string): Promise<FakeApproval | undefined> {
    return Promise.resolve(this.#approvals.get(id));
  }

  public decide(
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
  > {
    const approval = this.#approvals.get(id);
    if (approval === undefined) {
      return Promise.resolve({
        ok: false,
        refusal: {
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          detail: `there is no approval "${id}"`,
          code: 'validation',
        },
      });
    }
    this.decisions.push({ id, decision: decision.decision, identity: decision.identity });
    const status = decision.decision === 'grant' ? 'granted' : 'refused';
    this.#approvals.set(id, { ...approval, status });
    return Promise.resolve({ ok: true, value: { id, status } });
  }

  public revoke(
    id: string,
    reason: string,
  ): Promise<
    | { readonly ok: true; readonly value: { readonly id: string; readonly status: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  > {
    const approval = this.#approvals.get(id);
    if (approval === undefined) {
      return Promise.resolve({
        ok: false,
        refusal: {
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          detail: `there is no approval "${id}"`,
          code: 'validation',
        },
      });
    }
    this.revocations.push({ id, reason });
    this.#approvals.set(id, { ...approval, status: 'revoked' });
    return Promise.resolve({ ok: true, value: { id, status: 'revoked' } });
  }

  /** Add an approval — for a test that pins one. */
  public put(approval: FakeApproval): void {
    this.#approvals.set(approval.id, approval);
  }
}

/**
 * The in-memory reviews store.
 */
export class InMemoryReviewPort implements ReviewPort {
  readonly #reviews = new Map<
    string,
    {
      readonly taskId: string;
      readonly risk: string;
      readonly rationale: readonly string[];
      readonly queuedAt: string;
      readonly spec: string;
      readonly oracleResult: string;
      readonly gateReport: string;
      readonly panelResult: string;
      readonly blastRadius: string;
      readonly diffLink: string;
      readonly transcript?: string;
    }
  >();

  /** The decisions that were made — for a test to assert. */
  readonly decisions: {
    readonly taskId: string;
    readonly decision: string;
    readonly rationale: string;
    readonly identity: string;
  }[] = [];

  public list(): Promise<
    readonly {
      readonly taskId: string;
      readonly risk: string;
      readonly rationale: readonly string[];
      readonly queuedAt: string;
    }[]
  > {
    const all = [...this.#reviews.values()];
    return Promise.resolve(
      all.map(({ taskId, risk, rationale, queuedAt }) => ({
        taskId,
        risk,
        rationale,
        queuedAt,
      })),
    );
  }

  public byTaskId(
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
  > {
    const review = this.#reviews.get(taskId);
    if (review === undefined) {
      return Promise.resolve(undefined);
    }
    const bundle = {
      taskId: review.taskId,
      spec: review.spec,
      oracleResult: review.oracleResult,
      gateReport: review.gateReport,
      panelResult: review.panelResult,
      blastRadius: review.blastRadius,
      diffLink: review.diffLink,
      ...(review.transcript === undefined ? {} : { transcript: review.transcript }),
    };
    // The transcript is **opt-in**: it is the largest artefact and the
    // least often needed, so the bundle without it is the default.
    if (includeTranscript) {
      return Promise.resolve(bundle);
    }
    const { transcript: _t, ...withoutTranscript } = bundle;
    void _t;
    return Promise.resolve(withoutTranscript);
  }

  public decide(
    taskId: string,
    decision: {
      readonly decision: 'approve' | 'reject' | 'defer';
      readonly rationale: string;
      readonly identity: string;
    },
  ): Promise<
    | { readonly ok: true; readonly value: { readonly taskId: string; readonly status: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  > {
    this.decisions.push({
      taskId,
      decision: decision.decision,
      rationale: decision.rationale,
      identity: decision.identity,
    });
    return Promise.resolve({
      ok: true,
      value: { taskId, status: decision.decision },
    });
  }

  /** Add a review — for a test that pins one. */
  public put(review: {
    readonly taskId: string;
    readonly risk: string;
    readonly rationale: readonly string[];
    readonly queuedAt: string;
    readonly spec: string;
    readonly oracleResult: string;
    readonly gateReport: string;
    readonly panelResult: string;
    readonly blastRadius: string;
    readonly diffLink: string;
    readonly transcript?: string;
  }): void {
    this.#reviews.set(review.taskId, review);
  }
}

/**
 * The in-memory inspection port.
 */
export class InMemoryInspectionPort implements InspectionPort {
  public overview(): Promise<{
    readonly needsYou: readonly unknown[];
    readonly inFlight: readonly unknown[];
    readonly recentOutcomes: readonly unknown[];
    readonly health: Record<string, unknown>;
    readonly cost: Record<string, unknown>;
  }> {
    return Promise.resolve({
      needsYou: [],
      inFlight: [],
      recentOutcomes: [],
      health: { status: 'ok' },
      cost: { spentUsdMicros: 0 },
    });
  }

  public tasks(filter: {
    readonly state?: string;
    readonly repo?: string;
    readonly workflow?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<{ readonly items: readonly unknown[]; readonly nextCursor?: string }> {
    void filter;
    return Promise.resolve({ items: [] });
  }

  public task(id: string): Promise<Record<string, unknown> | undefined> {
    return Promise.resolve({ id });
  }

  public taskEvents(id: string): Promise<readonly unknown[]> {
    void id;
    return Promise.resolve([]);
  }

  public taskRuns(id: string): Promise<readonly unknown[]> {
    void id;
    return Promise.resolve([]);
  }

  public run(id: string): Promise<Record<string, unknown> | undefined> {
    return Promise.resolve({ id });
  }

  public runArtefact(
    runId: string,
    name: string,
  ): Promise<
    | {
        readonly name: string;
        readonly url: string;
        readonly expiresAt: string;
        readonly sha256: `sha256:${string}`;
      }
    | undefined
  > {
    void runId;
    return Promise.resolve({
      name,
      url: `https://artefacts.invalid/${name}`,
      expiresAt: '2026-01-01T00:00:00.000Z',
      sha256: `sha256:${'a'.repeat(64)}`,
    });
  }

  public metricsSummary(): Promise<Record<string, unknown>> {
    return Promise.resolve({ tasks: 0, spendUsdMicros: 0 });
  }

  public auditExplain(
    eventId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return Promise.resolve({ eventId, why: 'because' });
  }
}

/**
 * The in-memory intervention port.
 */
export class InMemoryInterventionPort implements InterventionPort {
  /** The actions that were taken — for a test to assert. */
  readonly actions: {
    readonly taskId: string;
    readonly action: string;
    readonly reason: string;
    readonly identity: string;
  }[] = [];

  /** The grants that were created — for a test to assert. */
  readonly grants: {
    readonly taskId: string;
    readonly capability: string;
    readonly scope: string;
    readonly ttlSeconds: number;
    readonly reason: string;
    readonly identity: string;
  }[] = [];

  /** The defects that were flagged — for a test to assert. */
  readonly defects: { readonly taskId: string; readonly note: string }[] = [];

  public act(
    taskId: string,
    action: 'pause' | 'resume' | 'cancel' | 'escalate' | 'rerun',
    reason: string,
    identity: string,
  ): Promise<
    | { readonly ok: true; readonly value: { readonly taskId: string; readonly action: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  > {
    this.actions.push({ taskId, action, reason, identity });
    return Promise.resolve({ ok: true, value: { taskId, action } });
  }

  public flagDefect(
    taskId: string,
    note: string,
  ): Promise<
    | { readonly ok: true; readonly value: { readonly taskId: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  > {
    this.defects.push({ taskId, note });
    return Promise.resolve({ ok: true, value: { taskId } });
  }

  public createTemporaryGrant(input: {
    readonly taskId: string;
    readonly capability: string;
    readonly scope: string;
    readonly ttlSeconds: number;
    readonly reason: string;
    readonly identity: string;
  }): Promise<
    | { readonly ok: true; readonly value: { readonly approvalId: string } }
    | { readonly ok: false; readonly refusal: Refusal }
  > {
    this.grants.push(input);
    return Promise.resolve({
      ok: true,
      value: { approvalId: `grant-${String(this.grants.length).padStart(6, '0')}` },
    });
  }
}

/**
 * The in-memory definition port.
 *
 * It refuses an apply whose approval does not bind the bundle — the
 * check that makes AP-6 honest.
 */
export class InMemoryDefinitionPort implements DefinitionPort {
  /** The bundle digest the port believes is active. */
  activeSha256: `sha256:${string}` = `sha256:${'b'.repeat(64)}`;

  /** The approvals the port knows, by id. */
  readonly approvals = new Map<
    string,
    { readonly artefactSha256: `sha256:${string}`; readonly approvers: readonly string[] }
  >();

  /** The applies that were attempted — for a test to assert. */
  readonly applies: {
    readonly sha: string;
    readonly approvalId: string;
    readonly identity: string;
  }[] = [];

  public plan(sha?: string): Promise<
    | {
        readonly fromSha256: `sha256:${string}`;
        readonly toSha256: `sha256:${string}`;
        readonly changes: readonly unknown[];
        readonly rendered: string;
      }
    | { readonly ok: false; readonly refusal: Refusal }
  > {
    return Promise.resolve({
      fromSha256: this.activeSha256,
      toSha256: `sha256:${'c'.repeat(64)}`,
      changes: [],
      rendered: `the plan for ${sha ?? 'the candidate'}`,
    });
  }

  public apply(input: {
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
  > {
    this.applies.push(input);

    const approval = this.approvals.get(input.approvalId);
    if (approval === undefined) {
      return Promise.resolve({
        ok: false,
        refusal: {
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          detail: `there is no approval "${input.approvalId}"`,
          code: 'validation',
        },
      });
    }

    if (approval.artefactSha256 !== this.activeSha256) {
      return Promise.resolve({
        ok: false,
        refusal: {
          type: 'about:blank',
          title: 'Hash mismatch',
          status: 409,
          detail: `the approval is bound to ${approval.artefactSha256}, not to the bundle being applied (${this.activeSha256})`,
          code: 'hash_mismatch',
        },
      });
    }

    if (!approval.approvers.includes(input.identity)) {
      return Promise.resolve({
        ok: false,
        refusal: {
          type: 'about:blank',
          title: 'Not approver',
          status: 403,
          detail: `"${input.identity}" is not in the approval's approver list`,
          code: 'not_approver',
        },
      });
    }

    return Promise.resolve({
      ok: true,
      value: {
        sha: input.sha,
        bundleSha256: this.activeSha256,
        plan: { changes: [] },
      },
    });
  }
}

/**
 * The clock the fakes run on.
 */
export const testClock = (at = '2026-01-01T00:00:00.000Z'): Clock =>
  fixedClock(new Date(at));

/**
 * The id source the fakes run on.
 */
export const testIds = (prefix = 'id') => sequentialIds(prefix);
