/**
 * `eventlog` — the append-only event log (checklist 02, T-1.03).
 *
 * pack 02 §4.2: "Event log [BP: ADR-0008, 09 §4–6, ADR-0019]".
 *
 * The package holds:
 *
 * * `PostgresEventLog` — the `EventLog` implementation from pack 03 §3,
 *   against Postgres;
 * * the per-aggregate hash chain (pure);
 * * the redaction hook (pure), applied **before** the insert;
 * * the aggregate registry — which table backs which `aggregate_kind`, and
 *   how its row is addressed.
 *
 * The event log is the factory's **single source of truth** (blueprint `09`
 * §5.2: "This keeps the log the single source of truth"), and every
 * projection is disposable and rebuildable from it.
 */

export {
  ConcurrencyError,
  EventLogError,
} from './errors.js';

export {
  AGGREGATE_BINDINGS,
  AGGREGATE_ID_SEPARATOR,
  bindingFor,
  decodeNodeAggregateId,
  nodeAggregateId,
  type AggregateBinding,
} from './aggregates.js';

export {
  DEFAULT_DENIED_ENV_NAMES,
  DEFAULT_SENSITIVE_KEYS,
  REDACTION_PLACEHOLDER,
  defaultRedactionPolicy,
  noopRedactor,
  redactorFor,
  type RedactionPolicy,
  type RedactionResult,
  type Redactor,
} from './redaction.js';

export {
  HASH_FIELD,
  PREV_HASH_FIELD,
  bytesToDigest,
  chainHash,
  hexToBytes,
  verifyChainLinks,
  type ChainLink,
  type ChainVerificationResult,
} from './hash-chain.js';

export {
  EVENT_SCHEMA_VERSION,
  NOTIFY_CHANNEL,
  NOTIFY_PAYLOAD_LIMIT,
  PostgresEventLog,
  digestBytes,
  envelopeCanonicalJson,
  envelopeForHashing,
  versionKey,
  type AppendOptions,
  type PostgresEventLogOptions,
} from './postgres-event-log.js';

export {
  checkEventLogHealth,
  findSeqGaps,
  findVersionGaps,
  type AggregateVersionGap,
  type EventLogHealth,
} from './monitor.js';
