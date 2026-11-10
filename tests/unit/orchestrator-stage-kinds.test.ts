/**
 * The stage-kind matrix (T-1.13).
 *
 * pack `02` §4.9: "14 stage kinds exist in the blueprint; v1 implements 12:
 * `specify, plan, implement, verify, review, aggregate, approve,
 * merge(observe), record, sweep` (D-1), a stub `evaluate` (calibration) and
 * a minimal `propose` (T-5.05); `deploy` and `investigate` are not
 * implemented."
 *
 * The tests here prove the matrix is the *contracts'* matrix, that the two
 * unimplemented kinds are refused rather than falling through, and that
 * ADR-0017's harness restriction is enforced.
 */

import { describe, expect, it } from 'vitest';

import { STAGE_KINDS, V1_STAGE_KINDS } from '@factory/contracts';

import {
  DEFAULT_EXECUTOR_BY_STAGE,
  HARNESS_ELIGIBLE_STAGE_KINDS,
  IMPLEMENTED_STAGE_KINDS,
  UNIMPLEMENTED_STAGE_KINDS,
  harnessAllowedFor,
  isImplementedStageKind,
  resolveExecutorKind,
} from '@factory/orchestrator';

describe('the stage-kind matrix', () => {
  it('the blueprint lists fourteen stage kinds', () => {
    expect(STAGE_KINDS).toHaveLength(14);
  });

  it('v1 implements twelve of them', () => {
    expect(IMPLEMENTED_STAGE_KINDS).toHaveLength(12);
  });

  it('the implemented list is the contracts own list, not a second one', () => {
    expect([...IMPLEMENTED_STAGE_KINDS]).toEqual([...V1_STAGE_KINDS]);
  });

  it('the two unimplemented kinds are deploy and investigate', () => {
    expect([...UNIMPLEMENTED_STAGE_KINDS].sort()).toEqual(['deploy', 'investigate']);
  });

  it('every stage kind has a default executor', () => {
    for (const kind of STAGE_KINDS) {
      expect(DEFAULT_EXECUTOR_BY_STAGE[kind]).toBeDefined();
    }
  });

  it('the deterministic stages outnumber the agent stages that write code', () => {
    // blueprint 09 §8.1's table marks six stages "No (deterministic)" —
    // verify, aggregate, merge, deploy, record, evaluate — against one
    // coding agent (`implement`) and one human wait (`approve`).
    //
    // The blueprint's own sentence is "The deterministic stages are the
    // majority", and this asserts the number its table supports: six of
    // fourteen, and more than the one stage that writes code.
    const deterministic = STAGE_KINDS.filter(
      (kind) => DEFAULT_EXECUTOR_BY_STAGE[kind] === 'deterministic',
    );
    expect(deterministic).toHaveLength(6);
    expect(deterministic.length).toBeGreaterThan(
      STAGE_KINDS.filter(
        (kind) => DEFAULT_EXECUTOR_BY_STAGE[kind] === 'harness',
      ).length,
    );
  });

  it('the verify, aggregate and merge stages are deterministic', () => {
    expect(DEFAULT_EXECUTOR_BY_STAGE.verify).toBe('deterministic');
    expect(DEFAULT_EXECUTOR_BY_STAGE.aggregate).toBe('deterministic');
    expect(DEFAULT_EXECUTOR_BY_STAGE.merge).toBe('deterministic');
  });

  it('the implement stage uses the harness and approve waits for a human', () => {
    expect(DEFAULT_EXECUTOR_BY_STAGE.implement).toBe('harness');
    expect(DEFAULT_EXECUTOR_BY_STAGE.approve).toBe('human');
  });

  it('the model stages use the completion executor', () => {
    expect(DEFAULT_EXECUTOR_BY_STAGE.specify).toBe('completion');
    expect(DEFAULT_EXECUTOR_BY_STAGE.plan).toBe('completion');
    expect(DEFAULT_EXECUTOR_BY_STAGE.review).toBe('completion');
  });

  it('an unimplemented stage kind is refused', () => {
    const resolved = resolveExecutorKind('deploy');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain('deploy');
      expect(resolved.reason).toContain('not implemented');
    }
  });

  it('an unimplemented stage kind is refused even with a declared executor', () => {
    const resolved = resolveExecutorKind('investigate', 'completion');
    expect(resolved.ok).toBe(false);
  });

  it('a stage with no declared executor gets the default', () => {
    const resolved = resolveExecutorKind('verify');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe('deterministic');
    }
  });

  it('a declared executor is honoured when it is permitted', () => {
    const resolved = resolveExecutorKind('review', 'completion');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe('completion');
    }
  });

  it('the harness is refused for a stage ADR-0017 does not permit', () => {
    // ADR-0017: "a misconfigured workflow could try to use `harness` for a
    // Reviewer unless the registry checks it."
    const resolved = resolveExecutorKind('review', 'harness');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain('harness');
      expect(resolved.reason).toContain('ADR-0017');
    }
  });

  it('the harness is allowed for the implement stage', () => {
    const resolved = resolveExecutorKind('implement', 'harness');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.executor).toBe('harness');
    }
  });

  it('the harness-eligible set is exactly the implement stage', () => {
    expect([...HARNESS_ELIGIBLE_STAGE_KINDS]).toEqual(['implement']);
  });

  it('only the implement stage may use the harness', () => {
    for (const kind of STAGE_KINDS) {
      expect(harnessAllowedFor(kind)).toBe(kind === 'implement');
    }
  });

  it('isImplementedStageKind agrees with the list', () => {
    for (const kind of STAGE_KINDS) {
      expect(isImplementedStageKind(kind)).toBe(IMPLEMENTED_STAGE_KINDS.includes(kind));
    }
  });

  it('the twelve implemented kinds are the ones the pack names', () => {
    // pack 02 §4.9 names ten, plus the evaluate stub and the propose stub.
    const named = [
      'specify',
      'plan',
      'implement',
      'verify',
      'review',
      'aggregate',
      'approve',
      'merge',
      'record',
      'sweep',
      'evaluate',
      'propose',
    ] as const;
    expect([...IMPLEMENTED_STAGE_KINDS].sort()).toEqual([...named].sort());
  });

  it('every implemented kind resolves to an executor', () => {
    for (const kind of IMPLEMENTED_STAGE_KINDS) {
      const resolved = resolveExecutorKind(kind);
      expect(resolved.ok).toBe(true);
    }
  });
});
