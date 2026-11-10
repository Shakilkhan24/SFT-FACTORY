/**
 * `runtime/fakes/fake-reclaimers` — the fake environment registry and the
 * fake credential reclaimer.
 *
 * ## Why both are needed
 *
 * The oracle's third proof is "cancel reclaims env + credentials". The
 * proof is that **both** happen — so the fake has to record **both**
 * separately, or a test that asserted "something was reclaimed" would pass
 * when only the environment was.
 *
 * The order is recorded too, because the order is a decision: the
 * environment is torn down before the credentials are revoked.
 */

import type {
  CredentialReclaimer,
  EnvironmentRegistry,
  StateSink,
} from '../ports.js';

/**
 * The fake environment registry.
 */
export class FakeEnvironmentRegistry implements EnvironmentRegistry {
  /** The runs whose environment was reclaimed, in order. */
  readonly reclaimed: string[] = [];
  /** The environments that were registered, by run id. */
  readonly environments = new Map<string, { readonly root: string; readonly kind: string }>();

  /** Register an environment for a run. */
  public register(runId: string, root: string, kind = 'worktree'): void {
    this.environments.set(runId, { root, kind });
  }

  public environmentFor(
    runId: string,
  ): Promise<{ readonly root: string; readonly kind: string } | undefined> {
    return Promise.resolve(this.environments.get(runId));
  }

  public reclaim(runId: string): Promise<void> {
    this.reclaimed.push(runId);
    this.environments.delete(runId);
    return Promise.resolve();
  }
}

/**
 * The fake credential reclaimer.
 */
export class FakeCredentialReclaimer implements CredentialReclaimer {
  /** The runs whose credentials were revoked, in order. */
  readonly revoked: string[] = [];

  public reclaim(runId: string): Promise<void> {
    this.revoked.push(runId);
    return Promise.resolve();
  }
}

/**
 * The fake state sink.
 */
export class FakeStateSink implements StateSink {
  /** The transitions that were applied, in order. */
  readonly transitions: {
    readonly taskId: string;
    readonly nodeId: string;
    readonly to: string;
    readonly trigger: string;
  }[] = [];
  /** The transitions that must be refused, by `taskId:nodeId:to`. */
  readonly refusals = new Map<string, string>();

  public transition(input: {
    readonly taskId: string;
    readonly nodeId: string;
    readonly to: string;
    readonly trigger: string;
    readonly facts?: unknown;
  }): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const key = `${input.taskId}:${input.nodeId}:${input.to}`;
    const refusal = this.refusals.get(key);
    if (refusal !== undefined) {
      return Promise.resolve({ ok: false, reason: refusal });
    }
    this.transitions.push({
      taskId: input.taskId,
      nodeId: input.nodeId,
      to: input.to,
      trigger: input.trigger,
    });
    return Promise.resolve({ ok: true });
  }

  /** The transitions to a given state, for a test to inspect. */
  public toState(state: string): readonly {
    readonly taskId: string;
    readonly nodeId: string;
    readonly to: string;
    readonly trigger: string;
  }[] {
    return this.transitions.filter((transition) => transition.to === state);
  }
}
