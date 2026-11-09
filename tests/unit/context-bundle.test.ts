import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(__dirname, '..', '..');
const bundler = join(repoRoot, 'tools', 'context-bundle');

interface BundleResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the real bundler. A bundler that has never been shown to fail is not a
 * guard (checklist 01 trap 6): the budget check must actually stop the run, so
 * the test drives the CLI and reads its exit code rather than re-implementing
 * the arithmetic.
 */
const runBundler = async (args: readonly string[]): Promise<BundleResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundler, ...args], {
      cwd: repoRoot,
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

describe('context-bundle (T-0.03)', () => {
  it('A0.28 builds a bundle for a ticket with a Read line', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ctx-ok-'));
    try {
      const out = join(outDir, 'bundle.md');
      const result = await runBundler(['T-1.01', '--out', out]);

      expect(result.exitCode).toBe(0);
      const bundle = await readFile(out, 'utf8');
      expect(bundle).toContain('# Context bundle — T-1.01');
      expect(bundle.length).toBeGreaterThan(0);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('A0.29 fails on an oversize bundle instead of writing it', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ctx-big-'));
    try {
      const out = join(outDir, 'bundle.md');
      // A budget of 1 byte is a bundle no real ticket can meet. The point is that
      // the budget is a gate, not a note in the log.
      const result = await runBundler(['T-1.01', '--out', out, '--max-bytes', '1']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/over the 1-byte budget/i);
      expect(result.stderr).toMatch(/fix the ticket, not the budget/i);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('A0.30 fails on a ticket that declares no Read list', async () => {
    // T-6.02 has no `Read:` line in the pack. The pack is read-only, so the
    // bundler must refuse rather than invent a scope for the agent.
    const outDir = await mkdtemp(join(tmpdir(), 'ctx-noread-'));
    try {
      const result = await runBundler(['T-6.02', '--out', join(outDir, 'bundle.md')]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/no `Read:` list/i);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('A0.31 fails on a ticket that is not in the backlog', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'ctx-missing-'));
    try {
      const result = await runBundler(['T-9.99', '--out', join(outDir, 'bundle.md')]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/not in the pack's ticket backlog/i);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
