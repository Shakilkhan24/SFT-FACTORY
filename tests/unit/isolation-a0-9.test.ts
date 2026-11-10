/**
 * **A0.9** — the worktree is reclaimed when its task reaches a terminal
 * state, including failure | Leak detector.
 *
 * blueprint 16 §3.5: "| A0.9 | A worktree is reclaimed when its task
 * reaches a terminal state, including failure | Leak detector |".
 *
 * ADR-0006 §4: "Environments, worktrees, containers, and credentials are
 * destroyed when the task reaches a terminal state, **including failure**.
 * Cleanup is a reconciler responsibility (ADR-0001), so a crashed task's
 * resources are reclaimed rather than leaked."
 *
 * FR-42: "Execution environments, credentials, and worktrees shall be
 * reclaimed when a task reaches a terminal state, including on failure."
 *
 * The ticket's proof, verbatim:
 *
 * > **A0.9** — reclaimed at every terminal state **including failure**;
 * > git is invoked with hooks disabled (spy assertion); traversal in a
 * > snapshot request is rejected.
 *
 * So this file proves all three, and the three are the whole oracle.
 */

import { describe, expect, it } from 'vitest';

import { TERMINAL } from '../../packages/contracts/src/index.ts';
import {
  CleanWorktreeCreator,
  InMemorySnapshotRegistry,
  InMemoryWorkspaceStore,
  SnapshotBuilder,
  SpySpawn,
  WorkspaceReclaimer,
  buildTar,
  type TaskState,
  type Workspace,
} from '../../packages/isolation/src/index.ts';

const SHA = 'a'.repeat(40);

/**
 * The harness — a registry, a store, a set of task states, and a reclaimer.
 */
const harness = (states: Readonly<Record<string, TaskState | undefined>> = {}) => {
  const registry = new InMemorySnapshotRegistry();
  const store = new InMemoryWorkspaceStore();
  const reclaimer = new WorkspaceReclaimer({
    registry,
    store,
    root: '/snapshots',
    stateOf: (taskId: string): Promise<TaskState | undefined> =>
      Promise.resolve(states[taskId]),
  });
  return { registry, store, reclaimer };
};

/**
 * A workspace, recorded.
 */
const workspace = (
  taskId: string,
  root: string,
  kind: Workspace['kind'] = 'worktree',
): Workspace => ({
  taskId,
  kind,
  root,
  createdAt: '2026-11-10T00:00:00Z',
});

describe('A0.9 — reclaimed at every terminal state', () => {
  it('reclaims at every one of the terminal states', async () => {
    // The **literal** list, not a constant against itself. A test that
    // asserts `TERMINAL.length === 6` notices nothing when a state is
    // added; this one notices, because it walks the corpus's own list.
    expect(TERMINAL).toEqual([
      'MERGED',
      'DEPLOYED',
      'REJECTED',
      'FAILED',
      'ABANDONED',
      'INCOMPLETE',
    ]);

    for (const state of TERMINAL) {
      const { registry, store, reclaimer } = harness({ 'task-1': state });
      await registry.record(workspace('task-1', '/snapshots/w1'));
      await store.ensureDir('/snapshots/w1');

      const result = await reclaimer.reclaimTerminal();

      expect(result.reclaimed.map((w) => w.root)).toEqual(['/snapshots/w1']);
      expect(result.failures).toHaveLength(0);
      // The directory is **gone**, not merely forgotten.
      expect(store.removed).toContain('/snapshots/w1');
      expect(await store.exists('/snapshots/w1')).toBe(false);
    }
  });

  it('reclaims at failure', async () => {
    // The rule says "including failure" — so `FAILED` is not an
    // afterthought, it is the case the rule is *about*: a failed task's
    // workspace is the one most likely to be forgotten.
    const { registry, store, reclaimer } = harness({ 'task-1': 'FAILED' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await store.ensureDir('/snapshots/w1');

    const result = await reclaimer.reclaimTerminal();

    expect(result.reclaimed).toHaveLength(1);
    expect(store.removed).toContain('/snapshots/w1');
  });

  it('reclaims at the two other failure states', async () => {
    for (const state of ['ABANDONED', 'INCOMPLETE'] as const) {
      const { registry, reclaimer } = harness({ 'task-1': state });
      await registry.record(workspace('task-1', '/snapshots/w1'));
      const result = await reclaimer.reclaimTerminal();
      expect(result.reclaimed).toHaveLength(1);
    }
  });

  it('reclaims a snapshot as well as a worktree', async () => {
    const { registry, store, reclaimer } = harness({ 'task-1': 'MERGED' });
    await registry.record(workspace('task-1', '/snapshots/s1', 'snapshot'));
    await store.ensureDir('/snapshots/s1');
    const result = await reclaimer.reclaimTerminal();
    expect(result.reclaimed).toHaveLength(1);
    expect(store.removed).toContain('/snapshots/s1');
  });

  it('does not reclaim a task that is still running', async () => {
    const { registry, store, reclaimer } = harness({ 'task-1': 'RUNNING' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await store.ensureDir('/snapshots/w1');

    const result = await reclaimer.reclaimTerminal();

    expect(result.reclaimed).toHaveLength(0);
    expect(store.removed).toHaveLength(0);
    expect(await store.exists('/snapshots/w1')).toBe(true);
  });

  it('does not reclaim an escalated task', async () => {
    // pack 03 §6: `ESCALATED` is **resumable**. A task waiting for a
    // human still owns its workspace — reclaiming it would destroy the
    // state the human is about to look at.
    const { registry, store, reclaimer } = harness({ 'task-1': 'ESCALATED' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await store.ensureDir('/snapshots/w1');

    const result = await reclaimer.reclaimTerminal();

    expect(result.reclaimed).toHaveLength(0);
    expect(store.removed).toHaveLength(0);
    expect(await store.exists('/snapshots/w1')).toBe(true);
  });

  it('forgets the record as well as removing the directory', async () => {
    // A record that says "reclaimed" while the directory is still there
    // is a lie the detector would catch.
    const { registry, reclaimer } = harness({ 'task-1': 'MERGED' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await reclaimer.reclaimTerminal();
    expect(registry.forgotten).toContain('/snapshots/w1');
    expect(await registry.list()).toHaveLength(0);
  });

  it('reclaims the workspaces of a named task whatever its state', async () => {
    // The path the orchestrator takes when it *knows* the task ended.
    const { registry, store, reclaimer } = harness({ 'task-1': 'RUNNING' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await registry.record(workspace('task-2', '/snapshots/w2'));
    await store.ensureDir('/snapshots/w1');
    await store.ensureDir('/snapshots/w2');

    const result = await reclaimer.reclaimTask('task-1');

    expect(result.reclaimed.map((w) => w.root)).toEqual(['/snapshots/w1']);
    expect(store.removed).toEqual(['/snapshots/w1']);
  });

  it('reclaims a workspace whose task is gone', async () => {
    // A crashed task must not leak. The workspace is reclaimed because
    // the task cannot be resumed — there is nothing left to resume it.
    const { registry, store, reclaimer } = harness({});
    await registry.record(workspace('task-gone', '/snapshots/w1'));
    await store.ensureDir('/snapshots/w1');

    const result = await reclaimer.reclaimTerminal();

    expect(result.reclaimed).toHaveLength(1);
    expect(store.removed).toContain('/snapshots/w1');
  });

  it('reports a failed removal rather than claiming success', async () => {
    const { registry, store, reclaimer } = harness({ 'task-1': 'MERGED' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await store.ensureDir('/snapshots/w1');
    store.remove = (): Promise<void> => {
      throw new Error('the directory is busy');
    };

    const result = await reclaimer.reclaimTerminal();

    expect(result.reclaimed).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
  });
});

describe('A0.9 — the leak detector', () => {
  it('reports nothing when everything is reclaimed', async () => {
    const { registry, store, reclaimer } = harness({ 'task-1': 'MERGED' });
    await registry.record(workspace('task-1', '/snapshots/w1'));
    await store.ensureDir('/snapshots/w1');
    await reclaimer.reclaimTerminal();

    const leaks = await reclaimer.detectLeaks();
    expect(leaks).toHaveLength(0);
  });

  it('reports a workspace whose task has gone terminal', async () => {
    // The detector is the oracle's other half: the reclaimer proves that
    // reclamation happens, the detector proves that nothing is left
    // behind.
    const { registry, reclaimer } = harness({ 'task-1': 'FAILED' });
    await registry.record(workspace('task-1', '/snapshots/w1'));

    const leaks = await reclaimer.detectLeaks();
    expect(leaks.map((leak) => leak.root)).toEqual(['/snapshots/w1']);
    expect(leaks[0]?.kind).toBe('worktree');
  });

  it('reports a workspace whose task no longer exists', async () => {
    const { registry, reclaimer } = harness({});
    await registry.record(workspace('task-gone', '/snapshots/w1'));

    const leaks = await reclaimer.detectLeaks();
    expect(leaks.map((leak) => leak.root)).toEqual(['/snapshots/w1']);
  });

  it('reports a directory the registry does not know about', async () => {
    // A snapshot that was created and whose record was lost. The
    // registry cannot see it — only the filesystem can.
    const { store, reclaimer } = harness({});
    await store.ensureDir('/snapshots/orphan');

    const leaks = await reclaimer.detectLeaks();
    expect(leaks.map((leak) => leak.root)).toEqual(['/snapshots/orphan']);
  });

  it('does not report a live workspace as a leak', async () => {
    // A detector that reported live workspaces would cry wolf, and a
    // detector that never reports anything would prove nothing.
    const { registry, reclaimer } = harness({ 'task-1': 'RUNNING' });
    await registry.record(workspace('task-1', '/snapshots/w1'));

    const leaks = await reclaimer.detectLeaks();
    expect(leaks).toHaveLength(0);
  });
});

describe('A0.9 — git is invoked with hooks disabled', () => {
  it('disables the hooks on the snapshot’s archive', async () => {
    const spawn = new SpySpawn({
      stdout: buildTar([{ name: 'README.md', contents: 'hello' }]),
    });
    const builder = new SnapshotBuilder({
      spawn: spawn.spawn,
      store: new InMemoryWorkspaceStore(),
      snapshotRoot: '/snapshots',
      repositoryPath: '/repo',
      nowIso: () => '2026-11-10T00:00:00Z',
      taskId: 'task-1',
    });
    await builder.create(SHA);
    expect(spawn.lastArgv).toContain('core.hooksPath=/dev/null');
  });

  it('disables the hooks on the worktree’s creation', async () => {
    const spawn = new SpySpawn();
    const creator = new CleanWorktreeCreator({
      spawn: spawn.spawn,
      store: new InMemoryWorkspaceStore(),
      worktreeRoot: '/worktrees',
      repositoryPath: '/repo',
      nowIso: () => '2026-11-10T00:00:00Z',
      taskId: 'task-1',
      slug: 'feature-add-login',
    });
    await creator.create(SHA);
    expect(spawn.lastArgv).toContain('core.hooksPath=/dev/null');
  });
});

describe('A0.9 — traversal in a snapshot request is rejected', () => {
  it('rejects a request whose archive climbs out', async () => {
    const spawn = new SpySpawn({
      stdout: buildTar([{ name: '../escape', contents: 'pwned' }]),
    });
    const store = new InMemoryWorkspaceStore();
    const builder = new SnapshotBuilder({
      spawn: spawn.spawn,
      store,
      snapshotRoot: '/snapshots',
      repositoryPath: '/repo',
      nowIso: () => '2026-11-10T00:00:00Z',
      taskId: 'task-1',
    });

    const outcome = await builder.create(SHA);

    expect(outcome.ok).toBe(false);
    expect(store.files.size).toBe(0);
  });

  it('rejects a request whose base SHA tries to escape', async () => {
    const spawn = new SpySpawn();
    const builder = new SnapshotBuilder({
      spawn: spawn.spawn,
      store: new InMemoryWorkspaceStore(),
      snapshotRoot: '/snapshots',
      repositoryPath: '/repo',
      nowIso: () => '2026-11-10T00:00:00Z',
      taskId: 'task-1',
    });

    const outcome = await builder.create('../../etc/passwd');

    expect(outcome.ok).toBe(false);
    expect(spawn.calls).toHaveLength(0);
  });
});
