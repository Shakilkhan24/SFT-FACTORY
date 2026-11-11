/**
 * `factory doctor` — the local health check (T-1.17, CL-G1-14).
 *
 * > **CL-G1-14** | `factory doctor` passes locally | output attached | agent
 *
 * ## What this suite proves
 *
 * The doctor's contract is small and load-bearing:
 *
 * 1. **Every check runs**, even after one fails — an operator fixing a
 *    broken environment wants the whole list, not a one-at-a-time drip.
 * 2. **Every failure names itself** — a doctor that printed "not healthy"
 *    would make several different problems indistinguishable and
 *    unobservable.
 * 3. **A check that throws is a failed check**, not a crashed doctor —
 *    the message is carried through, because "the database is
 *    unreachable" is more useful than "the check threw".
 * 4. **The exit code is the machine-readable answer** — 0 when everything
 *    passed, 1 when anything failed.
 *
 * ## Why the checks are injected
 *
 * The checks are functions the caller supplies, so this suite can prove
 * the *reporting* without a database. The checks that talk to a real
 * Postgres are proved by the **acceptance** suite
 * (`tests/acceptance/cli/T1_17_doctor.test.ts`), against a real server —
 * where a check that always passed would be caught.
 */

import { describe, expect, it } from 'vitest';

import { runDoctor, type CheckOutcome, type DoctorCheck } from '../../apps/cli/src/doctor.ts';

/**
 * A check that passes.
 */
const passing = (name: string, detail = 'everything is fine'): DoctorCheck => ({
  name,
  run: () => Promise.resolve({ ok: true, detail } satisfies CheckOutcome),
});

/**
 * A check that fails with a reason.
 */
const failing = (name: string, reason: string): DoctorCheck => ({
  name,
  run: () => Promise.resolve({ ok: false, reason } satisfies CheckOutcome),
});

/**
 * A check that throws.
 */
const throwing = (name: string, message: string): DoctorCheck => ({
  name,
  run: () => Promise.reject(new Error(message)),
});

describe('factory doctor', () => {
  it('exits 0 and reports every check when they all pass', async () => {
    const result = await runDoctor({
      checks: [passing('database'), passing('migrations', '2 applied')],
    });

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('ok    database');
    expect(result.lines.join('\n')).toContain('ok    migrations');
    expect(result.lines.join('\n')).toContain('2 check(s) passed.');
  });

  it('exits 1 when a check fails', async () => {
    const result = await runDoctor({
      checks: [passing('database'), failing('migrations', '1 migration is not applied')],
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('FAIL  migrations');
  });

  it('names the reason a check failed', async () => {
    const result = await runDoctor({
      checks: [failing('migrations', '0002_projections.sql is not applied — run `factory db migrate`')],
    });

    const text = result.lines.join('\n');
    expect(text).toContain('0002_projections.sql is not applied');
    // The reason names the **fix**, not just the symptom.
    expect(text).toContain('factory db migrate');
  });

  it('runs every check even after one fails', async () => {
    // The order of the calls is what proves this: the third check is
    // reached even though the first failed.
    const order: string[] = [];
    const record = (name: string, outcome: CheckOutcome): DoctorCheck => ({
      name,
      run: () => {
        order.push(name);
        return Promise.resolve(outcome);
      },
    });

    const result = await runDoctor({
      checks: [
        record('first', { ok: false, reason: 'it failed' }),
        record('second', { ok: true, detail: 'fine' }),
        record('third', { ok: true, detail: 'fine' }),
      ],
    });

    expect(order).toEqual(['first', 'second', 'third']);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('1 of 3 check(s) FAILED.');
  });

  it('treats a check that throws as a failed check, not a crashed doctor', async () => {
    const result = await runDoctor({
      checks: [throwing('database', 'the database is unreachable'), passing('migrations')],
    });

    // The doctor did not crash — it reported the failure and carried on.
    expect(result.exitCode).toBe(1);
    const text = result.lines.join('\n');
    expect(text).toContain('FAIL  database');
    expect(text).toContain('the database is unreachable');
    // And the other check still ran.
    expect(text).toContain('ok    migrations');
  });

  it('reports every failure, so one problem does not hide another', async () => {
    const result = await runDoctor({
      checks: [
        failing('database', 'the schema is not there'),
        failing('event-log', 'the log has a seq gap at 41'),
        failing('hash-chain', 'task:tsk_1 breaks at seq 12'),
      ],
    });

    const text = result.lines.join('\n');
    expect(text).toContain('the schema is not there');
    expect(text).toContain('the log has a seq gap at 41');
    expect(text).toContain('task:tsk_1 breaks at seq 12');
    expect(result.exitCode).toBe(1);
    expect(text).toContain('3 of 3 check(s) FAILED.');
  });

  it('distinguishes two failures that would otherwise look the same', async () => {
    // The reason a doctor names its failures: "the database is
    // unreachable" and "the schema is missing" are different problems,
    // and a doctor that reported only "not healthy" would hide the
    // difference.
    const unreachable = await runDoctor({
      checks: [failing('database', 'the database is unreachable')],
    });
    const missing = await runDoctor({
      checks: [failing('database', 'the factory schema is missing')],
    });

    expect(unreachable.lines.join('\n')).not.toBe(missing.lines.join('\n'));
  });
});
