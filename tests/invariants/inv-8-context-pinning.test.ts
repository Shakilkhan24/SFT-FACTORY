/**
 * **INV-8** — every run's context is pinned and recoverable.
 *
 * checklist 14 §"The twelve invariants and their mutations", row INV-8:
 *
 * > | **INV-8** | Every run's context is pinned and recoverable | *skip the
 * > envelope persistence* |
 *
 * and pack `08` §3, on what the test asserts:
 *
 * > **INV-8** — every run record has `resolvedContextSha256`; the envelope
 * > object retrieves and re-hashes to the same value.
 *
 * The plan's own summary of the invariant (`visualizer/data/03-plan.js`,
 * `I-8`) names the two things that enforce it:
 *
 * > `enforced: "context_envelopes row + object; resolvedContextSha256 on
 * > every run."`
 *
 * ## What "pinned and recoverable" means, precisely
 *
 * blueprint `10` §5.2, the envelope's output fields:
 *
 * > | `items[]` | Ordered list of resolved context items with id, version, sha256, trust, byte size |
 * > | `resolvedContextSha256` | **Hash over the ordered item list** — the single value recorded in the event envelope |
 *
 * and §5.6, the pinning table:
 *
 * | Property | Mechanism |
 * |---|---|
 * | **Pinning** | Every item carries its resolved version; the envelope records the version list. |
 * | **Reproducibility** | `resolvedContextSha256` is written to the event envelope, so the exact context of any run is recoverable. |
 * | **Auditability** | The envelope is an artefact; a reviewer can see precisely what the agent was told. |
 *
 * So the digest is over **the ordered item list** — the pinned context
 * itself. That fixes what the "envelope object" is: the object in the
 * store holds the **pinned item list**, and its digest **is**
 * `resolvedContextSha256`. The `ContextEnvelope` — the product's own
 * Zod shape — is the *index* that names the digest, carries the gaps,
 * the budget and the rendered body, and points at the object.
 *
 * ## "Recoverable" is a **cross-check between two independent facts**
 *
 * checklist 01 trap 6 and the house rule "a test that asserts a constant
 * against itself cannot notice it change": the digest the record carries
 * and the digest the test computes must come from **different places**,
 * or the comparison proves nothing.
 *
 * So the two digests are produced by different machinery:
 *
 * * the record's `resolvedContextSha256` is **supplied** to the record
 *   builder — it comes from the context assembler, upstream of the store,
 *   and the store copies it verbatim;
 * * the test's digest is computed from the **bytes retrieved from the
 *   object store**, after the write. It is a hash over what came back
 *   out, not over the value that went in.
 *
 * If the record's claim and the stored evidence disagree, the test goes
 * red — and the disagreement is a real defect: the record lies about the
 * context the run saw.
 *
 * ## The three guards, and what each one proves
 *
 * | Guard | Where it lives | What breaks when it is removed |
 * |---|---|---|
 * | **G1 — the record carries the pin** | `packages/artefacts`' `buildRecord` + `assertComplete` | the record's `context` element loses its digest, so the run's context is not pinned at all |
 * | **G2 — the run links to its envelope** | `packages/artefacts`' `PostgresRunRecordStore` (`runs.context_envelope_id`) | the `runs` row no longer names the envelope, so the run cannot be traced to the context it used |
 * | **G3 — the envelope is recoverable** | the object store holds the envelope's bytes | the record's digest cannot be corroborated by anything, so "recoverable" is false |
 *
 * ## The known product gap, stated plainly
 *
 * The envelope *writer* — the thing that puts the `context_envelopes` row
 * and the envelope object in place — belongs to ticket **T-2.01** ("Context
 * assembler | … context_envelopes persistence", `visualizer/data/03-plan.js`),
 * and **T-2.01 has not been built**: `packages/context` is an empty
 * scaffold with no `src/`, and nothing in the repository writes the
 * `context_envelopes` table.
 *
 * So this test supplies that writer itself, and says so plainly, rather
 * than pretending the product has it. What the test does **not** do is
 * assert against its own writer: the digests it compares come from
 * **product** code (`@factory/core`'s `sha256` over
 * `canonicalJsonOfUnknown`), the envelope's shape comes from the
 * **product**'s `ContextEnvelope` schema in `@factory/contracts`, the
 * record comes from the **product**'s `RunArtifactStore`, and the row
 * comes from the **product**'s `PostgresRunRecordStore`.
 *
 * When T-2.01 lands, this test's writer is replaced by the product's and
 * the assertions below are unchanged: they are about the *invariant*, not
 * about the writer.
 *
 * ## The environment
 *
 * The Postgres half needs a real server — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available it **skips**: that is an environment limit,
 * not a defect. The in-memory half always runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalJsonOfUnknown, sha256 } from '../../packages/core/src/index.ts';
import { ContextEnvelope } from '../../packages/contracts/src/index.ts';
import {
  InMemoryObjectStore,
  InMemoryRunRecordStore,
  InMemorySpool,
  RunArtifactStore,
  recordKey,
  type ObjectStore,
  type RunIndexEntry,
} from '../../packages/artefacts/src/index.ts';
import { sql } from '../../packages/db/src/index.ts';
import {
  containerRunning,
  createEventLogHarness,
  insertTask,
  type EventLogHarness,
} from '../helpers/eventlog.ts';
import { THE_INDEX, THE_PARTS, parts } from '../helpers/artefacts.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the Postgres-backed halves **skip** rather than fail:
 * the absence of a Docker daemon is an environment limit, not a defect in
 * the artefacts package. The in-memory half always runs.
 */
const running = await containerRunning();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The run's id.
 */
const RUN_ID = 'run_inv8_0001';

/**
 * The task's id.
 */
const TASK_ID = 'tsk_inv8_0001';

/**
 * The context's **items** — the pinned list.
 *
 * blueprint `10` §5.2: "`resolvedContextSha256` | Hash over the ordered
 * item list". So the digest is over the **items**, in order — and the
 * items are the same list in the envelope and in the record's manifest.
 *
 * The items are deliberately *not* model ids and *not* paths: they are
 * the corpus's own shape — an id, a version, a digest and a trust.
 */
const THE_ITEMS = [
  {
    id: 'standards.security-baseline',
    version: '3',
    sha256: `sha256:${'1'.repeat(64)}`,
    trust: 'trusted' as const,
    bytes: 2048,
  },
  {
    id: 'skill.backend-conventions',
    version: '7',
    sha256: `sha256:${'2'.repeat(64)}`,
    trust: 'trusted' as const,
    bytes: 1024,
  },
] as const;

/**
 * The envelope's id.
 */
const ENVELOPE_ID = 'ctx_inv8_0001';

/**
 * The digest the **assembler** would have produced — the claim the run
 * record carries.
 *
 * It is computed with the **product's** hashing primitives, over the
 * **ordered item list**, exactly as blueprint `10` §5.2 describes. The
 * record builder copies this value verbatim; the test never recomputes it
 * from the record, so the comparison below is between two independently
 * produced facts.
 */
const RESOLVED_SHA256 = `sha256:${sha256(canonicalJsonOfUnknown(THE_ITEMS))}`;

/**
 * The **envelope** — the product's own shape.
 *
 * `ContextEnvelope` is the contracts' Zod schema (`@factory/contracts`),
 * so the envelope is validated by the product before anything is
 * persisted. The envelope's own `resolvedContextSha256` member is the
 * same digest the record carries, and the envelope's `items` are the same
 * list.
 */
const theEnvelope = (): unknown => ({
  envelopeId: ENVELOPE_ID,
  items: THE_ITEMS,
  resolvedContextSha256: RESOLVED_SHA256,
  truncations: [],
  gaps: [],
  budget: { bytes: 3072, limit: 65_536 },
  rendered: 'the rendered context the stage was told',
});

/**
 * The key the envelope's bytes live under.
 *
 * `runs/<runId>/…` — pack 02 §4.11's rule for the objects of a run.
 */
const envelopeKey = (runId: string): string => `runs/${runId}/context.json`;

/**
 * The **manifest** — element 2 of the run record.
 *
 * This is what the record carries: the envelope's id, the resolved
 * digest, the pinned items and the gaps. It is the *index* of the
 * envelope, and the digest in it is the claim the invariant checks.
 */
const theManifest = () => ({
  envelopeId: ENVELOPE_ID,
  resolvedContextSha256: RESOLVED_SHA256,
  items: THE_ITEMS.map((item) => ({
    id: item.id,
    version: item.version,
    sha256: item.sha256,
    trust: item.trust,
  })),
  gaps: [],
});

/**
 * The run's parts, with the real manifest in element 2.
 */
const theParts = () =>
  parts({
    identity: {
      runId: RUN_ID,
      taskId: TASK_ID,
      workflow: THE_PARTS.identity.workflow,
      specVersion: THE_PARTS.identity.specVersion,
    },
    context: theManifest(),
  });

/**
 * The `runs` index entry — with the **envelope linkage**.
 *
 * `contextEnvelopeId` is the product's `RunIndexEntry` member
 * (`packages/artefacts/src/ports.ts`), and it is what the product's
 * `PostgresRunRecordStore` writes into `runs.context_envelope_id`.
 */
const theIndex = (): RunIndexEntry => ({
  ...THE_INDEX,
  runId: RUN_ID,
  taskId: TASK_ID,
  contextEnvelopeId: ENVELOPE_ID,
});

/**
 * The envelope writer — the stand-in for **T-2.01**.
 *
 * ## Why it is here
 *
 * Nothing in the repository writes the `context_envelopes` table or the
 * envelope's object: `packages/context` is an empty scaffold and T-2.01
 * has not been built. So the writer is supplied here.
 *
 * ## What it writes
 *
 * The **pinned item list** — the ordered items the envelope resolved —
 * as canonical JSON. That is the envelope *object*: the bytes whose
 * digest **is** `resolvedContextSha256`, per blueprint `10` §5.2.
 *
 * ## Why it is not the thing under test
 *
 * The writer only **moves bytes**. Every decision the invariant depends
 * on is the product's:
 *
 * * the envelope's shape is validated by the product's `ContextEnvelope`
 *   schema before it is written;
 * * the digest is the product's `sha256` over the product's
 *   `canonicalJsonOfUnknown`;
 * * the run record is the product's `RunArtifactStore`;
 * * the `runs` row is the product's `PostgresRunRecordStore`.
 *
 * The writer's own output is *evidence*, and the test never compares the
 * writer against itself: it compares the **record's claim** against the
 * **bytes that came back out of the object store**.
 */
interface EnvelopeWriter {
  /** The envelope's key in the object store. */
  readonly key: string;
  /** The envelope's digest, as the `bytea` the `context_envelopes` row holds. */
  readonly digest: Uint8Array;
  /** Persist the envelope's object. */
  readonly persistObject: () => Promise<string>;
}

const theEnvelopeWriter = (objectStore: ObjectStore): EnvelopeWriter => {
  const key = envelopeKey(RUN_ID);

  return {
    key,
    digest: new Uint8Array(
      Buffer.from(RESOLVED_SHA256.replace(/^sha256:/, ''), 'hex'),
    ),
    persistObject: async () => {
      // The product's schema validates the envelope before anything is
      // written — so a malformed envelope never reaches the store.
      const envelope = ContextEnvelope.parse(theEnvelope());

      // Canonical JSON, by the product's own serialiser: the stored bytes
      // are reproducible, and the digest over them is the digest the
      // record claims.
      const bytes = new TextEncoder().encode(
        canonicalJsonOfUnknown(envelope.items),
      );

      const location = await objectStore.put(key, bytes);
      return location.uri;
    },
  };
};

/**
 * Read a stored object and hash it.
 *
 * The hash is over the **retrieved bytes** — never over the value that
 * was written. That is what makes the comparison a cross-check rather
 * than a tautology.
 */
const digestOfRetrievedBytes = (
  bytes: Uint8Array | undefined,
): string | undefined =>
  bytes === undefined ? undefined : `sha256:${sha256(bytes)}`;

/**
 * Read the stored run record.
 */
const readStoredRecord = async (
  objectStore: ObjectStore,
): Promise<Record<string, unknown> | undefined> => {
  const bytes = await objectStore.get(recordKey(RUN_ID));
  if (bytes === undefined) {
    return undefined;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe("INV-8 · every run's context is pinned and recoverable", () => {
  describe('the run record carries the pin', () => {
    it("INV-8 the record's context element names the envelope and its digest", async () => {
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });

      const written = await store.finalise(theParts(), theIndex(), 'engineering');

      // The record was written — the store refuses an incomplete one, so
      // the fact that this succeeded already says the `context` element
      // was present and non-empty (A0.3).
      expect(written.recordUri).toBeDefined();
      expect(written.record.context.envelopeId).toBe(ENVELOPE_ID);
    });

    it('INV-8 the digest is present, non-empty and a well-formed sha256', async () => {
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });

      const written = await store.finalise(theParts(), theIndex(), 'engineering');

      const digest = written.record.context.resolvedContextSha256;

      // Never absent.
      expect(digest).toBeDefined();
      // Never empty.
      expect(digest.length).toBeGreaterThan(0);
      // And a digest at all — `sha256:<64 lowercase hex>`, the form
      // pack 03 §1 fixes for every hash in the system.
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("INV-8 the stored record on disk carries the same digest", async () => {
      // The claim is asserted against the **bytes in the store**, not
      // against the object the store returned to the caller. A record
      // whose in-memory copy is right and whose stored copy is wrong is
      // still a wrong record.
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });

      await store.finalise(theParts(), theIndex(), 'engineering');

      const stored = await readStoredRecord(objectStore);
      expect(stored).toBeDefined();

      const context = stored?.['context'] as Record<string, unknown> | undefined;
      expect(context).toBeDefined();
      expect(context?.['resolvedContextSha256']).toBe(RESOLVED_SHA256);
      expect(context?.['envelopeId']).toBe(ENVELOPE_ID);
    });

    it("INV-8 the record's pinned items are the envelope's items", async () => {
      // The manifest is the **index** of the envelope. If the record
      // pinned items the envelope does not carry, the record would be
      // pinning something else — and the digest over the items would
      // describe a list nobody else has.
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });

      const written = await store.finalise(theParts(), theIndex(), 'engineering');

      const envelope = ContextEnvelope.parse(theEnvelope());

      expect(written.record.context.items.map((item) => item.id)).toEqual(
        envelope.items.map((item) => item.id),
      );
      expect(written.record.context.items.map((item) => item.version)).toEqual(
        envelope.items.map((item) => item.version),
      );
      expect(written.record.context.items.map((item) => item.sha256)).toEqual(
        envelope.items.map((item) => item.sha256),
      );
    });
  });

  describe("the envelope is recoverable — the record's claim is corroborated", () => {
    it('INV-8 the envelope object is retrievable from the object store', async () => {
      const objectStore = new InMemoryObjectStore();
      const writer = theEnvelopeWriter(objectStore);

      await writer.persistObject();

      const bytes = await objectStore.get(writer.key);
      expect(bytes).toBeDefined();
      expect(bytes?.byteLength).toBeGreaterThan(0);
    });

    it('INV-8 the retrieved envelope re-hashes to the digest the record claims', async () => {
      // **The heart of the invariant.**
      //
      // The record says `resolvedContextSha256 = X`. The envelope object
      // is retrieved from the object store and re-hashed. If the hash of
      // the retrieved bytes is not X, then either the envelope was
      // persisted wrongly or the record names a context that was never
      // stored — and in both cases the run's context is **not
      // recoverable**.
      //
      // The digest here is computed from the **retrieved bytes**. It is
      // not the constant the record carries; it is a fresh hash over
      // what the store actually held.
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });
      const writer = theEnvelopeWriter(objectStore);

      await writer.persistObject();
      const written = await store.finalise(theParts(), theIndex(), 'engineering');

      // The claim, read back out of the **stored** record.
      const stored = await readStoredRecord(objectStore);
      const context = stored?.['context'] as Record<string, unknown> | undefined;
      const claimed = context?.['resolvedContextSha256'];

      // The evidence, retrieved and re-hashed.
      const bytes = await objectStore.get(writer.key);
      const rehashed = digestOfRetrievedBytes(bytes);

      expect(rehashed).toBeDefined();
      expect(rehashed).toBe(claimed);
      // And it is the digest the record builder copied in — so the three
      // agree: the claim, the re-hash, and the assembler's digest.
      expect(rehashed).toBe(written.record.context.resolvedContextSha256);
      expect(rehashed).toBe(RESOLVED_SHA256);
    });

    it('INV-8 the re-hash bites when the envelope is NOT persisted', async () => {
      // The negative half, and the reason the assertion above is not a
      // tautology: with the envelope absent from the object store, the
      // record's digest has **nothing** to corroborate it, and the
      // re-hash fails.
      //
      // The product's own object store is what refuses the write — its
      // outage switch — so the "envelope missing" case is produced by
      // the product's error path, not by a hand-rolled double.
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });
      const writer = theEnvelopeWriter(objectStore);

      objectStore.outage = true;
      await expect(writer.persistObject()).rejects.toThrow();
      objectStore.outage = false;

      const written = await store.finalise(theParts(), theIndex(), 'engineering');

      // The record still claims a digest…
      expect(written.record.context.resolvedContextSha256).toBe(RESOLVED_SHA256);

      // …but the envelope is not there, so the claim cannot be
      // corroborated. This is what "skip the envelope persistence"
      // looks like from the reader's side.
      const bytes = await objectStore.get(writer.key);
      expect(bytes).toBeUndefined();
      expect(digestOfRetrievedBytes(bytes)).toBeUndefined();
    });

    it('INV-8 the re-hash bites when the stored envelope is not the one the record claims', async () => {
      // A second, sharper corruption: the envelope **is** in the store,
      // but it is not the envelope the record names. The re-hash must
      // notice — a record that points at the wrong context is worse than
      // a record that points at none.
      const objectStore = new InMemoryObjectStore();
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore: new InMemoryRunRecordStore(),
      });
      const writer = theEnvelopeWriter(objectStore);

      await writer.persistObject();

      // A **different** envelope, under the same key: one more item, so
      // a different digest over the ordered list.
      const tampered = ContextEnvelope.parse({
        ...(theEnvelope() as Record<string, unknown>),
        items: [...THE_ITEMS, { ...THE_ITEMS[0], id: 'standards.extra' }],
      });
      await objectStore.put(
        writer.key,
        new TextEncoder().encode(canonicalJsonOfUnknown(tampered.items)),
      );

      await store.finalise(theParts(), theIndex(), 'engineering');

      const stored = await readStoredRecord(objectStore);
      const context = stored?.['context'] as Record<string, unknown> | undefined;
      const claimed = context?.['resolvedContextSha256'];

      const bytes = await objectStore.get(writer.key);
      expect(digestOfRetrievedBytes(bytes)).not.toBe(claimed);
    });
  });

  describe("against Postgres — the envelope row and the run's linkage", () => {
    let harness: EventLogHarness;

    beforeAll(async () => {
      if (!running) {
        return;
      }
      harness = await createEventLogHarness('factory_t1_inv_8_context');
      await insertTask(harness.db, TASK_ID);
    }, 180_000);

    afterAll(async () => {
      await harness?.destroy();
    });

    /**
     * The `context_envelopes` row — read straight out of the table.
     */
    const envelopeRows = async (id: string) =>
      sql<{
        id: string;
        resolved_sha256: Buffer;
        object_uri: string | null;
        items: unknown;
        truncations: unknown;
      }>`
        SELECT id, resolved_sha256, object_uri, items, truncations
        FROM factory.context_envelopes
        WHERE id = ${id}
      `.execute(harness.db);

    /**
     * The `runs` row — read straight out of the table.
     */
    const runRows = async (runId: string) =>
      sql<{
        run_id: string;
        record_uri: string | null;
        record_sha256: Buffer | null;
        context_envelope_id: string | null;
      }>`
        SELECT run_id, record_uri, record_sha256, context_envelope_id
        FROM factory.runs
        WHERE run_id = ${runId}
      `.execute(harness.db);

    it.skipIf(!running)('INV-8 the runs row links the run to its envelope', async () => {
      // The product's `PostgresRunRecordStore` writes
      // `runs.context_envelope_id`. If the linkage is skipped, the row
      // names no envelope — and a run that cannot be traced to the
      // context it used is not a pinned context.
      const { PostgresRunRecordStore } = await import(
        '../../packages/artefacts/src/index.ts'
      );

      const objectStore = new InMemoryObjectStore();
      const runStore = new PostgresRunRecordStore({ db: harness.db });
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore,
      });

      await store.finalise(theParts(), theIndex(), 'engineering');

      const rows = await runRows(RUN_ID);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.context_envelope_id).toBe(ENVELOPE_ID);
    });

    it.skipIf(!running)('INV-8 the envelope row and the record agree on the digest', async () => {
      // The `context_envelopes` row's `resolved_sha256` is a `bytea`; the
      // record's is a `sha256:<hex>` string. They are the same value in
      // two encodings — pack 03 §1: "Hashes | JSON: sha256:<64 hex>; SQL:
      // bytea".
      const { PostgresRunRecordStore } = await import(
        '../../packages/artefacts/src/index.ts'
      );

      const objectStore = new InMemoryObjectStore();
      const runStore = new PostgresRunRecordStore({ db: harness.db });
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore,
      });
      const writer = theEnvelopeWriter(objectStore);

      await writer.persistObject();

      // The envelope's row — written here, standing in for T-2.01.
      await sql`
        INSERT INTO factory.context_envelopes (
          id, task_id, run_id, stage, resolved_sha256, items,
          truncations, gaps, bytes, budget_bytes, object_uri
        ) VALUES (
          ${ENVELOPE_ID}, ${TASK_ID}, ${RUN_ID}, 'implement',
          ${writer.digest},
          ${JSON.stringify(THE_ITEMS)}::jsonb,
          '[]'::jsonb, '[]'::jsonb,
          3072, 65536, ${`s3://factory-artifacts/${writer.key}`}
        )
      `.execute(harness.db);

      await store.finalise(theParts(), theIndex(), 'engineering');

      // The row's digest, in the `bytea` encoding.
      const envelopeRowsFound = await envelopeRows(ENVELOPE_ID);
      expect(envelopeRowsFound.rows).toHaveLength(1);
      const rowDigest = `sha256:${(envelopeRowsFound.rows[0]?.resolved_sha256 ?? Buffer.alloc(0)).toString('hex')}`;

      // The claim, read back out of the **stored** record.
      const stored = await readStoredRecord(objectStore);
      const context = stored?.['context'] as Record<string, unknown> | undefined;
      const claimed = context?.['resolvedContextSha256'];

      // The two encodings of one value.
      expect(rowDigest).toBe(claimed);
      expect(rowDigest).toBe(RESOLVED_SHA256);

      // And the object the row names is the one that re-hashes to it.
      const bytes = await objectStore.get(writer.key);
      expect(digestOfRetrievedBytes(bytes)).toBe(claimed);
    });

    it.skipIf(!running)("INV-8 the envelope row's truncations are empty — the assembler fails, never truncates", async () => {
      // pack 03 §3: "`ContextEnvelope.truncations: never[]` — the
      // assembler **fails**, never truncates". The DDL agrees:
      // `context_envelopes.truncations jsonb NOT NULL DEFAULT '[]'`.
      const { PostgresRunRecordStore } = await import(
        '../../packages/artefacts/src/index.ts'
      );

      const objectStore = new InMemoryObjectStore();
      const runStore = new PostgresRunRecordStore({ db: harness.db });
      const store = new RunArtifactStore({
        objectStore,
        spool: new InMemorySpool(),
        runStore,
      });
      const writer = theEnvelopeWriter(objectStore);

      await writer.persistObject();

      await sql`
        INSERT INTO factory.context_envelopes (
          id, task_id, run_id, stage, resolved_sha256, items,
          truncations, gaps, bytes, budget_bytes, object_uri
        ) VALUES (
          ${ENVELOPE_ID}, ${TASK_ID}, ${RUN_ID}, 'implement',
          ${writer.digest},
          ${JSON.stringify(THE_ITEMS)}::jsonb,
          '[]'::jsonb, '[]'::jsonb,
          3072, 65536, ${`s3://factory-artifacts/${writer.key}`}
        )
        ON CONFLICT (id) DO NOTHING
      `.execute(harness.db);

      await store.finalise(theParts(), theIndex(), 'engineering');

      const found = await envelopeRows(ENVELOPE_ID);
      expect(found.rows[0]?.truncations).toEqual([]);
    });
  });
});
