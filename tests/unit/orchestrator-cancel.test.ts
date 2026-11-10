/**
 * The cancellation path (T-1.13).
 *
 * pack `02` §4.9: "Cancellation/pause: cooperative flag checked between
 * steps and via `docker kill` for harness nodes; always followed by
 * cleanup."
 *
 * These are the tests behind A0.5's third proof: a cancel reclaims the
 * environment **and** the credentials.
 */

import { describe, expect, it } from 'vitest';

import {
  CancelPath,
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeHarnessAdapter,
} from '@factory/orchestrator';

/**
 * A cancel path wired to the fakes.
 */
const harness = (
  options: { readonly withHarness?: boolean } = {},
): {
  cancel: CancelPath;
  environments: FakeEnvironmentRegistry;
  credentials: FakeCredentialReclaimer;
  harness: FakeHarnessAdapter | undefined;
} => {
  const environments = new FakeEnvironmentRegistry();
  const credentials = new FakeCredentialReclaimer();
  const harnessAdapter =
    options.withHarness === true ? new FakeHarnessAdapter() : undefined;
  const cancel = new CancelPath({
    environments,
    credentials,
    ...(harnessAdapter === undefined ? {} : { harness: harnessAdapter }),
    clock: { now: () => '2026-11-10T00:00:00.000Z' },
  });
  return {
    cancel,
    environments,
    credentials,
    harness: harnessAdapter,
  };
};

describe('the cancellation path', () => {
  it('the environment is reclaimed', async () => {
    const { cancel, environments } = harness();

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      reason: 'the operator stopped the factory',
    });

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(outcome.environmentReclaimed).toBe(true);
  });

  it('the credentials are revoked', async () => {
    const { cancel, credentials } = harness();

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      reason: 'the operator stopped the factory',
    });

    expect(credentials.revoked).toEqual(['run_1']);
    expect(outcome.credentialsRevoked).toBe(true);
  });

  it('both happen — the environment and the credentials', async () => {
    // The oracle's proof is that **both** happen, so a test asserting
    // "something was reclaimed" would not be enough.
    const { cancel, environments, credentials } = harness();

    await cancel.cancel({ taskId: 'tsk_1', runId: 'run_1', reason: 'cancelled' });

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('the environment is reclaimed before the credentials are revoked', async () => {
    const { cancel, environments, credentials } = harness();
    const order: string[] = [];
    const originalReclaim = environments.reclaim.bind(environments);
    environments.reclaim = async (runId: string): Promise<void> => {
      order.push('environment');
      await originalReclaim(runId);
    };
    const originalRevoke = credentials.reclaim.bind(credentials);
    credentials.reclaim = async (runId: string): Promise<void> => {
      order.push('credentials');
      await originalRevoke(runId);
    };

    await cancel.cancel({ taskId: 'tsk_1', runId: 'run_1', reason: 'cancelled' });

    expect(order).toEqual(['environment', 'credentials']);
  });

  it('the credentials are revoked even when the environment reclamation throws', async () => {
    // A leaked credential is worse than a leaked directory.
    const { cancel, environments, credentials } = harness();
    environments.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the filesystem is gone'));

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      reason: 'cancelled',
    });

    expect(credentials.revoked).toEqual(['run_1']);
    expect(outcome.credentialsRevoked).toBe(true);
    expect(outcome.environmentReclaimed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
  });

  it('a harness run has its sandbox killed', async () => {
    const { cancel, harness: harnessAdapter } = harness({ withHarness: true });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      executorKind: 'harness',
      reason: 'cancelled',
    });

    expect(harnessAdapter?.killed).toEqual(['run_1']);
    expect(outcome.sandboxKilled).toBe(true);
  });

  it('a non-harness run has no sandbox to kill', async () => {
    const { cancel, harness: harnessAdapter } = harness({ withHarness: true });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      executorKind: 'deterministic',
      reason: 'cancelled',
    });

    expect(harnessAdapter?.killed).toEqual([]);
    expect(outcome.sandboxKilled).toBe(false);
  });

  it('the sandbox is killed before the environment is reclaimed', async () => {
    // The kill comes first: a container that is still running cannot be
    // reclaimed cleanly.
    const { cancel, environments, harness: harnessAdapter } = harness({ withHarness: true });
    const order: string[] = [];
    const originalKill = harnessAdapter?.kill.bind(harnessAdapter);
    if (harnessAdapter !== undefined) {
      harnessAdapter.kill = async (runId: string): Promise<void> => {
        order.push('kill');
        await originalKill?.(runId);
      };
    }
    const originalReclaim = environments.reclaim.bind(environments);
    environments.reclaim = async (runId: string): Promise<void> => {
      order.push('environment');
      await originalReclaim(runId);
    };

    await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      executorKind: 'harness',
      reason: 'cancelled',
    });

    expect(order).toEqual(['kill', 'environment']);
  });

  it('a failed kill is reported but the cleanup still happens', async () => {
    const environments = new FakeEnvironmentRegistry();
    const credentials = new FakeCredentialReclaimer();
    const harnessAdapter = new FakeHarnessAdapter(
      { status: 'success' },
      new Error('the container is already gone'),
    );
    const cancel = new CancelPath({
      environments,
      credentials,
      harness: harnessAdapter,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      executorKind: 'harness',
      reason: 'cancelled',
    });

    expect(outcome.sandboxKilled).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('the token it hands out is cancelled and carries the reason', () => {
    const { cancel } = harness();

    const token = cancel.token('the operator paused the factory');

    expect(token.cancelled).toBe(true);
    expect(token.reason).toBe('the operator paused the factory');
  });
});
