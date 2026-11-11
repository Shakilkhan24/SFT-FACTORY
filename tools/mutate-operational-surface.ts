/**
 * The operational surface's mutation harness (T-1.16).
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not theoretical: in T-1.07 a mutation "survived" because the
 * mutation changed nothing; in T-1.11 one survived because the test
 * asserted a **constant against itself**; in T-1.12 four survived because
 * two different checks could produce the *same* refusal.
 *
 * So this harness applies a named mutation to the operational surface's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the
 * oracle does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The operational surface is the thing a human looks at when something
 * has gone wrong, so its load-bearing rules are the ones that decide
 * **what a human sees first**:
 *
 * 1. the **risk ordering** — `R4` first, an unknown tier **last**;
 * 2. the **urgency** — an unknown expiry is not urgent;
 * 3. the **quietest task first** — a task that has not been heard from
 *    is the one most likely to be wedged;
 * 4. the **per-change figure** — no accepted changes means **no figure**,
 *    not `$0.00`;
 * 5. the **stream's classes** — exactly the six the pack names;
 * 6. the **stream's framing** — `id:` is the `seq`, so a resume works;
 * 7. the **resume** — a malformed `Last-Event-ID` is no resume, not a
 *    fatal error;
 * 8. the **kill switch's reason** — a switch engaged without a reason
 *    cannot be released by whoever finds it;
 * 9. the **audit chain's exit code** — 0 intact, 1 tampered;
 * 10. the **timeline parse** — a field of the wrong type is **dropped**,
 *     not crashed on.
 *
 * ## The browser is not here
 *
 * The Playwright oracle proves the *browser* reaches an item in two
 * clicks. That is a separate claim, and it needs a browser — so it is
 * not part of this harness. What this harness breaks is the logic the
 * browser renders, which the **unit** suites cover.
 *
 * ## Running it
 *
 * ```bash
 * pnpm run test:mutation:operational-surface
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
  // ---- the risk ordering ----------------------------------------------
  {
    name: 'an unknown risk tier sorts first',
    file: 'apps/dashboard/src/regions.ts',
    search: `export const riskRank = (tier: string | undefined): number => {
  if (tier === undefined) {
    return -1;
  }`,
    replace: `export const riskRank = (tier: string | undefined): number => {
  if (tier === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'the risk order is ascending rather than descending',
    file: 'apps/dashboard/src/regions.ts',
    search: `    const byRisk = riskRank(right.riskTier) - riskRank(left.riskTier);`,
    replace: `    const byRisk = riskRank(left.riskTier) - riskRank(right.riskTier);`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'the risk tiers are ordered lowest-first',
    file: 'apps/dashboard/src/regions.ts',
    search: `export const RISK_TIERS: readonly string[] = ['R4', 'R3', 'R2', 'R1', 'R0'];`,
    replace: `export const RISK_TIERS: readonly string[] = ['R0', 'R1', 'R2', 'R3', 'R4'];`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },

  // ---- the urgency -----------------------------------------------------
  {
    name: 'an unknown expiry is treated as urgent',
    file: 'apps/dashboard/src/regions.ts',
    search: `export const timeUntil = (until: string | undefined, now: Date): number => {
  if (until === undefined) {
    return Number.POSITIVE_INFINITY;
  }`,
    replace: `export const timeUntil = (until: string | undefined, now: Date): number => {
  if (until === undefined) {
    return Number.NEGATIVE_INFINITY;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'an unknown expiry is zero rather than unknown',
    file: 'apps/dashboard/src/regions.ts',
    search: `  const parsed = Date.parse(until);
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return parsed - now.getTime();`,
    replace: `  const parsed = Date.parse(until);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed - now.getTime();`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'an unknown distance sorts first rather than last',
    file: 'apps/dashboard/src/regions.ts',
    search: `  if (leftUnknown) {
    return 1;
  }
  if (rightUnknown) {
    return -1;
  }`,
    replace: `  if (leftUnknown) {
    return -1;
  }
  if (rightUnknown) {
    return 1;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'two unknown distances are not equal',
    file: 'apps/dashboard/src/regions.ts',
    search: `  if (leftUnknown && rightUnknown) {
    return 0;
  }`,
    replace: `  if (leftUnknown && rightUnknown) {
    return 1;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },

  // ---- the quietest task first -----------------------------------------
  {
    name: 'the newest task comes first in the in-flight region',
    file: 'apps/dashboard/src/regions.ts',
    search: `    const byAge = compareUnknownsLast(
      timeSince(right.lastActivityAt, now),
      timeSince(left.lastActivityAt, now),
    );`,
    replace: `    const byAge = compareUnknownsLast(
      timeSince(left.lastActivityAt, now),
      timeSince(right.lastActivityAt, now),
    );`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'a task with no activity is not the oldest',
    file: 'apps/dashboard/src/regions.ts',
    search: `export const timeSince = (since: string | undefined, now: Date): number => {
  if (since === undefined) {
    return Number.POSITIVE_INFINITY;
  }`,
    replace: `export const timeSince = (since: string | undefined, now: Date): number => {
  if (since === undefined) {
    return 0;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },

  // ---- the health severity ---------------------------------------------
  {
    name: 'the health region is ordered best-first',
    file: 'apps/dashboard/src/regions.ts',
    search: `    const bySeverity = severityRank(right.severity) - severityRank(left.severity);`,
    replace: `    const bySeverity = severityRank(left.severity) - severityRank(right.severity);`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'an unknown severity is treated as failing',
    file: 'apps/dashboard/src/regions.ts',
    search: `export const severityRank = (severity: string | undefined): number => {
  if (severity === undefined) {
    return -1;
  }`,
    replace: `export const severityRank = (severity: string | undefined): number => {
  if (severity === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },

  // ---- the per-change figure -------------------------------------------
  {
    name: 'no accepted changes reports a zero figure',
    file: 'apps/dashboard/src/regions.ts',
    search: `  if (accepted <= 0) {
    return undefined;
  }`,
    replace: `  if (accepted <= 0) {
    return 0;
  }`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'the per-change figure divides by the row count rather than the accepted changes',
    file: 'apps/dashboard/src/regions.ts',
    search: `  return Math.round(totalUsdMicros(items) / accepted);`,
    replace: `  return Math.round(totalUsdMicros(items) / Math.max(1, items.length));`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'the accepted changes are not counted',
    file: 'apps/dashboard/src/regions.ts',
    search: `  const accepted = items.reduce(
    (total, item) => total + (item.acceptedChangeCount ?? 0),
    0,
  );`,
    replace: `  const accepted = items.length;`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },
  {
    name: 'the cost total is not summed',
    file: 'apps/dashboard/src/regions.ts',
    search: `  items.reduce((total, item) => total + (item.usdMicros ?? 0), 0);`,
    replace: `  items.length > 0 ? (items[0]?.usdMicros ?? 0) : 0;`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },

  // ---- the cost ordering -----------------------------------------------
  {
    name: 'the cost region is ordered cheapest-first',
    file: 'apps/dashboard/src/regions.ts',
    search: `    const byCost = (right.usdMicros ?? 0) - (left.usdMicros ?? 0);`,
    replace: `    const byCost = (left.usdMicros ?? 0) - (right.usdMicros ?? 0);`,
    test: 'tests/unit/dashboard-regions.test.ts',
  },

  // ---- the stream's classes --------------------------------------------
  {
    name: 'the stream subscribes to a seventh class',
    file: 'apps/dashboard/src/stream.ts',
    search: `  'killswitch.changed',
];`,
    replace: `  'killswitch.changed',
  'task.exploded',
];`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the stream drops a class the pack names',
    file: 'apps/dashboard/src/stream.ts',
    search: `  'cost.updated',
  'killswitch.changed',
];`,
    replace: `  'cost.updated',
];`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the stream opens on the wrong path',
    file: 'apps/dashboard/src/stream.ts',
    search: `  const source = create(\`\${base}/stream\`);`,
    replace: `  const source = create(\`\${base}/events\`);`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the stream does not close its source',
    file: 'apps/dashboard/src/stream.ts',
    search: `    close: () => {
      source.close();
    },`,
    replace: `    close: () => {
      // MUTATION: the source is not closed.
    },`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the stream ignores the events it subscribed to',
    file: 'apps/dashboard/src/stream.ts',
    search: `    source.addEventListener(eventType, () => {
      onChange(eventType);
    });`,
    replace: `    source.addEventListener(eventType, () => {
      // MUTATION: the callback is never made.
    });`,
    test: 'tests/unit/dashboard-react.test.ts',
  },

  // ---- the timeline parse ----------------------------------------------
  {
    name: 'the timeline parse drops an actor with no kind',
    file: 'apps/dashboard/src/timeline-events.ts',
    search: `    const id = str(record['id']);
    const kind = str(record['kind']);
    if (id === undefined) {
      return undefined;
    }
    return kind === undefined ? id : \`\${kind}:\${id}\`;`,
    replace: `    const id = str(record['id']);
    const kind = str(record['kind']);
    if (id === undefined) {
      return undefined;
    }
    return id;`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the timeline parse keeps a field of the wrong type',
    file: 'apps/dashboard/src/timeline-events.ts',
    search: `      ...(num(item['seq']) === undefined ? {} : { seq: num(item['seq']) as number }),`,
    replace: `      ...(num(item['seq']) === undefined
        ? { seq: String(item['seq']) as unknown as number }
        : { seq: num(item['seq']) as number }),`,
    test: 'tests/unit/dashboard-react.test.ts',
  },

  // ---- the API's stream -------------------------------------------------
  {
    name: 'the stream frame does not carry the seq as its id',
    file: 'apps/api/src/handlers/stream.ts',
    search: `  return \`id: \${String(event.seq)}\\nevent: \${event.class}\\ndata: \${data}\\n\\n\`;`,
    replace: `  return \`event: \${event.class}\\ndata: \${data}\\n\\n\`;`,
    test: 'tests/unit/api-stream.test.ts',
  },
  {
    name: 'the stream frame does not carry the event name',
    file: 'apps/api/src/handlers/stream.ts',
    search: `  return \`id: \${String(event.seq)}\\nevent: \${event.class}\\ndata: \${data}\\n\\n\`;`,
    replace: `  return \`id: \${String(event.seq)}\\ndata: \${data}\\n\\n\`;`,
    test: 'tests/unit/api-stream.test.ts',
  },
  {
    name: 'a malformed Last-Event-ID is a fatal error rather than no resume',
    file: 'apps/api/src/handlers/stream.ts',
    search: `  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;`,
    replace: `  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;`,
    test: 'tests/unit/api-stream.test.ts',
  },
  {
    name: 'the query parameter does not resume the stream',
    file: 'apps/api/src/handlers/stream.ts',
    search: `  const raw = headerValue ?? (typeof queryValue === 'string' ? queryValue : undefined);`,
    replace: `  const raw = headerValue;`,
    test: 'tests/unit/api-stream.test.ts',
  },
  {
    name: 'the stream carries a class nobody asked for',
    file: 'apps/api/src/handlers/stream.ts',
    search: `  if (requested === undefined || requested.length === 0) {
    return STREAM_CLASSES;`,
    replace: `  if (requested === undefined || requested.length === 0) {
    return [...STREAM_CLASSES, 'task.exploded'];`,
    test: 'tests/unit/api-stream.test.ts',
  },

  // ---- the kill switch's reason -----------------------------------------
  {
    name: 'the CLI engages the switch without a reason',
    file: 'apps/cli/src/kill-switch.ts',
    search: `  if (reason === undefined || reason.trim() === '') {`,
    replace: `  if (false) {`,
    test: 'tests/unit/cli-kill-switch.test.ts',
  },
  {
    name: 'the dashboard engages the switch without a reason',
    file: 'apps/dashboard/src/kill-switch.ts',
    search: `  if (answer.trim() === '') {
    return { kind: 'refused', message: 'the kill switch needs a reason' };
  }`,
    replace: `  // MUTATION: a blank reason is accepted.`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the dashboard engages the switch when it is not wired',
    file: 'apps/dashboard/src/kill-switch.ts',
    search: `  if (!wired) {
    return { kind: 'refused', message: 'the kill switch is not wired' };
  }`,
    replace: `  // MUTATION: an unwired switch is not refused.`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the dashboard says something when the prompt is dismissed',
    file: 'apps/dashboard/src/kill-switch.ts',
    search: `  if (answer === null) {
    // The human dismissed the prompt. Nothing is said, because nothing
    // went wrong — a person changing their mind is not an error.
    return { kind: 'cancelled' };
  }`,
    replace: `  if (answer === null) {
    return { kind: 'refused', message: 'the kill switch needs a reason' };
  }`,
    test: 'tests/unit/dashboard-react.test.ts',
  },
  {
    name: 'the dashboard flips the switch the wrong way',
    file: 'apps/dashboard/src/kill-switch.ts',
    search: `  return { kind: 'proceed', engage: !engaged, reason: answer };`,
    replace: `  return { kind: 'proceed', engage: engaged, reason: answer };`,
    test: 'tests/unit/dashboard-react.test.ts',
  },

  // ---- the audit chain's exit code --------------------------------------
  {
    name: 'a tampered chain exits zero',
    file: 'apps/cli/src/audit.ts',
    search: `    exitCode: verdict.ok ? 0 : 1,`,
    replace: `    exitCode: 0,`,
    test: 'tests/unit/cli-audit-chain.test.ts',
  },
  {
    name: 'an intact chain exits non-zero',
    file: 'apps/cli/src/audit.ts',
    search: `    exitCode: verdict.ok ? 0 : 1,`,
    replace: `    exitCode: verdict.ok ? 1 : 0,`,
    test: 'tests/unit/cli-audit-chain.test.ts',
  },
  {
    name: 'the broken sequence is not named',
    file: 'apps/cli/src/audit.ts',
    search: `      : \`chain: BROKEN at seq \${String(verdict.brokenAtSeq ?? '?')}\`,`,
    replace: `      : 'chain: BROKEN',`,
    test: 'tests/unit/cli-audit-chain.test.ts',
  },

  // ---- the CLI's token store --------------------------------------------
  {
    name: 'the CLI leaves the token file readable by others',
    file: 'apps/cli/src/credentials.ts',
    search: `  await writeFile(temporary, \`\${JSON.stringify(credentials, null, 2)}\\n\`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);`,
    replace: `  await writeFile(temporary, \`\${JSON.stringify(credentials, null, 2)}\\n\`, {
    mode: 0o644,
  });
  await chmod(temporary, 0o644).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o644).catch(() => undefined);`,
    test: 'tests/unit/cli-login.test.ts',
  },
  {
    name: 'the CLI leaves the credentials directory readable by others',
    file: 'apps/cli/src/credentials.ts',
    search: `  await chmod(directory, 0o700).catch(() => undefined);`,
    replace: `  await chmod(directory, 0o755).catch(() => undefined);`,
    test: 'tests/unit/cli-login.test.ts',
  },
  {
    name: 'the CLI presents no bearer token',
    file: 'apps/cli/src/client.ts',
    search: `    if (token !== undefined) {
      headers['authorization'] = \`Bearer \${token}\`;
    }`,
    replace: `    // MUTATION: no bearer token is presented.`,
    test: 'tests/unit/cli-tasks.test.ts',
  },
  {
    name: 'the CLI sends no idempotency key',
    file: 'apps/cli/src/client.ts',
    search: `      headers[IDEMPOTENCY_HEADER] = nextKey();`,
    replace: `      // MUTATION: no idempotency key is sent.`,
    test: 'tests/unit/cli-kill-switch.test.ts',
  },
];

/**
 * Run a test file and report whether it **failed**.
 *
 * Vitest exits 1 when the suite fails — that is the mutation being
 * caught. Any other exit code is a harness error and is re-thrown.
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
