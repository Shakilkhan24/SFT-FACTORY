/**
 * `definition` — reading the approval the apply needs.
 *
 * pack 02 §4.1: "`apply(sha)` requires … an owner `definition` approval
 * bound to `bundleSha256`".
 *
 * ## Why the reader lives here and not in the CLI
 *
 * The apply cannot self-approve, and it cannot be handed an approval by
 * something that decided it. The approval is a row in the `approvals` table,
 * written by whoever ran the approval flow, and the apply has to read *that
 * row* — not a value the caller supplied.
 *
 * If the reader lived in the CLI, then "the approval the applier checked"
 * would be whatever the CLI chose to pass in, and the CLI is exactly the
 * thing the control-surface boundary is meant to keep out. So the reader
 * reads the table, by id, and returns the row.
 *
 * ## The reader is read-only
 *
 * It issues a single `SELECT`. It never writes the approval's status, never
 * consumes it, and never changes it. Consuming an approval is the apply's
 * job and it happens in the applier's transaction (T-1.13's orchestrator owns
 * that), not here.
 */

import type { Approval } from '@factory/contracts';
import { sql, type Kysely } from 'kysely';

import type { ApprovalsTable, FactoryDatabase } from '@factory/db';

/**
 * The port the applier reads an approval through.
 */
export interface ApprovalReader {
  /**
   * The approval with the given id, if there is one.
   *
   * `undefined` when no approval with that id exists.
   */
  byId(id: string): Promise<Approval | undefined>;
}

/**
 * The approval reader, backed by the `approvals` table.
 */
export class PostgresApprovalReader implements ApprovalReader {
  readonly #db: Kysely<FactoryDatabase>;

  constructor(db: Kysely<FactoryDatabase>) {
    this.#db = db;
  }

  async byId(id: string): Promise<Approval | undefined> {
    const row = await this.#db
      .selectFrom('approvals')
      .select([
        'id',
        'task_id',
        'type',
        'artefact_kind',
        'artefact_ref',
        'artefact_sha256',
        'approvers',
        'status',
        // The timestamps are cast to text in SQL rather than read as driver
        // values. The contract carries an ISO instant as a string, so the
        // cast is exactly the shape the contract wants — and it avoids
        // depending on the driver's `timestamptz` parsing, which is the
        // one part of the row whose type is the driver's business, not the
        // contract's.
        sql<string>`requested_at::text`.as('requested_at'),
        sql<string>`expires_at::text`.as('expires_at'),
        'decided_by',
        'security_scope_ack',
      ])
      .where('id', '=', id)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    return rowToApproval(row);
  }
}

/**
 * The row shape the reader selects.
 *
 * The columns the reader reads, with the types the driver returns. This is
 * written out rather than derived from `Selectable<ApprovalsTable>` because
 * the reader selects a *subset* of the columns, and `Selectable` would
 * demand every one of them.
 */
interface ApprovalRow {
  readonly id: string;
  readonly task_id: string;
  readonly type: ApprovalsTable['type'];
  readonly artefact_kind: string;
  readonly artefact_ref: string;
  readonly artefact_sha256: Buffer;
  readonly approvers: string[];
  readonly status: ApprovalsTable['status'];
  readonly requested_at: string;
  readonly expires_at: string;
  readonly decided_by: string | null;
  readonly security_scope_ack: boolean;
}

/**
 * Turn a row into the `Approval` contract shape.
 *
 * The digest is stored as `bytea` and the contract carries it as
 * `sha256:<hex>`, so the conversion happens here — once — rather than in
 * every caller that needs to compare a digest.
 */
export const rowToApproval = (row: ApprovalRow): Approval => {
  const approval: Approval = {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    artefactKind: row.artefact_kind,
    artefactRef: row.artefact_ref,
    artefactSha256: `sha256:${Buffer.from(row.artefact_sha256).toString('hex')}`,
    approvers: [...row.approvers],
    status: row.status,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    securityScopeAck: row.security_scope_ack,
    ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
  };

  return approval;
};
