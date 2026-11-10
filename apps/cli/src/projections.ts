/**
 * `factory projections` — inspect and rebuild the projections.
 *
 * checklist 03 T-1.15: "Every projection can be dropped and rebuilt from
 * the log (A0.6) — rebuild is a CLI command **and** a test."
 *
 * So this is the **command** half of A0.6. The test half lives in
 * `tests/unit/projections-a0-6.test.ts` and calls the same
 * `rebuild()` function this command calls — the two cannot disagree,
 * because there is only one implementation.
 *
 * ## Three subcommands
 *
 * * `status` — where the projector is: the cursor's position, the number of
 *   rows per projection, and the staleness verdict of the freshest row;
 * * `rebuild` — drop every projection, replay the whole log, and report
 *   whether the rebuilt rows are **identical** to the dropped ones;
 * * `check` — the **safe** rebuild: replay into a scratch store and compare,
 *   without changing anything.
 *
 * ## `check` before `rebuild`
 *
 * `check` is the form an operator wants: it answers "would a rebuild change
 * anything?" without changing anything. `rebuild` is the form that actually
 * drops the rows — and if the rebuild turns out to differ, the rows that are
 * there now are gone and the new ones are in their place. So `check` is the
 * default, and `rebuild` has to be asked for by name.
 *
 * ## The role
 *
 * The command reads the log and writes the projections, so it runs through
 * the **projector** role — the same role the running projector uses. It
 * never writes `events`; the projector role has no privilege to.
 */

import {
  PostgresCursorStore,
  PostgresEventSource,
  PostgresProjectionStore,
  Projector,
  PROJECTOR_CURSOR,
  measureStaleness,
  rebuild,
  rowsDigest,
  thresholdFor,
  type ProjectionName,
} from '@factory/projections';
import { PostgresEventLog } from '@factory/eventlog';

import { createDatabase, destroyDatabase } from '@factory/db';

/**
 * The options for the `projections` command group.
 */
export interface ProjectionsOptions {
  /** The connection string for the role that reads the log. */
  readonly connectionString: string;

  /** How the role is assumed. */
  readonly mode?: 'direct' | 'assume';

  /** The role the session acts as. Defaults to `factory_projector`. */
  readonly role?: 'factory_app' | 'factory_projector' | 'factory_readonly';

  /** How many events a batch reads. */
  readonly batchSize?: number;

  /**
   * How long a connection attempt may take, in milliseconds.
   *
   * A CLI is the case where this matters: an operator who mistyped a host
   * needs an error, not a hang. Defaults to five seconds — shorter than
   * the package's default, because the command is interactive.
   */
  readonly connectTimeoutMs?: number;
}

/**
 * The CLI's connection timeout.
 *
 * Five seconds. Long enough for a healthy cluster over a slow link,
 * short enough that a mistyped host is an error the operator reads.
 */
const CLI_CONNECT_TIMEOUT_MS = 5_000;

/**
 * The result of one `projections` subcommand.
 */
export interface ProjectionsResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * The projections the command reports on, in the order they are reported.
 */
const REPORTED: readonly ProjectionName[] = [
  'task_current',
  'approval_queue',
  'cost_attribution',
];

/**
 * The subcommands the `projections` command group accepts.
 *
 * The CLI checks the subcommand against this list **before** it looks for
 * a connection string, so a typo is reported as a typo rather than as a
 * missing database. And because the list lives here — beside the
 * `switch` that implements it — the two cannot drift.
 */
export const PROJECTIONS_SUBCOMMANDS: readonly string[] = [
  'status',
  'catch-up',
  'check',
  'rebuild',
];

/**
 * Format the report of a rebuild or a check.
 *
 * The report says **which** projection differs and **which** row — a
 * digest on its own would leave the operator with a hash and nothing to
 * act on.
 */
const formatReport = (
  report: Awaited<ReturnType<typeof rebuild>>,
  headline: string,
): readonly string[] => {
  const lines: string[] = [];
  lines.push(headline);
  lines.push(`  events replayed:     ${String(report.replayed)}`);
  lines.push(`  cursor after:        ${String(report.lastSeq)}`);

  for (const comparison of report.comparisons) {
    const status = comparison.differences.length === 0 ? 'identical' : 'DIFFERENT';
    lines.push(
      `  ${comparison.projection.padEnd(20, ' ')} ${String(comparison.rows).padStart(6, ' ')} rows  ${status}`,
    );
    lines.push(
      `    before ${comparison.beforeDigest}`,
      `    after  ${comparison.afterDigest}`,
    );
    for (const difference of comparison.differences) {
      lines.push(`    row ${difference.key}:`);
      for (const field of difference.fields) {
        lines.push(
          `      ${field.field}: ${JSON.stringify(field.before)} -> ${JSON.stringify(field.after)}`,
        );
      }
    }
  }

  return lines;
};

/**
 * Run a `projections` subcommand.
 *
 * @param subcommand `status`, `rebuild` or `check`
 * @param options the connection details
 * @param args the subcommand's own arguments
 */
export const runProjectionsCommand = async (
  subcommand: string,
  options: ProjectionsOptions,
  args: readonly string[],
): Promise<ProjectionsResult> => {
  const role = options.role ?? 'factory_projector';
  const db = createDatabase({
    connectionString: options.connectionString,
    role,
    mode: options.mode ?? 'direct',
    max: 4,
    connectTimeoutMs: options.connectTimeoutMs ?? CLI_CONNECT_TIMEOUT_MS,
  });

  const cursors = new PostgresCursorStore(db);
  const store = new PostgresProjectionStore({ db, cursors });
  const events = new PostgresEventSource(new PostgresEventLog({ db }));

  try {
    switch (subcommand) {
      case 'status': {
        const lastSeq = await cursors.lastSeq(PROJECTOR_CURSOR);
        const lines: string[] = [];
        lines.push(`cursor: ${PROJECTOR_CURSOR} at seq ${String(lastSeq)}`);

        for (const name of REPORTED) {
          const rows = await store.read(name);
          const count = Object.keys(rows).length;
          lines.push(
            `  ${name.padEnd(20, ' ')} ${String(count).padStart(6, ' ')} rows  digest ${rowsDigest(rows)}`,
          );

          // The staleness verdict needs a clock. The command reads the
          // wall clock here — a *report* is allowed to be about now, even
          // though a *row* is not.
          const freshest = freshestActivityAt(rows);
          if (freshest === undefined) {
            lines.push('    staleness:           no rows');
            continue;
          }
          const threshold = thresholdFor(name);
          if (threshold === undefined) {
            lines.push('    staleness:           unknown signal');
            continue;
          }
          const verdict = measureStaleness(name, freshest, new Date());
          lines.push(
            `    staleness:           ${verdict.stale ? 'STALE' : 'fresh'} (${String(
              Math.round(verdict.ageMs / 1000),
            )}s, threshold ${String(Math.round(threshold.maxAgeMs / 1000))}s)`,
          );
        }

        return { lines, exitCode: 0 };
      }

      case 'rebuild':
      case 'check': {
        const drop = subcommand === 'rebuild';

        // `factory projections rebuild --yes` — a rebuild drops the rows,
        // so it must be asked for explicitly. The flag is the ask.
        const confirmed = args.includes('--yes');
        if (drop && !confirmed) {
          return {
            lines: [
              'rebuild DROPS every projection and replays the log.',
              'run it again with --yes to confirm.',
              'run `factory projections check` to compare without changing anything.',
            ],
            exitCode: 2,
          };
        }

        const report = await rebuild(
          {
            events,
            store,
            cursors,
            ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
          },
          { drop },
        );

        const headline = report.identical
          ? drop
            ? 'rebuild: identical — the rebuilt rows match the dropped rows'
            : 'check: identical — a rebuild would change nothing'
          : drop
            ? 'rebuild: DIFFERENT — the rebuilt rows do not match the dropped rows'
            : 'check: DIFFERENT — a rebuild would change the rows';

        return {
          lines: formatReport(report, headline),
          exitCode: report.identical ? 0 : 1,
        };
      }

      case 'catch-up': {
        // `factory projections catch-up` — the projector runs one catch-up
        // and reports what it did. It is the same loop the worker runs.
        const projector = new Projector(
          { events, store, cursors },
          options.batchSize,
        );
        const passes = await projector.catchUp();
        const read = passes.reduce((total, pass) => total + pass.read, 0);
        const upserts = passes.reduce((total, pass) => total + pass.upserts, 0);
        const removals = passes.reduce((total, pass) => total + pass.removals, 0);
        const lastSeq = passes.length > 0 ? (passes[passes.length - 1]?.lastSeq ?? 0) : 0;
        return {
          lines: [
            'catch-up: done',
            `  passes:               ${String(passes.length)}`,
            `  events read:          ${String(read)}`,
            `  rows written:         ${String(upserts)}`,
            `  rows removed:         ${String(removals)}`,
            `  cursor after:         ${String(lastSeq)}`,
          ],
          exitCode: 0,
        };
      }

      default:
        return {
          lines: [`unknown subcommand \`factory projections ${subcommand}\``],
          exitCode: 2,
        };
    }
  } finally {
    await destroyDatabase(db);
  }
};

/**
 * The freshest `lastActivityAt` across a projection's rows.
 *
 * A projection with no rows has no freshest row — an empty projection is
 * not stale (no row has gone invisible), which is what `isWedged` says
 * too. So the two agree.
 */
const freshestActivityAt = (rows: Readonly<Record<string, unknown>>): string | undefined => {
  let freshest: string | undefined;
  for (const row of Object.values(rows)) {
    const record = row as { readonly lastActivityAt?: unknown };
    const value = record.lastActivityAt;
    if (typeof value !== 'string' || value === '') {
      continue;
    }
    if (freshest === undefined || value > freshest) {
      freshest = value;
    }
  }
  return freshest;
};
