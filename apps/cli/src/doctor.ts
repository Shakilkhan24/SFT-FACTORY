/**
 * `factory doctor` — the local health check (checklist 03, CL-G1-14).
 *
 * > **CL-G1-14** | `factory doctor` passes locally | output attached | agent
 *
 * ## What a doctor is for
 *
 * The pack's operational commands (`db migrate`, `events health`,
 * `projections rebuild`, `audit chain`) each check **one** thing, and each
 * needs its own arguments. An operator who has just cloned the repo, or
 * just changed a connection string, does not know which of them to run, in
 * what order, or what a healthy result looks like.
 *
 * So `factory doctor` runs **all** of them and reports the whole picture
 * in one pass. It is the command an operator runs **first**, and its
 * output is what gets attached to a gate row.
 *
 * ## The checks, and why each is one
 *
 * | check | what it proves |
 * |---|---|
 * | `database` | the database is **reachable** and the schema is there |
 * | `migrations` | every migration file has been applied, and none has been orphaned |
 * | `event-log` | the log has no `seq` gap and no aggregate-version gap |
 * | `hash-chain` | every aggregate's hash chain verifies — the log is not tampered with |
 * | `projections` | a rebuild would reproduce the rows that are there |
 * | `schemas` | `/schemas` matches the contracts (the export is in sync) |
 *
 * Each check is a **named** thing that can be ok or not. That matters: a
 * doctor that printed one line saying "not healthy" would leave the
 * operator with nothing to act on, and would make several different
 * failures indistinguishable. So every failure names **which** check
 * failed and **why**.
 *
 * ## The exit code
 *
 * **0** when every check passed. **1** when at least one failed. The
 * exit code is the machine-readable answer; the lines are the human one.
 *
 * ## The checks are injected
 *
 * Every check is a function the caller supplies. That is not decoration:
 * the doctor must be testable **without a database**, and a doctor whose
 * checks were hard-wired to a live connection could only be proved by
 * standing one up. So `runDoctor` takes the checks, and the production
 * wiring lives in `index.ts`.
 */

import type { CliResult } from './index.js';

/**
 * The outcome of one check.
 */
export type CheckOutcome =
  | {
      readonly ok: true;
      /** The line to print when the check passed. */
      readonly detail: string;
    }
  | {
      readonly ok: false;
      /**
       * Why the check failed, in one sentence.
       *
       * The reason is what makes the failure **actionable**: "the
       * database is unreachable" and "the event log has a seq gap" are
       * different problems with different fixes, and a doctor that
       * reported only "not healthy" would hide that difference.
       */
      readonly reason: string;
    };

/**
 * One check.
 */
export interface DoctorCheck {
  /** The check's name — what the report calls it. */
  readonly name: string;
  /** Run the check. */
  readonly run: () => Promise<CheckOutcome>;
}

/**
 * The options for the doctor.
 */
export interface DoctorOptions {
  /** The checks to run, in the order they should be reported. */
  readonly checks: readonly DoctorCheck[];
}

/**
 * Run the doctor.
 *
 * Every check runs, **even after one fails**. A doctor that stopped at the
 * first failure would report one problem and hide the next — and an
 * operator fixing a broken environment wants the whole list, not a
 * one-at-a-time drip.
 *
 * The exit code is **1** when any check failed.
 */
export const runDoctor = async (options: DoctorOptions): Promise<CliResult> => {
  const lines: string[] = ['factory doctor', ''];
  let failures = 0;

  for (const check of options.checks) {
    let outcome: CheckOutcome;
    try {
      outcome = await check.run();
    } catch (error) {
      // A check that **throws** is a failed check, not a crashed doctor.
      // The message is carried through, because "the database is
      // unreachable" is more useful than "the check threw".
      outcome = {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.ok) {
      lines.push(`  ok    ${check.name.padEnd(14)} ${outcome.detail}`);
      continue;
    }

    failures += 1;
    lines.push(`  FAIL  ${check.name.padEnd(14)} ${outcome.reason}`);
  }

  lines.push('');
  if (failures === 0) {
    lines.push(`${String(options.checks.length)} check(s) passed.`);
    return { lines, exitCode: 0 };
  }

  lines.push(
    `${String(failures)} of ${String(options.checks.length)} check(s) FAILED.`,
  );
  return { lines, exitCode: 1 };
};
