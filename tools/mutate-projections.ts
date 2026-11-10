/**
 * The projections package's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless. In T-1.11 a mutation survived because the test asserted a
 * **constant against itself**. In T-1.12 four mutations survived, three of
 * them because two different checks could produce the *same* refusal, so a
 * test asserting either one passed even when the check it meant was gone.
 *
 * So this harness applies a named mutation to the projections package's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the oracle
 * does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The projections hold the factory's **view of the world**. blueprint `15`
 * §3: "The event log is the source of truth. The projections are
 * disposable." A0.6: "every projection can be dropped and rebuilt
 * identically". So the load-bearing rules are:
 *
 * 1. the **fold** — a reducer must not accumulate over the fold, or a
 *    replay doubles the figure;
 * 2. the **idempotence** — the cost bucket's contributions are keyed by
 *    the *event's id*, so a replayed event overwrites its own entry;
 * 3. the **cursor** — the cursor advances past every event *read*, and the
 *    rows and the cursor commit together;
 * 4. the **removal** — an answered approval leaves the queue;
 * 5. the **digest** — the digest is a function of the rows' content and
 *    nothing else;
 * 6. the **staleness** — an unknown signal gets no default threshold, an
 *    unparseable timestamp is stale, a terminal task is not wedged.
 *
 * ## How a mutation is declared
 *
 * A mutation is a **file**, a **search string**, and a **replacement**. The
 * harness:
 *
 * 1. reads the file;
 * 2. asserts the search string is present **exactly once** — a mutation that
 *    matches zero times or many times is *vacuous*, and it is reported as
 *    such rather than as a survivor;
 * 3. writes the mutated file in place, runs the tests, and restores the
 *    original in a `finally`, so a failing run still restores the file.
 *
 * ## Running it
 *
 * ```bash
 * pnpm run test:mutation:projections
 * ```
 *
 * The exit code is non-zero when a mutation survives or is vacuous.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..');

/**
 * A mutation.
 */
interface Mutation {
  /** The rule it breaks. */
  readonly name: string;
  /** The file it mutates, relative to the repo root. */
  readonly file: string;
  /** The text it replaces — must appear exactly once. */
  readonly search: string;
  /** The text it puts in its place. */
  readonly replace: string;
  /** The test file that must fail. */
  readonly test: string;
}

/**
 * The mutations.
 *
 * Each one breaks exactly **one** rule, and names the test file that is
 * supposed to catch it.
 */
const MUTATIONS: readonly Mutation[] = [
  // ---- the task_current fold ------------------------------------------
  {
    name: 'the transition sets the state it came from',
    file: 'packages/projections/src/reducers/task-current.ts',
    search: `    const to = (event.payload as Partial<TransitionPayload>).to;
    if (typeof to === 'string' && isTaskState(to)) {
      state = to;
    }`,
    replace: `    const to = (event.payload as Partial<TransitionPayload>).to;
    if (typeof to === 'string' && isTaskState(to)) {
      state = next.state;
    }`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'a state the contracts do not have is written into the row',
    file: 'packages/projections/src/reducers/task-current.ts',
    search: `    if (typeof to === 'string' && isTaskState(to)) {
      state = to;
    }`,
    replace: `    if (typeof to === 'string') {
      state = to as TaskState;
    }`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'the spent total is accumulated rather than copied',
    file: 'packages/projections/src/reducers/task-current.ts',
    search: `  const spentUsdMicros =
    typeof payload.spentUsdMicros === 'number'
      ? payload.spentUsdMicros
      : next.spentUsdMicros;`,
    replace: `  const spentUsdMicros =
    typeof payload.spentUsdMicros === 'number'
      ? next.spentUsdMicros + payload.spentUsdMicros
      : next.spentUsdMicros;`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'the activity timestamp is the wall clock rather than the log’s clock',
    file: 'packages/projections/src/reducers/task-current.ts',
    search: `    lastActivityAt: event.occurredAt,`,
    replace: `    lastActivityAt: new Date().toISOString(),`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'an answered approval no longer clears the human’s turn',
    file: 'packages/projections/src/reducers/task-current.ts',
    search: `  } else if (HUMAN_TURN_OVER.includes(event.eventType)) {
    needsHuman = false;
  }`,
    replace: `  } else if (false) {
    needsHuman = false;
  }`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'the node aggregate’s task id is no longer split off',
    file: 'packages/projections/src/reducers/task-current.ts',
    search: `    const separator = event.aggregate.id.indexOf('/');
    return separator > 0 ? event.aggregate.id.slice(0, separator) : '';`,
    replace: `    return event.aggregate.id;`,
    test: 'tests/unit/projections-reducers.test.ts',
  },

  // ---- the cost bucket’s idempotence ---------------------------------
  {
    name: 'the contribution is keyed by the sequence rather than the event’s id',
    file: 'packages/projections/src/reducers/cost-attribution.ts',
    search: `  return { ...contributions, [event.eventId]: contribution };`,
    replace: `  return { ...contributions, [String(event.seq)]: contribution };`,
    test: 'tests/unit/projections-a0-6.test.ts',
  },
  {
    name: 'the contribution is keyed by the event’s type rather than its id',
    file: 'packages/projections/src/reducers/cost-attribution.ts',
    search: `  return { ...contributions, [event.eventId]: contribution };`,
    replace: `  return { ...contributions, [event.eventType]: contribution };`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'the accepted-change count is not counted',
    file: 'packages/projections/src/reducers/cost-attribution.ts',
    search: `    if (contribution.acceptedChange) {
      acceptedChangeCount += 1;
    }`,
    replace: `    // MUTATION: the accepted changes are not counted.`,
    test: 'tests/unit/projections-a0-6.test.ts',
  },
  {
    name: 'the cost bucket’s day is the wall clock rather than the log’s clock',
    file: 'packages/projections/src/reducers/cost-attribution.ts',
    search: `export const dayOf = (occurredAt: string): string => {
  const parsed = Date.parse(occurredAt);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  return new Date(parsed).toISOString().slice(0, 10);
};`,
    replace: `export const dayOf = (occurredAt: string): string => {
  void occurredAt;
  return new Date().toISOString().slice(0, 10);
};`,
    test: 'tests/unit/projections-reducers.test.ts',
  },

  // ---- the approval queue --------------------------------------------
  {
    name: 'the answered approvals are never removed from the queue',
    file: 'packages/projections/src/reducers/index.ts',
    search: `    if (
      event.eventType !== 'approval.requested' &&
      event.eventType !== 'approval.granted' &&
      event.eventType !== 'approval.expired' &&
      event.eventType !== 'approval.revoked'
    ) {
      return undefined;
    }`,
    replace: `    if (event.eventType !== 'approval.requested') {
      return undefined;
    }`,
    test: 'tests/unit/projections-projector.test.ts',
  },
  {
    name: 'the urgency is classified from the wall clock rather than the expiry',
    file: 'packages/projections/src/reducers/approval-queue.ts',
    search: `  if (windowMs <= 15 * 60 * 1000) {
    return 'critical';
  }`,
    replace: `  if (windowMs <= 15 * 60 * 1000) {
    return 'high';
  }`,
    test: 'tests/unit/projections-reducers.test.ts',
  },
  {
    name: 'an unparseable expiry is classified as urgent rather than unknown',
    file: 'packages/projections/src/reducers/approval-queue.ts',
    search: `  if (!Number.isFinite(requested) || !Number.isFinite(expires)) {
    return 'unknown';
  }`,
    replace: `  if (!Number.isFinite(requested) || !Number.isFinite(expires)) {
    return 'critical';
  }`,
    test: 'tests/unit/projections-reducers.test.ts',
  },

  // ---- the projector’s cursor ----------------------------------------
  {
    name: 'the cursor stops at the last applied event rather than the last read',
    file: 'packages/projections/src/projector.ts',
    search: `      lastApplied = event.seq;`,
    replace: `      // MUTATION: the cursor only advances for applied events.`,
    test: 'tests/unit/projections-projector.test.ts',
  },
  {
    name: 'the rows and the cursor no longer commit together',
    file: 'packages/projections/src/projector.ts',
    search: `    await this.deps.store.commit({
      name: PROJECTOR_CURSOR,
      upserts: allUpserts,
      removals: allRemovals,
      states,
      lastSeq: lastApplied,
    });`,
    replace: `    await this.deps.store.commit({
      name: PROJECTOR_CURSOR,
      upserts: allUpserts,
      removals: allRemovals,
      states,
      lastSeq: lastSeq,
    });`,
    test: 'tests/unit/projections-projector.test.ts',
  },
  {
    name: 'the carried state is not carried onto the next event',
    file: 'packages/projections/src/projector.ts',
    search: `        const base = carried === undefined ? rows[key] : carried;`,
    replace: `        const base = rows[key];`,
    test: 'tests/unit/projections-projector.test.ts',
  },

  // ---- the rebuild ----------------------------------------------------
  {
    name: 'the rebuild does not reset the cursor before the replay',
    file: 'packages/projections/src/rebuild.ts',
    search: `    await deps.cursors.reset(PROJECTOR_CURSOR);`,
    replace: `    // MUTATION: the cursor is not reset, so the replay starts in the middle.`,
    test: 'tests/unit/projections-rebuild.test.ts',
  },
  {
    name: 'the safe rebuild writes into the live rows',
    file: 'packages/projections/src/rebuild.ts',
    search: `  const target = options.drop ? deps.store : new ScratchStore(isolatedCursors);`,
    replace: `  const target = deps.store;`,
    test: 'tests/unit/projections-rebuild.test.ts',
  },
  {
    name: 'the rebuild’s comparison does not name the differing field',
    file: 'packages/projections/src/rebuild.ts',
    search: `    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      fields.push({ field: name, before: beforeValue, after: afterValue });
    }`,
    replace: `    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      // MUTATION: the differing field is not named.
      fields.push({ field: '<row>', before: beforeValue, after: afterValue });
    }`,
    test: 'tests/unit/projections-rebuild.test.ts',
  },
  {
    name: 'the rebuild reports a row as unchanged when it is missing',
    file: 'packages/projections/src/rebuild.ts',
    search: `      const difference = compareRows(name, key, beforeRows[key], afterRows[key]);
      if (difference !== undefined) {
        differences.push(difference);
      }`,
    replace: `      const difference = compareRows(name, key, beforeRows[key], afterRows[key]);
      if (difference !== undefined && difference.fields.length > 1) {
        differences.push(difference);
      }`,
    test: 'tests/unit/projections-rebuild.test.ts',
  },

  // ---- the digest -----------------------------------------------------
  {
    name: 'the digest depends on the order the rows came in',
    file: 'packages/projections/src/hash.ts',
    search: `  const sorted = Object.keys(rows)
    .sort()
    .map((key) => [key, rows[key]] as const);`,
    replace: `  const sorted = Object.keys(rows)
    .map((key) => [key, rows[key]] as const);`,
    test: 'tests/unit/projections-hash.test.ts',
  },

  // ---- the command ----------------------------------------------------
  {
    name: 'the rebuild runs without the --yes confirmation',
    file: 'apps/cli/src/projections.ts',
    search: `        const confirmed = args.includes('--yes');
        if (drop && !confirmed) {`,
    replace: `        const confirmed = args.includes('--yes');
        if (false) {`,
    test: 'tests/unit/projections-cli.test.ts',
  },
  {
    name: 'the command accepts any subcommand',
    file: 'apps/cli/src/index.ts',
    search: `    if (!PROJECTIONS_SUBCOMMANDS.includes(subcommand)) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/projections-cli.test.ts',
  },
  {
    name: 'the command does not require a database',
    file: 'apps/cli/src/index.ts',
    search: `    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_PROJECTOR_DATABASE_URL is not set.',
          'The projections commands run as the factory_projector role.',
        ],
        exitCode: 2,
      };
    }`,
    replace: `    if (false) {
      return {
        lines: [
          'FACTORY_PROJECTOR_DATABASE_URL is not set.',
          'The projections commands run as the factory_projector role.',
        ],
        exitCode: 2,
      };
    }`,
    test: 'tests/unit/projections-cli.test.ts',
  },

  // ---- the staleness --------------------------------------------------
  {
    name: 'an unknown signal gets a default threshold',
    file: 'packages/projections/src/staleness.ts',
    search: `  const threshold = thresholdFor(signal);

  if (threshold === undefined) {`,
    replace: `  const threshold = thresholdFor(signal) ?? {
    signal,
    maxAgeMs: 60_000,
    onBreach: 'alert' as const,
  };

  if (threshold === undefined) {`,
    test: 'tests/unit/projections-staleness.test.ts',
  },
  {
    name: 'an empty projection is called stale',
    file: 'packages/projections/src/staleness.ts',
    search: `  if (lastActivityAt === undefined) {`,
    replace: `  if (lastActivityAt === undefined) {
    // MUTATION: an empty projection is stale.
    return {
      signal,
      ageMs: 0,
      maxAgeMs: threshold.maxAgeMs,
      stale: true,
      onBreach: threshold.onBreach,
      known: true,
    };
  }

  if (lastActivityAt === undefined) {`,
    test: 'tests/unit/projections-staleness.test.ts',
  },
  {
    name: 'an unparseable timestamp is reported as fresh',
    file: 'packages/projections/src/staleness.ts',
    search: `      ageMs: Number.POSITIVE_INFINITY,
      maxAgeMs: threshold.maxAgeMs,
      stale: true,`,
    replace: `      ageMs: 0,
      maxAgeMs: threshold.maxAgeMs,
      stale: false,`,
    test: 'tests/unit/projections-staleness.test.ts',
  },
  {
    name: 'the age is allowed to go negative',
    file: 'packages/projections/src/staleness.ts',
    search: `  const ageMs = Math.max(0, now.getTime() - activity);`,
    replace: `  const ageMs = now.getTime() - activity;`,
    test: 'tests/unit/projections-staleness.test.ts',
  },
  {
    name: 'a terminal task is called wedged',
    file: 'packages/projections/src/staleness.ts',
    search: `  if (TERMINAL_STATES.includes(state)) {
    return false;
  }`,
    replace: `  if (false) {
    return false;
  }`,
    test: 'tests/unit/projections-staleness.test.ts',
  },
];

/**
 * Run a test file and report whether it **failed**.
 *
 * Vitest exits 1 when the suite fails — that is the mutation being caught.
 * Any other exit code is a harness error and is re-thrown.
 */
const testsFailed = async (file: string): Promise<boolean> => {
  try {
    await execFileAsync(
      'pnpm',
      ['exec', 'vitest', 'run', file, '--reporter=dot'],
      { cwd: repoRoot, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
    );
    return false;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1) {
      return true;
    }
    throw error;
  }
};

/**
 * Run every mutation.
 */
const main = async (): Promise<void> => {
  let survived = 0;
  let vacuous = 0;
  let caught = 0;

  for (const mutation of MUTATIONS) {
    const path = join(repoRoot, mutation.file);
    const original = await readFile(path, 'utf8');

    const occurrences = original.split(mutation.search).length - 1;
    if (occurrences !== 1) {
      process.stdout.write(
        `VACUOUS  ${mutation.name} — the search text appears ${String(occurrences)} times in ${mutation.file}\n`,
      );
      vacuous += 1;
      continue;
    }

    await writeFile(path, original.replace(mutation.search, mutation.replace), 'utf8');

    let wasCaught = false;
    try {
      wasCaught = await testsFailed(mutation.test);
    } finally {
      await writeFile(path, original, 'utf8');
    }

    if (wasCaught) {
      caught += 1;
      process.stdout.write(`CAUGHT   ${mutation.name}\n`);
    } else {
      survived += 1;
      process.stdout.write(
        `SURVIVED ${mutation.name} — ${mutation.test} did not fail\n`,
      );
    }
  }

  process.stdout.write(
    `\n${String(caught)} caught, ${String(survived)} survived, ${String(vacuous)} vacuous\n`,
  );

  if (survived > 0 || vacuous > 0) {
    process.exitCode = 1;
  }
};

await main();
