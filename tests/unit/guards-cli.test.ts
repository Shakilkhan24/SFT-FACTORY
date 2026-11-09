import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(__dirname, '..', '..');
const oracleGuard = join(repoRoot, 'tools', 'oracle-guard.ts');
const scopeGuard = join(repoRoot, 'tools', 'scope-guard.ts');

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a guard CLI the way CI runs it: an argv array, the environment CI sets, and the
 * process's exit code as the verdict.
 *
 * The guards are the trust boundary, so they are tested at the boundary an attacker
 * would reach — not only as library functions. A guard whose CLI passes `--body-file`
 * wrongly is just as broken as one whose library does.
 */
const runCli = async (
  script: string,
  args: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<CliResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
};

describe('the guards at the CLI boundary (T-0.03)', () => {
  it('A0.39 oracle-guard REJECTS a synthetic PR that edits an oracle file', async () => {
    // An implementer branch (not human-authored, no label) touching an acceptance test.
    const result = await runCli(
      oracleGuard,
      ['--changed', 'tests/acceptance/health/health.test.ts'],
      { HUMAN_AUTHORED: 'false', PR_LABELS: '' },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/oracle/i);
  });

  it('A0.40 oracle-guard ACCEPTS the same PR when the commits are human-authored', async () => {
    const result = await runCli(
      oracleGuard,
      ['--changed', 'tests/acceptance/health/health.test.ts'],
      { HUMAN_AUTHORED: 'true', PR_LABELS: '' },
    );

    expect(result.exitCode).toBe(0);
  });

  it('A0.41 oracle-guard ACCEPTS the same PR with the oracle-approved label', async () => {
    const result = await runCli(
      oracleGuard,
      ['--changed', 'tests/acceptance/health/health.test.ts'],
      { HUMAN_AUTHORED: 'false', PR_LABELS: 'oracle-approved,needs-review' },
    );

    expect(result.exitCode).toBe(0);
  });

  it('A0.42 oracle-guard FAILS CLOSED when the commit list cannot be read', async () => {
    // HUMAN_AUTHORED is unset — the CI could not determine authorship. The guard must
    // refuse the oracle edit rather than assume the best.
    const result = await runCli(
      oracleGuard,
      ['--changed', 'tests/acceptance/health/health.test.ts'],
      { HUMAN_AUTHORED: undefined, PR_LABELS: '' },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/fail/i);
  });

  it('A0.43 oracle-guard ACCEPTS a PR that touches no oracle path at all', async () => {
    const result = await runCli(oracleGuard, ['--changed', 'packages/core/src/hash.ts'], {
      HUMAN_AUTHORED: 'false',
      PR_LABELS: '',
    });

    expect(result.exitCode).toBe(0);
  });

  it('A0.44 scope-guard REJECTS a PR touching a path outside Allowed-paths', async () => {
    const work = await mkdtemp(join(tmpdir(), 'scope-cli-'));
    try {
      const bodyFile = join(work, 'body.md');
      await writeFile(
        bodyFile,
        ['## Ticket', '', '`T-1.01` — Contracts and core', '', '## Allowed-paths:', '', '- `packages/core/**`', ''].join(
          '\n',
        ),
        'utf8',
      );

      const result = await runCli(scopeGuard, ['--body-file', bodyFile], {
        CHANGED_PATHS: 'packages/core/src/hash.ts\npackages/contracts/src/index.ts',
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/packages\/contracts/);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.45 scope-guard ACCEPTS a PR entirely inside Allowed-paths', async () => {
    const work = await mkdtemp(join(tmpdir(), 'scope-ok-'));
    try {
      const bodyFile = join(work, 'body.md');
      await writeFile(
        bodyFile,
        ['## Allowed-paths:', '', '- `packages/core/**`', '- `packages/contracts/**`', ''].join('\n'),
        'utf8',
      );

      const result = await runCli(scopeGuard, ['--body-file', bodyFile], {
        CHANGED_PATHS: 'packages/core/src/hash.ts\npackages/contracts/src/index.ts',
      });

      expect(result.exitCode).toBe(0);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.46 scope-guard REJECTS a PR with NO Allowed-paths section at all', async () => {
    const work = await mkdtemp(join(tmpdir(), 'scope-none-'));
    try {
      const bodyFile = join(work, 'body.md');
      await writeFile(bodyFile, ['## Ticket', '', '`T-1.01` — Contracts and core', ''].join('\n'), 'utf8');

      const result = await runCli(scopeGuard, ['--body-file', bodyFile], {
        CHANGED_PATHS: 'packages/core/src/hash.ts',
      });

      // A missing scope is an unbounded scope.
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/scope/i);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
