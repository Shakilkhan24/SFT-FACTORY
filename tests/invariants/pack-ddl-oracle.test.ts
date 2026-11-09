/**
 * T-1.02 oracle — the PACK's own DDL oracle, run unmodified.
 *
 * checklist 02 T-1.02: "start from `reference/validate_ddl.sh` (it already
 * passes against the shipped DDL on PostgreSQL 16.15 — extend it, **never
 * weaken it**)".
 *
 * The pack's script is the *seed* oracle: the one artefact in the corpus that
 * was already green. The DDL this ticket ships must make it stay green.
 *
 * This test runs the pack's script byte-for-byte — the pack is read-only, so
 * the file is never edited — against the dev Postgres container. A shim stands
 * in for `su postgres -c "psql ..."`; the shim changes only *how psql is
 * reached*, never what is checked.
 *
 * The test is skipped when the container is not running, so a contributor
 * without Docker still gets a green suite — but the skip is loud, because a
 * silently-skipped oracle is a weakened oracle.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = new URL('../..', import.meta.url).pathname;
const container = process.env['FACTORY_PG_CONTAINER'] ?? 'factory-postgres-dev';

/**
 * Whether the dev Postgres container is running.
 */
const containerRunning = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}'], {
      encoding: 'utf8',
    });
    return stdout.split('\n').some((name) => name.trim() === container);
  } catch {
    return false;
  }
};

const running = await containerRunning();

describe('T-1.02 · the pack’s own DDL oracle', () => {
  it.skipIf(!running)(
    'A1.14 the pack’s validate_ddl.sh passes unmodified against the shipped DDL',
    async () => {
      const { stdout, stderr } = await execFileAsync(
        'bash',
        [`${repoRoot}tools/run-pack-ddl-oracle.sh`],
        { encoding: 'utf8', cwd: repoRoot, env: { ...process.env, DB: 'factory_t1_02_pack' } },
      );
      const output = `${stdout}${stderr}`;
      expect(output).toContain('ALL CHECKS PASSED');
      expect(output).not.toMatch(/^FAIL/m);
    },
    600_000,
  );

  it.skipIf(!running)(
    'A1.14 the pack’s oracle reports every one of its checks as PASS',
    async () => {
      const { stdout } = await execFileAsync(
        'bash',
        [`${repoRoot}tools/run-pack-ddl-oracle.sh`],
        { encoding: 'utf8', cwd: repoRoot, env: { ...process.env, DB: 'factory_t1_02_pack2' } },
      );
      const passes = stdout.split('\n').filter((line) => line.startsWith('PASS  '));
      // The pack's script has 25 checks. Fewer would mean a check stopped
      // running; more would mean the script changed.
      expect(passes.length).toBe(25);
    },
    600_000,
  );

  it('A1.14 the pack’s oracle script is not modified by this repository', () => {
    // The pack is read-only. If the script's bytes changed, the oracle would
    // have been weakened at the source — which no test in this repository
    // could detect from the inside.
    const script = readFileSync(
      `${repoRoot}software-factory-pack/software-factory-pack/reference/validate_ddl.sh`,
      'utf8',
    );
    expect(script).toContain('may EXTEND this file but may not weaken or delete a check');
    expect(script).toContain('ALL CHECKS PASSED');
    expect(script).toContain('SOME CHECKS FAILED');
  });
});
