/**
 * The executor registry (T-1.13).
 *
 * ADR-0017's validation section names the check this file proves: "The
 * capability registry rejects a workflow that requests the `harness` kind
 * for a stage outside the permitted set."
 *
 * The other two refusals matter as much: an unimplemented stage kind, and
 * an executor kind with no registered executor.
 */

import { describe, expect, it } from 'vitest';

import { ExecutorRegistry, FakeExecutor } from '@factory/orchestrator';

describe('the executor registry', () => {
  it('resolves a stage kind to its registered executor', () => {
    const registry = new ExecutorRegistry();
    const deterministic = new FakeExecutor('deterministic');
    registry.register(deterministic);

    const resolved = registry.resolve('verify');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe(deterministic);
      expect(resolved.kind).toBe('deterministic');
    }
  });

  it('reports the registered kinds', () => {
    const registry = new ExecutorRegistry();
    registry.register(new FakeExecutor('deterministic'));
    registry.register(new FakeExecutor('completion'));
    expect(registry.registeredKinds()).toEqual(['completion', 'deterministic']);
  });

  it('knows whether a kind is registered', () => {
    const registry = new ExecutorRegistry();
    registry.register(new FakeExecutor('deterministic'));
    expect(registry.has('deterministic')).toBe(true);
    expect(registry.has('harness')).toBe(false);
  });

  it('refuses a stage kind that is not implemented', () => {
    const registry = new ExecutorRegistry();
    registry.register(new FakeExecutor('deterministic'));

    const resolved = registry.resolve('deploy');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain('deploy');
      expect(resolved.reason).toContain('not implemented');
    }
  });

  it('refuses a stage kind whose executor is not registered', () => {
    const registry = new ExecutorRegistry();
    // No `harness` executor is registered — v1's production harness
    // adapter is T-2.x.
    const resolved = registry.resolve('implement');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain('harness');
      expect(resolved.reason).toContain('no executor is registered');
    }
  });

  it('refuses a harness executor for a stage ADR-0017 does not permit', () => {
    const registry = new ExecutorRegistry();
    registry.register(new FakeExecutor('harness'));

    const resolved = registry.resolve('review', 'harness');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain('ADR-0017');
    }
  });

  it('allows a harness executor for the implement stage', () => {
    const registry = new ExecutorRegistry();
    const harness = new FakeExecutor('harness');
    registry.register(harness);

    const resolved = registry.resolve('implement', 'harness');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe(harness);
    }
  });

  it('a registered executor of the wrong kind is not used for another kind', () => {
    const registry = new ExecutorRegistry();
    registry.register(new FakeExecutor('completion'));

    const resolved = registry.resolve('verify');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain('deterministic');
    }
  });

  it('registering a second executor for the same kind replaces the first', () => {
    const registry = new ExecutorRegistry();
    const first = new FakeExecutor('deterministic');
    const second = new FakeExecutor('deterministic');
    registry.register(first);
    registry.register(second);

    const resolved = registry.resolve('verify');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe(second);
    }
  });

  it('a declared executor is honoured when it is permitted', () => {
    const registry = new ExecutorRegistry();
    const deterministic = new FakeExecutor('deterministic');
    registry.register(deterministic);

    const resolved = registry.resolve('review', 'deterministic');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe(deterministic);
    }
  });
});
