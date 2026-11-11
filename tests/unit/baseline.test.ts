import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(__dirname, '..', '..');
const baselineTool = join(repoRoot, 'tools', 'baseline');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const run = async (args: readonly string[], cwd: string): Promise<RunResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [baselineTool, ...args], {
      cwd,
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

const git = async (repo: string, args: readonly string[]): Promise<void> => {
  await execFileAsync('git', args, { cwd: repo });
};

/**
 * The JSON report the baseline tool wrote.
 *
 * The tool names the file `pre-factory-<today>.json`, where *today* is the
 * day the tool ran — so the name moves with the calendar. The tool prints
 * the path it wrote, and that is what this reads.
 *
 * The earlier version of this test hard-coded `pre-factory-2026-11-09.json`,
 * which made it a **time bomb**: it passed on the day it was written and
 * failed on every day after. A test that is only green on one date is not
 * a test.
 */
const readReport = async (stdout: string): Promise<Record<string, unknown>> => {
  const line = stdout
    .split('\n')
    .find((entry) => entry.trim().startsWith('json:'));
  expect(line, `the tool printed no json path:\n${stdout}`).toBeDefined();

  const path = line?.trim().slice('json:'.length).trim() ?? '';
  expect(path).not.toBe('');

  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
};

/**
 * A fixture repository with a known history: three merged PRs with known review rounds,
 * known sizes and known lead times, plus a revert.
 *
 * The times are set with GIT_AUTHOR_DATE / GIT_COMMITTER_DATE so the lead-time figures are
 * deterministic rather than dependent on how fast the test runs.
 */
const buildFixture = async (dir: string): Promise<void> => {
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  await git(dir, ['config', 'user.name', 'Fixture']);

  const day = (n: number): string => new Date(Date.UTC(2026, 0, n, 12, 0, 0)).toISOString();

  // Base commit on main.
  await writeFile(join(dir, 'README.md'), 'fixture\n', 'utf8');
  await git(dir, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', 'chore: base'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(1), GIT_COMMITTER_DATE: day(1) },
  });

  // PR 1: one commit on the branch, merged on main. Lead time = 48 h.
  await git(dir, ['checkout', '-q', '-b', 'feature/one']);
  await writeFile(join(dir, 'one.ts'), 'export const one = 1;\n', 'utf8');
  await git(dir, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', 'feat: one (#101)'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(2), GIT_COMMITTER_DATE: day(2) },
  });
  await git(dir, ['checkout', '-q', 'main']);
  await execFileAsync('git', ['merge', '-q', '--no-ff', '-m', 'feat: one (#101)', 'feature/one'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(4), GIT_COMMITTER_DATE: day(4) },
  });

  // PR 2: two commits on the branch (two review rounds), merged on main. Lead time = 96 h.
  await git(dir, ['checkout', '-q', '-b', 'feature/two']);
  await writeFile(join(dir, 'two.ts'), 'export const two = 2;\n', 'utf8');
  await git(dir, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', 'feat: two (#102)'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(5), GIT_COMMITTER_DATE: day(5) },
  });
  await writeFile(join(dir, 'two.ts'), 'export const two = 22;\n', 'utf8');
  await git(dir, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', 'feat: two (#102)'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(7), GIT_COMMITTER_DATE: day(7) },
  });
  await git(dir, ['checkout', '-q', 'main']);
  await execFileAsync('git', ['merge', '-q', '--no-ff', '-m', 'feat: two (#102)', 'feature/two'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(9), GIT_COMMITTER_DATE: day(9) },
  });

  // PR 3: one commit, merged on main. Lead time = 24 h.
  await git(dir, ['checkout', '-q', '-b', 'feature/three']);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'three.ts'), 'export const three = 3;\n', 'utf8');
  await git(dir, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', 'fix: three (#103)'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(10), GIT_COMMITTER_DATE: day(10) },
  });
  await git(dir, ['checkout', '-q', 'main']);
  await execFileAsync('git', ['merge', '-q', '--no-ff', '-m', 'fix: three (#103)', 'feature/three'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(11), GIT_COMMITTER_DATE: day(11) },
  });

  // A revert of PR 1's work.
  await writeFile(join(dir, 'one.ts'), 'export const one = 0;\n', 'utf8');
  await git(dir, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', 'Revert "feat: one (#101)"'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: day(12), GIT_COMMITTER_DATE: day(12) },
  });
};

describe('tools/baseline (T-0.04)', () => {
  it('A0.32 produces every metric the checklist names, on a fixture history', async () => {
    const work = await mkdtemp(join(tmpdir(), 'bl-fixture-'));
    const repo = join(work, 'repo');
    const out = join(work, 'out');
    await mkdir(repo, { recursive: true });
    try {
      await buildFixture(repo);

      const result = await run(
        ['--repo', repo, '--out', out, '--days', '3650', '--name', 'fixture'],
        repoRoot,
      );
      expect(result.exitCode).toBe(0);

      const report = (await readReport(result.stdout)) as {
        metrics: Record<string, { count?: number; p50?: number; value?: number | null }>;
        mergeCount: number;
      };

      // Three merged PRs.
      expect(report.mergeCount).toBe(3);

      // Lead time: 48 h, 96 h, 24 h → p50 = 48.
      expect(report.metrics.pr_lead_time_hours?.count).toBe(3);
      expect(report.metrics.pr_lead_time_hours?.p50).toBe(48);

      // PR size: every PR added at least one line.
      expect(report.metrics.pr_size_lines?.count).toBe(3);
      expect(report.metrics.pr_size_lines?.p50).toBe(1);

      // The revert is detected.
      expect(report.metrics.revert_hotfix_rate?.value).toBeGreaterThan(0);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.33 records the DORA baseline as a gap rather than inventing it', async () => {
    const work = await mkdtemp(join(tmpdir(), 'bl-dora-'));
    const repo = join(work, 'repo');
    const out = join(work, 'out');
    await mkdir(repo, { recursive: true });
    try {
      await buildFixture(repo);
      const result = await run(['--repo', repo, '--out', out, '--days', '3650'], repoRoot);

      const report = (await readReport(result.stdout)) as {
        dora: { available: boolean; reason: string };
      };

      // A DORA number that cannot be measured must not be printed as a number.
      expect(report.dora.available).toBe(false);
      expect(report.dora.reason).toMatch(/owner/i);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.34 fails on a directory that is not a git repository', async () => {
    const work = await mkdtemp(join(tmpdir(), 'bl-nogit-'));
    try {
      const result = await run(['--repo', work, '--out', join(work, 'out')], repoRoot);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/not a git repository/i);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
