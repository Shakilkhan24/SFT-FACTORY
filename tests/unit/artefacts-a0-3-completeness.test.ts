/**
 * The **completeness assertion** — A0.3.
 *
 * blueprint 16 §3.5: "| A0.3 | A run produces a complete artefact with
 * every one of the 12 required elements | MEAS-01's completeness
 * assertion |".
 *
 * The assertion is not "the record exists". It is *every one of the
 * twelve* — and the distinction between **present** and **non-empty** is
 * what makes it usable, because some elements are legitimately empty.
 */

import { describe, expect, it } from 'vitest';

import {
  ELEMENT_NUMBERS,
  MAY_BE_EMPTY,
  REQUIRED_ELEMENTS,
  assertComplete,
  buildRecord,
  incompletenessMessage,
  isComplete,
  type RunRecord,
} from '../../packages/artefacts/src/index.ts';

import { THE_RECORD, parts } from '../helpers/artefacts.ts';

/**
 * A record with one element removed.
 *
 * The element is removed **entirely** — not set to `undefined` — because
 * "the element is absent" and "the element is present and undefined" are
 * different states, and the assertion must catch the first.
 */
const without = (element: string): RunRecord => {
  const copy = { ...THE_RECORD } as Record<string, unknown>;
  delete copy[element];
  return copy as unknown as RunRecord;
};

/**
 * A record with one element emptied.
 *
 * The element is **present** but carries nothing.
 */
const emptied = (element: string): RunRecord => {
  const copy = { ...THE_RECORD } as Record<string, unknown>;
  copy[element] = '';
  return copy as unknown as RunRecord;
};

describe('A0.3 · the completeness assertion', () => {
  it('passes for a record with every one of the twelve elements', () => {
    const report = assertComplete(THE_RECORD);
    expect(report.complete).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.elements.length).toBe(12);
  });

  it('fails for a record missing any one of the twelve elements', () => {
    // Every element is checked, not just a sample. A completeness
    // assertion that only checks some of the twelve is not the criterion.
    for (const element of REQUIRED_ELEMENTS) {
      const report = assertComplete(without(element));
      expect(report.complete, `the assertion missed the missing "${element}"`).toBe(false);
      expect(report.missing).toContain(element);
    }
  });

  it('names the missing element and its number in the blueprint’s list', () => {
    // blueprint 15 §2.2 numbers the elements, so a report that says
    // "element 7 missing" identifies which one without a lookup.
    const report = assertComplete(without('artefacts'));
    expect(report.missing).toEqual(['artefacts']);
    expect(report.elements.find((e) => e.element === 'artefacts')?.number).toBe(7);
    expect(incompletenessMessage(report)).toContain('element 7 (artefacts)');
  });

  it('numbers the elements as blueprint 15 §2.2 does', () => {
    // The **literal** numbers, not the constant against itself. A test that
    // asserts `ELEMENT_NUMBERS.x === ELEMENT_NUMBERS.x` notices nothing
    // when the numbering drifts; this one notices.
    expect(ELEMENT_NUMBERS).toEqual({
      identity: 1,
      context: 2,
      configuration: 3,
      toolCalls: 4,
      prompts: 5,
      verification: 6,
      artefacts: 7,
      outcome: 8,
      authority: 9,
      cost: 10,
      budget: 11,
      policyDecisions: 12,
    });
  });

  it('fails for a record whose single-valued element is present but empty', () => {
    // An outcome with an empty status is not "there were no outcomes" —
    // it is an outcome that was never set.
    for (const element of ['identity', 'context', 'configuration', 'outcome', 'cost', 'budget']) {
      const report = assertComplete(emptied(element));
      expect(report.complete, `the assertion missed the empty "${element}"`).toBe(false);
    }
  });

  it('accepts a legitimately-empty list element', () => {
    // A run with no tool calls has an empty list. That is a *fact*, not a
    // gap, and forcing every run to invent a tool call would write a lie
    // into the factory's source of truth.
    const noToolCalls = {
      ...THE_RECORD,
      toolCalls: [],
      nodes: THE_RECORD.nodes.map((node) => ({ ...node, toolCalls: [] })),
    };
    const report = assertComplete(noToolCalls);
    expect(report.complete).toBe(true);
  });

  it('names the list elements that may be empty, and only those', () => {
    // The exemption is a decision on the record, not an accident of the
    // type — so it is asserted.
    expect([...MAY_BE_EMPTY].sort()).toEqual([
      'artefacts',
      'authority',
      'policyDecisions',
      'prompts',
      'toolCalls',
      'verification',
    ]);
  });

  it('reports a present-but-empty list element as present and empty', () => {
    // The report distinguishes the two states, so a reader can tell
    // "there were none" from "we never got there".
    const noToolCalls = { ...THE_RECORD, toolCalls: [] };
    const verdict = assertComplete(noToolCalls).elements.find((e) => e.element === 'toolCalls');
    expect(verdict?.present).toBe(true);
    expect(verdict?.nonEmpty).toBe(false);
    expect(verdict?.reason).toBeUndefined();
  });

  it('is false for an incomplete record and true for a complete one', () => {
    expect(isComplete(THE_RECORD)).toBe(true);
    expect(isComplete(without('outcome'))).toBe(false);
  });

  it('does not fail on a record whose parts are all present', () => {
    // A sanity check on the fixture itself: the reference record the rest
    // of the suite is built on must be complete, or every other test
    // would be asserting against a broken baseline.
    expect(assertComplete(buildRecord(parts())).complete).toBe(true);
  });
});
