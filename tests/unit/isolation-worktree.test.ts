/**
 * The **clean worktree creator**.
 *
 * pack 02 §4.14, verbatim:
 *
 * > Apply to a **clean host worktree** from the base SHA with hooks
 * > disabled (`-c core.hooksPath=/dev/null -c core.fsmonitor=false`).
 *
 * The proof that the flags are applied is a **spy assertion** on the argv
 * the package built — the ticket's own wording. So these tests read the
 * argv the creator hands to the spawn, and they read it through the
 * *public* method, because a spy that has to reach into a private helper
 * is a spy that proves less.
 */

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_GIT_CONFIG,
  CleanWorktreeCreator,
  InMemoryWorkspaceStore,
  SpySpawn,
} from '../../packages/isolation/src/index.ts';

const SHA = 'a'.repeat(40);

const harness = (options: { code?: number; stderr?: string } = {}) => {
  const spawn = new SpySpawn({
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
  });
  const store = new InMemoryWorkspaceStore();
  const creator = new CleanWorktreeCreator({
    spawn: spawn.spawn,
    store,
    worktreeRoot: '/worktrees',
    repositoryPath: '/repo',
    nowIso: () => '2026-11-10T00:00:00Z',
    taskId: 'task-1',
    slug: 'feature-add-login',
  });
  return { spawn, store, creator };
};

describe('the clean worktree creator', () => {
  it('creates the worktree at the base SHA', async () => {
    const { creator, spawn } = harness();
    const outcome = await creator.create(SHA);
    expect(outcome.ok).toBe(true);
    expect(spawn.lastArgv).toContain(SHA);
  });

  it('invokes git with hooks disabled', async () => {
    // The ticket's proof, in its own words: "git is invoked with hooks
    // disabled (spy assertion)".
    const { creator, spawn } = harness();
    await creator.create(SHA);
    expect(spawn.lastArgv).toContain('core.hooksPath=/dev/null');
  });

  it('invokes git with the fsmonitor off', async () => {
    const { creator, spawn } = harness();
    await creator.create(SHA);
    expect(spawn.lastArgv).toContain('core.fsmonitor=false');
  });

  it('passes the two flags as `-c` settings, before the subcommand', async () => {
    // `git -c <key>=<value> <subcommand>` is git's own syntax for a
    // per-invocation setting. The flags have to come before `worktree`.
    const { creator, spawn } = harness();
    await creator.create(SHA);
    const argv = spawn.lastArgv ?? [];
    const hooksAt = argv.indexOf('core.hooksPath=/dev/null');
    const subcommandAt = argv.indexOf('worktree');
    expect(hooksAt).toBeGreaterThan(-1);
    expect(subcommandAt).toBeGreaterThan(hooksAt);
    expect(argv[hooksAt - 1]).toBe('-c');
  });

  it('uses exactly the canonical flags and no others', async () => {
    const { creator, spawn } = harness();
    await creator.create(SHA);
    const argv = spawn.lastArgv ?? [];
    // The values that follow each `-c`.
    const configs: string[] = [];
    for (const [index, token] of argv.entries()) {
      if (token === '-c') {
        const value = argv[index + 1];
        if (value !== undefined) {
          configs.push(value);
        }
      }
    }
    expect(configs).toEqual([
      'core.hooksPath=/dev/null',
      'core.fsmonitor=false',
    ]);
    expect(CANONICAL_GIT_CONFIG).toEqual([
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
    ]);
  });

  it('invokes git as an argv array, never a shell string', async () => {
    const { creator, spawn } = harness();
    await creator.create(SHA);
    const argv = spawn.lastArgv ?? [];
    expect(argv[0]).toBe('git');
    for (const token of argv) {
      expect(token).not.toContain('&&');
      expect(token).not.toContain(';');
      expect(token).not.toContain('|');
    }
  });

  it('passes the SHA as one argv token, not as part of a command line', async () => {
    // A SHA is one argument. If it were concatenated into a command line,
    // a ref like `HEAD; rm -rf /` would be two commands.
    const { creator, spawn } = harness();
    await creator.create(SHA);
    const argv = spawn.lastArgv ?? [];
    expect(argv.filter((token) => token === SHA)).toHaveLength(1);
  });

  it('does not modify the repository’s own config', async () => {
    // The flags are per-invocation. The factory must not leave a mark on
    // a user's repository.
    const { creator, spawn } = harness();
    await creator.create(SHA);
    const argv = spawn.lastArgv ?? [];
    expect(argv).not.toContain('config');
    expect(argv).not.toContain('core.hooksPath');
  });

  it('puts the worktree under the worktree root', async () => {
    const { creator } = harness();
    const outcome = await creator.create(SHA);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.root).toBe(`/worktrees/${SHA}-feature-add-login`);
    }
  });

  it('names the workspace it created', async () => {
    const { creator } = harness();
    const outcome = await creator.create(SHA);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.workspace.taskId).toBe('task-1');
      expect(outcome.workspace.kind).toBe('worktree');
      expect(outcome.workspace.baseSha).toBe(SHA);
    }
  });

  it('refuses a base SHA that is not a commit name', async () => {
    const { creator, spawn } = harness();
    const outcome = await creator.create('HEAD');
    expect(outcome.ok).toBe(false);
    expect(spawn.calls).toHaveLength(0);
  });

  it('refuses a slug that would escape the worktree root', async () => {
    const spawn = new SpySpawn();
    const creator = new CleanWorktreeCreator({
      spawn: spawn.spawn,
      store: new InMemoryWorkspaceStore(),
      worktreeRoot: '/worktrees',
      repositoryPath: '/repo',
      nowIso: () => '2026-11-10T00:00:00Z',
      taskId: 'task-1',
      slug: '../../etc',
    });
    const outcome = await creator.create(SHA);
    expect(outcome.ok).toBe(false);
    expect(spawn.calls).toHaveLength(0);
  });

  it('reports a failed worktree as a refusal, not a throw', async () => {
    const { creator } = harness({ code: 128, stderr: 'fatal: already exists' });
    const outcome = await creator.create(SHA);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('128');
      expect(outcome.reason).toContain('fatal: already exists');
    }
  });

  it('removes the worktree with the same canonical flags', async () => {
    // The removal is a git invocation, and the rule is about **every**
    // git invocation the factory makes.
    const { creator, spawn } = harness();
    await creator.remove('/worktrees/x');
    const argv = spawn.lastArgv ?? [];
    expect(argv).toContain('core.hooksPath=/dev/null');
    expect(argv).toContain('core.fsmonitor=false');
    expect(argv).toContain('remove');
  });

  it('reports a failed removal', async () => {
    const { creator } = harness({ code: 1 });
    const failures = await creator.remove('/worktrees/x');
    expect(failures).toHaveLength(1);
  });
});
