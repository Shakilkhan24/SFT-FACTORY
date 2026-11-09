/**
 * The Postgres event log (pack 02 §4.2).
 *
 * > `append(events[], expectedVersions)` in **one DB transaction**: take the
 * > counter row `FOR UPDATE` → assign gapless `seq` → CAS-bump the aggregate
 * > row version where the event changes state → insert → compute
 * > `hash = sha256(prev_hash ‖ canonicalJson(envelope))` (chain **per
 * > aggregate**) → `NOTIFY factory_events`.
 *
 * ## Why the counter row, and not a sequence
 *
 * ADR-0019: a `bigserial` leaves gaps on rollback (the sequence does not
 * roll back) and can commit out of order (a transaction that took sequence
 * 7 may commit after one that took 8), so a reader sees a gap that is not a
 * lost write and a projector that assumes "no gap ⇒ no loss" skips events.
 *
 * A single counter row held under `SELECT ... FOR UPDATE` fixes both: the
 * lock serialises appenders, so the `seq`s are assigned in *commit* order,
 * and a rolled-back increment leaves no gap because the increment was part of
 * the rolled-back transaction.
 *
 * The cost is that every append serialises on one row. The revisit trigger
 * in checklist 02 is explicit about this: "if p95 append >50 ms or >200
 * events/s sustained → switch to sequence + snapshot-safe reader".
 *
 * ## Why the whole append is one transaction
 *
 * checklist 02 trap 4: "Putting state changes and event appends in separate
 * transactions. They must be one. Otherwise I-3 … is false under crash."
 *
 * blueprint `09` §6: "No silent task loss | State transitions and their
 * events are written in one transaction".
 *
 * So `append()` is one transaction from the counter lock to the COMMIT, and
 * it is the *caller's* job to run the state change in the same transaction —
 * which is why `append` takes a `Transaction` rather than a `Kysely`, and why
 * `appendInTransaction` is exposed separately.
 *
 * ## The hash chain
 *
 * The chain is **per aggregate**. The previous hash for an aggregate is read
 * inside the same transaction, after the counter lock has been taken — so it
 * cannot be read stale, because no other appender can be between its own
 * counter lock and its insert.
 */

import { randomFillSync } from 'node:crypto';

import type {
  EventQuery,
  NewEvent} from '@factory/contracts';
import {
  EventEnvelope,
  EventTypeSchema,
  type Actor,
  type AggregateKind,
  type Authority,
  type ChainVerification,
  type ContextRef,
  type EventLog,
  type Redaction,
} from '@factory/contracts';
import { canonicalJsonOfUnknown, sha256Bytes, type JsonValue } from '@factory/core';
import {
  type FactoryDatabase,
  type Kysely,
  sql,
  type Transaction,
} from '@factory/db';

// `RawBuilder` is the type of a `sql` fragment. Kysely 0.27 does not export
// a `SQL` alias, so the fragment type is named here.
type RawBuilder<O> = ReturnType<typeof sql<O>>;

import { AGGREGATE_ID_SEPARATOR, bindingFor } from './aggregates.js';
import { ConcurrencyError, EventLogError } from './errors.js';
import {
  bytesToDigest,
  chainHash,
  hexToBytes,
  verifyChainLinks,
  type ChainLink,
} from './hash-chain.js';
import { noopRedactor, type Redactor } from './redaction.js';

/**
 * The schema version stamped on every event written by this implementation.
 *
 * blueprint `09` §4: "The schema is versioned; fields may be added, never
 * repurposed." Version 1 is the pack's version-1 envelope (pack 03 §3).
 */
export const EVENT_SCHEMA_VERSION = 1;

/**
 * The NOTIFY channel.
 *
 * pack 02 §4.2: "→ `NOTIFY factory_events`". checklist 01 S-1: "NOTIFY
 * payload carries only `seq` (size limit)" — so the payload is the single
 * number, never the envelope.
 */
export const NOTIFY_CHANNEL = 'factory_events';

/**
 * The maximum number of bytes in a NOTIFY payload.
 *
 * PostgreSQL's limit is 8000 bytes by default. The payload here is a single
 * integer, so it is always tiny — but the limit is asserted rather than
 * assumed, because the failure mode (a silently truncated payload) would be
 * invisible.
 */
export const NOTIFY_PAYLOAD_LIMIT = 8000;

/**
 * The dependencies of a `PostgresEventLog`.
 */
export interface PostgresEventLogOptions {
  /** The database handle. */
  readonly db: Kysely<FactoryDatabase>;

  /**
   * The redaction hook, applied **before** the INSERT.
   *
   * Defaults to a no-op hook that still records `redaction.v1` as its policy,
   * so a reader can tell "nothing was redacted" from "redaction never ran".
   */
  readonly redactor?: Redactor;

  /**
   * The policy reference recorded in `redaction.policyRef`.
   *
   * Defaults to `'redaction.v1'`.
   */
  readonly policyRef?: string;

  /**
   * The clock, for `occurredAt`.
   *
   * Injected (AGENTS.md §4: "Time via injected `Clock`") so tests are
   * deterministic. Defaults to the system clock.
   */
  readonly now?: () => Date;

  /**
   * The source of event ids.
   *
   * Event ids are UUIDv7 (pack 03 §2: "`event_id uuid NOT NULL, -- UUIDv7`").
   * Defaults to UUIDv7 over `crypto.randomFillSync`.
   */
  readonly newEventId?: () => string;
}

/**
 * The options accepted by `append`.
 */
export interface AppendOptions {
  /**
   * The expected current version of each aggregate, keyed by
   * `"<kind>:<id>"`.
   *
   * When an aggregate's version does not match, the append is refused with a
   * `ConcurrencyError` and **no event is written**.
   *
   * The check is a compare-and-swap against the aggregate's row, so two
   * concurrent appends that both expect version 7 leave exactly one winner.
   */
  readonly expectedVersions?: Readonly<Record<string, number>>;
}

/**
 * A row as read from the `events` table.
 */
interface EventRow {
  readonly seq: string | number;
  readonly event_id: string;
  readonly occurred_at: Date;
  readonly event_type: string;
  readonly schema_version: number;
  readonly aggregate_kind: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly authority: unknown;
  readonly subject: unknown;
  readonly payload: unknown;
  readonly context: unknown;
  readonly redaction: unknown;
  readonly cost_usd_micros: string | number | null;
  readonly duration_ms: number | null;
  readonly prev_hash: Buffer | null;
  readonly hash: Buffer;
}

/** The default UUIDv7 event-id source. */
const defaultEventId = (): string => {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

/**
 * The key an aggregate's expected version is filed under.
 *
 * `"task:tsk_1"`, `"node:tsk_1/n1-implement"`.
 */
export const versionKey = (kind: string, id: string): string => `${kind}:${id}`;

/**
 * The Postgres event log.
 */
export class PostgresEventLog implements EventLog {
  private readonly db: Kysely<FactoryDatabase>;

  private readonly redactor: Redactor;

  private readonly policyRef: string;

  private readonly now: () => Date;

  private readonly newEventId: () => string;

  constructor(options: PostgresEventLogOptions) {
    this.db = options.db;
    this.redactor = options.redactor ?? noopRedactor();
    this.policyRef = options.policyRef ?? 'redaction.v1';
    this.now = options.now ?? ((): Date => new Date());
    this.newEventId = options.newEventId ?? defaultEventId;
  }

  /**
   * Append events in **one** transaction.
   *
   * The returned envelopes are in the same order as the input.
   */
  public async append(
    events: readonly NewEvent[],
    opts?: AppendOptions,
  ): Promise<EventEnvelope[]> {
    if (events.length === 0) {
      return [];
    }
    return this.db.transaction().execute(async (trx) => this.appendInTransaction(trx, events, opts));
  }

  /**
   * Append events inside a transaction the caller owns.
   *
   * This is the form T-1.04's `transition()` uses: the state change and the
   * event that records it must be in **one** transaction (checklist 02 trap
   * 4), so the state machine opens the transaction and hands it to both.
   */
  public async appendInTransaction(
    trx: Transaction<FactoryDatabase>,
    events: readonly NewEvent[],
    opts?: AppendOptions,
  ): Promise<EventEnvelope[]> {
    if (events.length === 0) {
      return [];
    }

    // 1. Take the counter row's lock. Everything below is serialised behind
    //    it, which is what makes the `seq` gapless and commit-ordered.
    const counter = await sql<{ value: string }>`
      SELECT value FROM factory.event_counter WHERE id = 1 FOR UPDATE
    `.execute(trx);
    const counterRow = counter.rows[0];
    if (counterRow === undefined) {
      throw new EventLogError('factory.event_counter row (id=1) is missing');
    }
    const base = Number(counterRow.value);

    // 2. Assign the `seq`s. They are consecutive, and they are assigned in
    //    the order the events were given.
    const assigned = events.map((event, index) => ({
      event,
      seq: base + index + 1,
    }));

    // 3. Apply redaction **before** anything is written. The redacted
    //    payload is what gets inserted and what gets hashed.
    const redacted = assigned.map(({ event, seq }) => ({ ...this.redact(event), seq }));

    // 4. CAS-bump the aggregate versions, and read the previous hash of each
    //    aggregate's chain.
    //
    //    Both happen under the counter lock, so the chain read cannot be
    //    stale: no other appender is between its lock and its insert.
    //
    //    The bump is **per event**, not per aggregate. A batch may carry
    //    several events for the same aggregate, and each one is a distinct
    //    state change — blueprint `09` §6, "exactly-once event per action" —
    //    so each advances the version by one and each envelope records the
    //    version *it* produced.
    //
    //    The CAS expectation for the first event of an aggregate comes from
    //    `expectedVersions`; each later event of the same aggregate expects
    //    the version the previous event of the batch produced. That keeps the
    //    optimistic-concurrency check meaningful across the whole batch
    //    instead of letting the second bump silently overwrite the first.
    const versions: number[] = [];
    const previousHashes = new Map<string, string | null>();
    // The version each aggregate has reached *within this batch*. A later
    // event for the same aggregate expects this value, not the caller's
    // original expectation — otherwise the second CAS would compare against a
    // version that no longer exists.
    const batchVersions = new Map<string, number>();

    for (const item of redacted) {
      const { event } = item;
      const kind = event.aggregate.kind;
      const id = event.aggregate.id;
      const key = versionKey(kind, id);
      const binding = bindingFor(kind);

      if (binding.versioned) {
        const expected = batchVersions.has(key)
          ? batchVersions.get(key)
          : opts?.expectedVersions?.[key];
        const version = await this.bumpAggregateVersion(trx, binding, id, expected);
        batchVersions.set(key, version);
        versions.push(version);
      } else {
        // Not versioned: the event records the version the caller asserted.
        versions.push(event.aggregate.version);
      }

      if (!previousHashes.has(key)) {
        previousHashes.set(key, await this.lastHashFor(trx, kind, id));
      }
    }

    // 5. Build the envelopes and the hash chain.
    //
    //    The chain is per aggregate: the first event of an aggregate in this
    //    batch chains onto the aggregate's last stored hash, and each
    //    subsequent event of the same aggregate chains onto its predecessor
    //    in this batch.
    const chainState = new Map<string, string | null>(previousHashes);
    const envelopes: EventEnvelope[] = [];

    for (const [index, item] of redacted.entries()) {
      const { event, seq } = item;
      const key = versionKey(event.aggregate.kind, event.aggregate.id);
      const prevHash = chainState.get(key) ?? null;
      const version = versions[index] ?? event.aggregate.version;

      const envelope = this.buildEnvelope(event, seq, version, item.redaction, prevHash);
      const hash = chainHash(envelope as unknown as Record<string, unknown>, prevHash);

      const withHash = {
        ...envelope,
        prevHash: prevHash === null ? undefined : bytesToDigest(hexToBytes(prevHash)),
        hash: bytesToDigest(hexToBytes(hash)),
      };

      chainState.set(key, hash);
      envelopes.push(withHash as unknown as EventEnvelope);
    }

    // 6. Insert every row. One statement, so a failure affects all of them
    //    and the transaction rolls back as a unit.
    for (const envelope of envelopes) {
      await this.insertEvent(trx, envelope);
    }

    // 7. Advance the counter. It is part of this transaction, so a rollback
    //    leaves no gap.
    //
    //    The counter is set to the **absolute** last `seq` this append
    //    allocated, not incremented relatively. The row lock makes the two
    //    equivalent, but the absolute form does not depend on that invariant
    //    holding: if the allocation above were ever changed to read the
    //    counter without the lock, a relative increment would silently
    //    double-count rather than fail loudly.
    const lastSeq = envelopes[envelopes.length - 1]?.seq ?? 0;
    await sql`
      UPDATE factory.event_counter SET value = ${BigInt(lastSeq)} WHERE id = 1
    `.execute(trx);

    // 8. Notify. The payload carries only the `seq` (checklist 01 S-1), so
    //    it is always far below PostgreSQL's 8000-byte limit.
    const payload = String(lastSeq);
    if (payload.length > NOTIFY_PAYLOAD_LIMIT) {
      throw new EventLogError(
        `NOTIFY payload is ${String(payload.length)} bytes, over the ${String(
          NOTIFY_PAYLOAD_LIMIT,
        )}-byte limit`,
      );
    }
    await sql`SELECT pg_notify(${NOTIFY_CHANNEL}, ${payload})`.execute(trx);

    return envelopes;
  }

  /**
   * Read events.
   *
   * pack 02 §4.2: "Reads: by aggregate, by correlation id, by `seq` range, by
   * type."
   */
  public async *read(query: EventQuery): AsyncIterable<EventEnvelope> {
    // The query shape is built by hand because the filters are optional and
    // combinatorial; Kysely's builder would need a static overload per
    // combination. Every value is a **bound parameter** — the `sql` tag
    // parameterises its substitutions — and nothing is interpolated into the
    // SQL string.
    const conditions: RawBuilder<unknown>[] = [];

    if (query.aggregate !== undefined) {
      conditions.push(
        sql`aggregate_kind = ${query.aggregate.kind} AND aggregate_id = ${query.aggregate.id}`,
      );
    }
    if (query.correlationId !== undefined) {
      conditions.push(sql`correlation_id = ${query.correlationId}`);
    }
    if (query.types !== undefined && query.types.length > 0) {
      // `sql.join` renders a comma-separated list, so it is wrapped in
      // `ARRAY[...]` to make it an array the `ANY` operator accepts.
      conditions.push(sql`event_type = ANY(ARRAY[${sql.join(query.types)}])`);
    }
    if (query.afterSeq !== undefined) {
      conditions.push(sql`seq > ${query.afterSeq}`);
    }

    const where =
      conditions.length > 0
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

    const rows = await sql`
      SELECT * FROM factory.events
      ${where}
      ORDER BY seq ASC
      LIMIT ${query.limit ?? 1000}
    `.execute(this.db);

    for (const row of rows.rows as unknown as EventRow[]) {
      yield rowToEnvelope(row);
    }
  }

  /**
   * Verify the hash chain of one aggregate.
   *
   * pack 03 §3: `verifyChain(aggregate): Promise<{ ok: boolean; brokenAtSeq?: number }>`.
   */
  public async verifyChain(aggregate: {
    kind: string;
    id: string;
  }): Promise<ChainVerification> {
    const rows = await sql`
      SELECT * FROM factory.events
      WHERE aggregate_kind = ${aggregate.kind} AND aggregate_id = ${aggregate.id}
      ORDER BY seq ASC
    `.execute(this.db);

    const links: ChainLink[] = (rows.rows as unknown as EventRow[]).map((row) => ({
      seq: Number(row.seq),
      prevHash: row.prev_hash === null ? null : bytesToDigest(new Uint8Array(row.prev_hash)),
      hash: bytesToDigest(new Uint8Array(row.hash)),
      envelope: envelopeForHashing(row),
    }));

    const result = verifyChainLinks(links);
    if (result.ok) {
      return { ok: true };
    }
    return { ok: false, brokenAtSeq: result.brokenAtSeq };
  }

  /**
   * Apply redaction to one event.
   *
   * The redaction hook runs over the **payload** — the part of the envelope
   * that carries captured data. The actor, authority, subject and context
   * are structural, not captured, and are hashed as-is.
   */
  private redact(event: NewEvent): {
    event: NewEvent;
    redaction: Redaction;
  } {
    const payload = this.redactor(event.payload as JsonValue);
    // The recorded paths are relative to the **envelope**, not to the
    // payload — so a reader of the log can find the redacted member without
    // knowing which part of the envelope it came from. blueprint `09` §4.1
    // shows `"applied": ["arguments.body", "result.body"]`, which are
    // payload-relative; the envelope prefix keeps the two consistent.
    const applied = payload.applied.map((path) => `payload.${path}`);

    // The `subject` map holds captured references too (repo, branch, sha),
    // so it is redacted on the same pass.
    const subject = this.redactor((event.subject ?? {}) as JsonValue);
    applied.push(...subject.applied.map((path) => `subject.${path}`));

    const redactedEvent: NewEvent = {
      ...event,
      payload: payload.value as NewEvent['payload'],
      subject: subject.value as NewEvent['subject'],
    };

    return {
      event: redactedEvent,
      redaction: { applied, policyRef: this.policyRef },
    };
  }

  /**
   * Build the envelope for one event.
   */
  private buildEnvelope(
    event: NewEvent,
    seq: number,
    version: number,
    redaction: Redaction,
    prevHash: string | null,
  ): Omit<EventEnvelope, 'hash'> & { hash?: never } {
    const eventType = EventTypeSchema.safeParse(event.eventType);
    if (!eventType.success) {
      throw new EventLogError(
        `event type ${JSON.stringify(event.eventType)} is not in the registered vocabulary`,
      );
    }

    const context: ContextRef = (event.context ?? { items: [] });
    const actor: Actor = event.actor;
    const authority: Authority = event.authority;

    const envelope = {
      eventId: this.newEventId(),
      seq,
      occurredAt: this.now().toISOString(),
      eventType: eventType.data,
      schemaVersion: EVENT_SCHEMA_VERSION,
      aggregate: {
        kind: event.aggregate.kind,
        id: event.aggregate.id,
        version,
      },
      correlationId: event.correlationId,
      ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      actor,
      authority,
      subject: (event.subject ?? {}),
      payload: event.payload,
      context,
      redaction,
      ...(event.costUsdMicros === undefined ? {} : { costUsdMicros: event.costUsdMicros }),
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      ...(prevHash === null ? {} : { prevHash: bytesToDigest(hexToBytes(prevHash)) }),
    };

    // Validate the envelope against the registered schema, so a malformed
    // event is refused before it reaches the table.
    const parsed = EventEnvelope.safeParse({ ...envelope, hash: 'sha256:' + '0'.repeat(64) });
    if (!parsed.success) {
      throw new EventLogError(
        `event envelope is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    return envelope as Omit<EventEnvelope, 'hash'> & { hash?: never };
  }

  /**
   * Insert one envelope.
   */
  private async insertEvent(
    trx: Transaction<FactoryDatabase>,
    envelope: EventEnvelope,
  ): Promise<void> {
    const prevHashBytes =
      envelope.prevHash === undefined ? null : Buffer.from(hexToBytes(envelope.prevHash));
    const hashBytes = Buffer.from(hexToBytes(envelope.hash));

    await sql`
      INSERT INTO factory.events (
        seq, event_id, occurred_at, event_type, schema_version,
        aggregate_kind, aggregate_id, aggregate_version,
        correlation_id, causation_id,
        actor_kind, actor_id, authority, subject, payload, context, redaction,
        cost_usd_micros, duration_ms, prev_hash, hash
      ) VALUES (
        ${envelope.seq},
        ${envelope.eventId}::uuid,
        ${envelope.occurredAt}::timestamptz,
        ${envelope.eventType},
        ${envelope.schemaVersion},
        ${envelope.aggregate.kind},
        ${envelope.aggregate.id},
        ${envelope.aggregate.version},
        ${envelope.correlationId},
        ${envelope.causationId ?? null},
        ${envelope.actor.kind},
        ${envelope.actor.id},
        ${JSON.stringify(envelope.authority)}::jsonb,
        ${JSON.stringify(envelope.subject)}::jsonb,
        ${JSON.stringify(envelope.payload)}::jsonb,
        ${JSON.stringify(envelope.context)}::jsonb,
        ${JSON.stringify(envelope.redaction)}::jsonb,
        ${envelope.costUsdMicros ?? null},
        ${envelope.durationMs ?? null},
        ${prevHashBytes},
        ${hashBytes}
      )
    `.execute(trx);
  }

  /**
   * Compare-and-swap an aggregate's version.
   *
   * When `expected` is `undefined`, the version is simply bumped — the
   * caller is not asserting a particular version, and the bump still
   * serialises concurrent writers.
   *
   * @throws {ConcurrencyError} when the version does not match, or the row
   *   does not exist.
   */
  private async bumpAggregateVersion(
    trx: Transaction<FactoryDatabase>,
    binding: {
      kind: string;
      table: string;
      keyColumns: readonly string[];
      decodeId?: (id: string) => readonly string[];
    },
    aggregateId: string,
    expected: number | undefined,
  ): Promise<number> {
    const keyValues = binding.decodeId
      ? binding.decodeId(aggregateId)
      : [aggregateId];

    // The key columns are a literal list from the aggregate registry; every
    // value is a bound parameter.
    const keyCondition =
      binding.keyColumns.length === 1
        ? sql`${sql.id(binding.keyColumns[0] ?? '')} = ${keyValues[0] ?? ''}`
        : sql`${sql.join(
            binding.keyColumns.map(
              (column, index) => sql`${sql.id(column)} = ${keyValues[index] ?? ''}`,
            ),
            sql` AND `,
          )}`;

    // The CAS. `version = expected` is the compare; `version + 1` is the
    // swap. When the caller asserts no expected version, the row is still
    // locked and bumped — the UPDATE itself takes the row lock, so
    // concurrent writers are serialised by it.
    const result =
      expected === undefined
        ? await sql<{ version: number }>`
            UPDATE factory.${sql.id(binding.table)}
            SET version = version + 1
            WHERE ${keyCondition}
            RETURNING version
          `.execute(trx)
        : await sql<{ version: number }>`
            UPDATE factory.${sql.id(binding.table)}
            SET version = version + 1
            WHERE ${keyCondition} AND version = ${expected}
            RETURNING version
          `.execute(trx);

    const row = result.rows[0];
    if (row !== undefined) {
      return Number(row.version);
    }

    // Either the row does not exist, or its version is not the expected one.
    // Read the current version so the error says which.
    const current = await sql<{ version: number }>`
      SELECT version FROM factory.${sql.id(binding.table)}
      WHERE ${keyCondition}
    `.execute(trx);
    const actual = current.rows[0]?.version;

    throw new ConcurrencyError(
      binding.kind,
      aggregateId,
      expected ?? -1,
      actual === undefined ? undefined : Number(actual),
    );
  }

  /**
   * Read the last hash in an aggregate's chain.
   */
  private async lastHashFor(
    trx: Transaction<FactoryDatabase>,
    kind: string,
    id: string,
  ): Promise<string | null> {
    const result = await sql<{ hash: Buffer }>`
      SELECT hash FROM factory.events
      WHERE aggregate_kind = ${kind} AND aggregate_id = ${id}
      ORDER BY seq DESC
      LIMIT 1
    `.execute(trx);
    const row = result.rows[0];
    return row === undefined ? null : bytesToDigest(new Uint8Array(row.hash));
  }
}

/**
 * Convert a stored row into an envelope.
 */
const rowToEnvelope = (row: EventRow): EventEnvelope => ({
  eventId: row.event_id,
  seq: Number(row.seq),
  occurredAt: row.occurred_at.toISOString(),
  eventType: row.event_type as EventEnvelope["eventType"],
  schemaVersion: Number(row.schema_version),
  aggregate: {
    kind: row.aggregate_kind as AggregateKind,
    id: row.aggregate_id,
    version: Number(row.aggregate_version),
  },
  correlationId: row.correlation_id,
  ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
  actor: { kind: row.actor_kind, id: row.actor_id } as Actor,
  authority: row.authority as Authority,
  subject: row.subject as Record<string, string>,
  payload: row.payload,
  context: row.context as ContextRef,
  redaction: row.redaction as Redaction,
  ...(row.cost_usd_micros === null ? {} : { costUsdMicros: Number(row.cost_usd_micros) }),
  ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
  ...(row.prev_hash === null ? {} : { prevHash: bytesToDigest(new Uint8Array(row.prev_hash)) }),
  hash: bytesToDigest(new Uint8Array(row.hash)),
});

/**
 * The envelope as it was hashed — the fields the hash covers.
 *
 * The hash is computed over the canonical JSON of the envelope *without* its
 * own `hash`, but *with* `prevHash`. So verification must reconstruct the
 * same view: the same fields, in the same camelCase names, with `hash`
 * removed and `prevHash` present.
 */
export const envelopeForHashing = (row: EventRow): Record<string, unknown> => {
  const envelope: Record<string, unknown> = {
    eventId: row.event_id,
    seq: Number(row.seq),
    occurredAt: row.occurred_at.toISOString(),
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    aggregate: {
      kind: row.aggregate_kind,
      id: row.aggregate_id,
      version: Number(row.aggregate_version),
    },
    correlationId: row.correlation_id,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    actor: { kind: row.actor_kind, id: row.actor_id },
    authority: row.authority,
    subject: row.subject,
    payload: row.payload,
    context: row.context,
    redaction: row.redaction,
    ...(row.cost_usd_micros === null ? {} : { costUsdMicros: Number(row.cost_usd_micros) }),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    ...(row.prev_hash === null ? {} : { prevHash: bytesToDigest(new Uint8Array(row.prev_hash)) }),
  };
  return envelope;
};

/**
 * The canonical JSON of an envelope — exposed for tests and for the
 * `verifyChain` parity check.
 */
export const envelopeCanonicalJson = (envelope: unknown): string =>
  canonicalJsonOfUnknown(envelope);

/**
 * The raw bytes of a digest — exposed for tests.
 */
export const digestBytes = sha256Bytes;

/**
 * The aggregate-id separator — re-exported for callers that build ids.
 */
export { AGGREGATE_ID_SEPARATOR };
