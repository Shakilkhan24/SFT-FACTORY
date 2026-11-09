import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(__dirname, '..', '..');
const miningTool = join(repoRoot, 'tools', 'mining');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const run = async (args: readonly string[], cwd: string): Promise<RunResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [miningTool, ...args], {
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

const commit = async (repo: string, message: string): Promise<void> => {
  await git(repo, ['add', '-A']);
  await execFileAsync('git', ['commit', '-q', '-m', message], { cwd: repo });
};

/**
 * A fixture history with known fixes.
 *
 * Four commits qualify as candidates (a fix that touches tests), one fix touches no tests
 * (so it must NOT be a candidate), and one non-fix touches tests (also not a candidate).
 */
const buildFixture = async (dir: string): Promise<void> => {
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  await git(dir, ['config', 'user.name', 'Fixture']);

  await writeFile(join(dir, 'src.ts'), 'export const x = 1;\n', 'utf8');
  await mkdir(join(dir, 'tests'), { recursive: true });
  await commit(dir, 'chore: base');

  // Candidate 1 — fix + test.
  await writeFile(join(dir, 'src.ts'), 'export const x = 2;\n', 'utf8');
  await writeFile(join(dir, 'src.test.ts'), "it('x is 2', () => {});\n", 'utf8');
  await commit(dir, 'fix: wrong constant');

  // Candidate 2 — fix + test, in a tests/ directory.
  await writeFile(join(dir, 'other.ts'), 'export const y = 1;\n', 'utf8');
  await commit(dir, 'feat: add other');
  await writeFile(join(dir, 'other.ts'), 'export const y = 2;\n', 'utf8');
  await writeFile(join(dir, 'tests', 'other.test.ts'), "it('y is 2', () => {});\n", 'utf8');
  await commit(dir, 'fix: other constant');

  // Candidate 3 — hotfix + test.
  await writeFile(join(dir, 'third.ts'), 'export const z = 1;\n', 'utf8');
  await commit(dir, 'feat: add third');
  await writeFile(join(dir, 'third.ts'), 'export const z = 3;\n', 'utf8');
  await writeFile(join(dir, 'third.spec.ts'), "it('z is 3', () => {});\n", 'utf8');
  await commit(dir, 'hotfix: third off by one');

  // Candidate 4 — a fix referencing a bug.
  await writeFile(join(dir, 'fourth.ts'), 'export const w = 1;\n', 'utf8');
  await commit(dir, 'feat: add fourth');
  await writeFile(join(dir, 'fourth.ts'), 'export const w = 4;\n', 'utf8');
  await writeFile(join(dir, 'fourth.test.ts'), "it('w is 4', () => {});\n", 'utf8');
  await commit(dir, 'fix: regression in fourth');

  // NOT a candidate — a fix that touches no test.
  await writeFile(join(dir, 'src.ts'), 'export const x = 3;\n', 'utf8');
  await commit(dir, 'fix: bump constant without a test');

  // NOT a candidate — a non-fix that touches a test.
  await writeFile(join(dir, 'fifth.ts'), 'export const v = 1;\n', 'utf8');
  await writeFile(join(dir, 'fifth.test.ts'), "it('v exists', () => {});\n", 'utf8');
  await commit(dir, 'feat: add fifth with a test');
};

describe('tools/mining (T-0.06)', () => {
  it('A0.35 finds the known fixes in a fixture history', async () => {
    const work = await mkdtemp(join(tmpdir(), 'mine-fixture-'));
    const repo = join(work, 'repo');
    await mkdir(repo, { recursive: true });
    try {
      await buildFixture(repo);
      const out = join(work, 'candidates.jsonl');

      const result = await run(
        ['--repo', repo, '--out', out, '--days', '3650', '--min', '4'],
        repoRoot,
      );
      expect(result.exitCode).toBe(0);

      const lines = (await readFile(out, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(4);

      const candidates = lines.map(
        (line) =>
          JSON.parse(line) as {
            fixSha: string;
            preFixSha: string | null;
            testPaths: string[];
            message: string;
          },
      );

      // Every candidate has the shape the corpus needs.
      for (const candidate of candidates) {
        expect(candidate.fixSha).toMatch(/^[0-9a-f]{40}$/);
        expect(candidate.preFixSha).toMatch(/^[0-9a-f]{40}$/);
        expect(candidate.testPaths.length).toBeGreaterThan(0);
        expect(candidate.message).toMatch(/fix|hotfix/i);
      }

      const messages = candidates.map((c) => c.message).sort();
      expect(messages).toEqual([
        'fix: other constant',
        'fix: regression in fourth',
        'fix: wrong constant',
        'hotfix: third off by one',
      ]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.36 does not mine a fix that touches no test, or a test that fixes nothing', async () => {
    const work = await mkdtemp(join(tmpdir(), 'mine-negative-'));
    const repo = join(work, 'repo');
    await mkdir(repo, { recursive: true });
    try {
      await buildFixture(repo);
      const out = join(work, 'candidates.jsonl');
      await run(['--repo', repo, '--out', out, '--days', '3650', '--min', '1'], repoRoot);

      const content = await readFile(out, 'utf8');
      // A fix with no oracle cannot be calibrated against anything.
      expect(content).not.toContain('bump constant without a test');
      // A test added without a fix is not a violation/oracle pair.
      expect(content).not.toContain('add fifth with a test');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.37 reports a shortfall rather than padding the corpus', async () => {
    const work = await mkdtemp(join(tmpdir(), 'mine-short-'));
    const repo = join(work, 'repo');
    await mkdir(repo, { recursive: true });
    try {
      await buildFixture(repo);
      const out = join(work, 'candidates.jsonl');

      const result = await run(
        ['--repo', repo, '--out', out, '--days', '3650', '--min', '10'],
        repoRoot,
      );

      // The corpus has 4 candidates but 10 were required.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/SHORTFALL/);
      expect(result.stderr).toMatch(/Do NOT pad/i);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('A0.38 uses git only, with no network access', async () => {
    const work = await mkdtemp(join(tmpdir(), 'mine-gitonly-'));
    const repo = join(work, 'repo');
    await mkdir(repo, { recursive: true });
    try {
      await buildFixture(repo);
      const out = join(work, 'candidates.jsonl');
      await run(['--repo', repo, '--out', out, '--days', '3650', '--min', '1'], repoRoot);

      // The tool is a script; assert it contains no network-capable imports.
      const source = await readFile(miningTool, 'utf8');
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/require\(['"]https?['"]\)/);
      expect(source).not.toMatch(/\baxios\b/);
      expect(source).not.toMatch(/\bnode-fetch\b/);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
