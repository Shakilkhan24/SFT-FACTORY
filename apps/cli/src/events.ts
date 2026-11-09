/**
 * `factory events` — inspect the event log.
 *
 * checklist 02 T-1.03 delivers the log; this makes it observable from the
 * command line, which is the cheapest way for a human to check that the
 * thing works.
 *
 * Three subcommands:
 *
 * * `list` — the most recent events, optionally filtered;
 * * `show` — one aggregate's full chain, with the chain verdict;
 * * `health` — the two monitoring signals (a `seq` gap, a non-contiguous
 *   aggregate version).
 *
 * The commands read through the **projector** role, not the owner role: the
 * projector may read the log and may not write it, and using it here means
 * the CLI exercises the same privilege boundary the running system does.
 */

import {
  PostgresEventLog,
  checkEventLogHealth,
  type EventLogHealth,
} from '@factory/eventlog';

import type { EventEnvelope } from '@factory/contracts';

import { createDatabase, destroyDatabase } from '@factory/db';

/**
 * The options for the `events` command group.
 */
export interface EventsOptions {
  /** The connection string for the role that reads the log. */
  readonly connectionString: string;

  /** How the role is assumed. */
  readonly mode?: 'direct' | 'assume';

  /** The role the session acts as. Defaults to `factory_projector`. */
  readonly role?: 'factory_app' | 'factory_projector' | 'factory_readonly';
}

/**
 * The result of one `events` subcommand.
 */
export interface EventsResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * Format one event as a single line.
 *
 * The line starts with the `seq` because that is the log's order — a reader
 * scanning the output is scanning the log's timeline.
 */
const formatEvent = (event: {
  seq: number;
  occurredAt: string;
  eventType: string;
  aggregate: { kind: string; id: string; version: number };
  correlationId: string;
  redaction: { applied: string[] };
}): string =>
  [
    String(event.seq).padStart(6, ' '),
    event.occurredAt,
    event.eventType.padEnd(28, ' '),
    `${event.aggregate.kind}:${event.aggregate.id}@${String(event.aggregate.version)}`,
    event.correlationId,
    event.redaction.applied.length > 0
      ? `redacted:${event.redaction.applied.join(',')}`
      : '',
  ]
    .filter((part) => part !== '')
    .join('  ');

/**
 * Format the health report.
 */
const formatHealth = (health: EventLogHealth): readonly string[] => {
  const lines: string[] = [];
  lines.push(health.ok ? 'event log: healthy' : 'event log: UNHEALTHY');

  if (health.seqGaps.length === 0) {
    lines.push('  seq gaps:            none');
  } else {
    lines.push(`  seq gaps:            ${health.seqGaps.join(', ')}`);
  }

  if (health.versionGaps.length === 0) {
    lines.push('  version gaps:        none');
  } else {
    for (const gap of health.versionGaps) {
      lines.push(
        `  version gap:         ${gap.aggregateKind}:${gap.aggregateId} is missing version ${String(
          gap.missingVersion,
        )}`,
      );
    }
  }

  return lines;
};

/**
 * Run an `events` subcommand.
 *
 * @param subcommand `list`, `show` or `health`
 * @param options the connection details
 * @param args the subcommand's own arguments
 */
export const runEventsCommand = async (
  subcommand: string,
  options: EventsOptions,
  args: readonly string[],
): Promise<EventsResult> => {
  const role = options.role ?? 'factory_projector';
  const db = createDatabase({
    connectionString: options.connectionString,
    role,
    mode: options.mode ?? 'direct',
    max: 4,
  });

  try {
    switch (subcommand) {
      case 'health': {
        const health = await checkEventLogHealth(db);
        return { lines: formatHealth(health), exitCode: health.ok ? 0 : 1 };
      }

      case 'list': {
        // `factory events list [count] [aggregateId]`
        const count = Number(args[0] ?? '20');
        if (!Number.isInteger(count) || count <= 0) {
          return {
            lines: [`\`${args[0] ?? ''}\` is not a positive integer count`],
            exitCode: 2,
          };
        }
        const aggregateId = args[1];

        const events: EventEnvelope[] = [];

        const log = new PostgresEventLog({ db });
        const query =
          aggregateId === undefined
            ? { limit: count }
            : { aggregate: { kind: 'task' as const, id: aggregateId }, limit: count };

        for await (const event of log.read(query)) {
          events.push(event);
        }

        if (events.length === 0) {
          return { lines: ['no events'], exitCode: 0 };
        }
        return { lines: events.map(formatEvent), exitCode: 0 };
      }

      case 'show': {
        // `factory events show <aggregateId>`
        const aggregateId = args[0];
        if (aggregateId === undefined) {
          return { lines: ['usage: factory events show <aggregateId>'], exitCode: 2 };
        }
        const log = new PostgresEventLog({ db });
        const lines: string[] = [];
        for await (const event of log.read({
          aggregate: { kind: 'task', id: aggregateId },
          limit: 1000,
        })) {
          lines.push(formatEvent(event));
        }
        if (lines.length === 0) {
          lines.push(`no events for task ${aggregateId}`);
        }
        const verdict = await log.verifyChain({ kind: 'task', id: aggregateId });
        lines.push(
          verdict.ok
            ? 'chain: intact'
            : `chain: BROKEN at seq ${String(verdict.brokenAtSeq ?? '?')}`,
        );
        return { lines, exitCode: verdict.ok ? 0 : 1 };
      }

      default:
        return {
          lines: [`unknown subcommand \`factory events ${subcommand}\``],
          exitCode: 2,
        };
    }
  } finally {
    await destroyDatabase(db);
  }
};
