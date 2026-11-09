/**
 * `db` — the PostgreSQL access layer.
 *
 * Delivered by checklist 02, ticket T-1.02. The package owns:
 *
 * * the Kysely types for the `factory` schema (pack 03 §2);
 * * the connection factory, and the distinction between the owner role and
 *   the least-privilege runtime roles;
 * * the forward-only migration runner.
 *
 * The DDL itself is not here — it is in `migrations/`, applied by
 * `factory db migrate`. Keeping the SQL in `.sql` files (rather than in
 * TypeScript) is what lets `reference/validate_ddl.sh` and
 * `tools/extract-pack-ddl.ts` both read the same bytes.
 */

export {
  FACTORY_ROLES,
  isFactoryRole,
  createDatabase,
  destroyDatabase,
  connectionStringFor,
  type ConnectionConfig,
  type ConnectionMode,
  type FactoryRole,
} from './connection.js';

// The Kysely handle type is re-exported so that a consumer does not need a
// direct dependency on `kysely` just to name the type of a database handle.
//
// `Transaction` is re-exported for the same reason and because the event
// log's `appendInTransaction` takes one: a state change and its event must
// be written in **one** transaction (checklist 02 trap 4), so the caller
// opens the transaction and hands it to both.
export type { Kysely, Transaction } from 'kysely';

// `sql` is the raw-SQL template tag. The event log needs it because the
// append algorithm uses `FOR UPDATE`, `RETURNING` and `pg_notify` — none of
// which the query builder expresses.
export { sql } from 'kysely';

export {
  MIGRATION_LEDGER,
  MigrationChecksumMismatchError,
  appliedMigrations,
  checksumOf,
  ensureLedger,
  ensurePartitions,
  eventPartitions,
  migrate,
  orphanedMigrations,
  readMigrations,
  status,
  type AppliedMigration,
  type MigrateResult,
  type MigrationFile,
  type MigrationStatus,
  type PartitionInfo,
} from './migrations.js';

export type {
  ApprovalsTable,
  ChangesTable,
  ContextEnvelopesTable,
  CredentialLeasesTable,
  DefinitionVersionsTable,
  EdgeOutboxTable,
  EgressTokensTable,
  EventCounterTable,
  EventsTable,
  FactoryDatabase,
  GateReportsTable,
  GatewayTokensTable,
  JobsTable,
  KillSwitchTable,
  ModelCallsTable,
  NewDefinitionVersions,
  NewEdgeOutbox,
  NewEvents,
  NewPolicyDecisions,
  NewTasks,
  NodesTable,
  OraclesTable,
  PolicyDecisionsTable,
  ProjectionCursorsTable,
  RunsTable,
  SelectedDefinitionVersions,
  SelectedEdgeOutbox,
  SelectedEvents,
  SelectedPolicyDecisions,
  SelectedTasks,
  TasksTable,
  ToolInvocationsTable,
  UpdatedEvents,
  UpdatedTasks,
} from './types.js';
