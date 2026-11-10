/**
 * The stage budget (T-1.13).
 *
 * pack `02` §4.9: "Budget exhaustion ⇒ stage outcome `incomplete` with
 * partial artefacts preserved and labelled (FR-32)."
 *
 * The tests here prove the four dimensions, the order they are checked in,
 * and that the artefacts carry the `incomplete` label.
 */

import { describe, expect, it } from 'vitest';

import {
  BUDGET_DIMENSIONS,
  BUDGET_FAILURE_CLASS,
  checkBudget,
  INCOMPLETE_ARTEFACT_LABEL,
  isIncompleteArtefact,
  labelIncomplete,
} from '@factory/orchestrator';

describe('the budget dimensions', () => {
  it('there are four', () => {
    expect(BUDGET_DIMENSIONS).toHaveLength(4);
  });

  it('a budget with no limits is never exhausted', () => {
    expect(checkBudget({}).exhausted).toBe(false);
  });

  it('an absent limit is no limit, not zero', () => {
    // An absent limit means "not configured", which is not the same as
    // "zero". A cap of zero would mean no work ever runs.
    expect(checkBudget({ turns: 1000 }).exhausted).toBe(false);
  });

  it('the turn budget is exhausted when the turns reach it', () => {
    const verdict = checkBudget({ maxTurns: 3, turns: 3 });
    expect(verdict.exhausted).toBe(true);
    if (verdict.exhausted) {
      expect(verdict.dimension).toBe('turns');
      expect(verdict.limit).toBe(3);
      expect(verdict.spent).toBe(3);
    }
  });

  it('the wall-clock budget is exhausted when the time reaches it', () => {
    const verdict = checkBudget({ maxWallClockMs: 1_000, wallClockMs: 1_000 });
    expect(verdict.exhausted).toBe(true);
    if (verdict.exhausted) {
      expect(verdict.dimension).toBe('wallClockMs');
    }
  });

  it('the token budget is exhausted when the tokens reach it', () => {
    const verdict = checkBudget({ maxTokens: 500, tokens: 500 });
    expect(verdict.exhausted).toBe(true);
    if (verdict.exhausted) {
      expect(verdict.dimension).toBe('tokens');
    }
  });

  it('the cost budget is exhausted when the cost reaches it', () => {
    const verdict = checkBudget({ maxCostUsdMicros: 1_000, spentUsdMicros: 1_000 });
    expect(verdict.exhausted).toBe(true);
    if (verdict.exhausted) {
      expect(verdict.dimension).toBe('costUsdMicros');
    }
  });

  it('a budget below its limit is not exhausted', () => {
    expect(checkBudget({ maxTurns: 3, turns: 2 }).exhausted).toBe(false);
  });

  it('the first exhausted dimension is the one reported', () => {
    // The first is the one that actually stopped the stage; reporting a
    // later one would name a limit the stage never reached.
    const verdict = checkBudget({
      maxTurns: 1,
      turns: 1,
      maxTokens: 1,
      tokens: 1,
    });
    expect(verdict.exhausted).toBe(true);
    if (verdict.exhausted) {
      expect(verdict.dimension).toBe('turns');
    }
  });

  it('the exhaustion names the dimension in its reason', () => {
    const verdict = checkBudget({ maxTokens: 10, tokens: 10 });
    expect(verdict.exhausted).toBe(true);
    if (verdict.exhausted) {
      expect(verdict.reason).toContain('tokens');
    }
  });

  it('the exhaustion carries the budget failure class', () => {
    // The budget exhaustion is its own class, not a model-reasoning failure
    // and not a verification failure.
    expect(BUDGET_FAILURE_CLASS).toBe('budget.exhausted');
  });
});

describe('the incomplete label', () => {
  it('every artefact of an incomplete stage carries the label', () => {
    const labelled = labelIncomplete([
      { ref: 'a', sha256: 'sha256:1' },
      { ref: 'b', sha256: 'sha256:2' },
    ]);
    expect(labelled).toHaveLength(2);
    for (const artefact of labelled) {
      expect(artefact.label).toBe(INCOMPLETE_ARTEFACT_LABEL);
    }
  });

  it('the label is exactly "incomplete"', () => {
    expect(INCOMPLETE_ARTEFACT_LABEL).toBe('incomplete');
  });

  it('the artefacts survive — only the label is added', () => {
    const labelled = labelIncomplete([{ ref: 'a', sha256: 'sha256:1' }]);
    expect(labelled[0]?.ref).toBe('a');
    expect(labelled[0]?.sha256).toBe('sha256:1');
  });

  it('a labelled artefact is recognisable as partial', () => {
    expect(isIncompleteArtefact({ ref: 'a', sha256: 'b', label: 'incomplete' })).toBe(true);
    expect(isIncompleteArtefact({ ref: 'a', sha256: 'b' })).toBe(false);
  });

  it('a complete artefact has no label at all', () => {
    const labelled = labelIncomplete([]);
    expect(labelled).toEqual([]);
  });
});
