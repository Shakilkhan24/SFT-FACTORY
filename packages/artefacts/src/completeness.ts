/**
 * `artefacts` — the **completeness assertion** (A0.3).
 *
 * ## The criterion
 *
 * blueprint 16 §3.5: "| A0.3 | A run produces a complete artefact with
 * every one of the 12 required elements | MEAS-01's completeness
 * assertion |".
 *
 * blueprint 15 §1.3 (O-1): "Every run produces a complete artefact record."
 *
 * So the assertion is **not** "the record exists". It is *every one of the
 * twelve*. A record missing element 7 is **incomplete**, and the writer
 * must refuse to finalise it.
 *
 * ## Present versus non-empty
 *
 * The distinction is the whole content of this module.
 *
 * * **Present** — the element is in the record at all.
 * * **Non-empty** — the element carries something.
 *
 * Some elements are *lists* that are legitimately empty: a run with no
 * tool calls, a run with no produced artefacts, a run with no policy
 * decisions. Forcing those to be non-empty would mean every run must
 * invent a tool call to satisfy the assertion — which would be a lie
 * written into the factory's source of truth.
 *
 * But some elements are **single values** that cannot be empty: the
 * identity, the context manifest, the configuration, the outcome, the
 * cost, the budget. An absent outcome means the run has not finished; an
 * outcome with an empty status means the outcome was never set. Both are
 * incomplete.
 *
 * So the rule is:
 *
 * * a **single-valued** element must be present **and** non-empty;
 * * a **list** element must be present — and a list that is *empty* is
 *   recorded as such, because "there were none" is a fact worth keeping.
 *
 * The elements that may be empty are named explicitly, so the exemption is
 * a decision on the record rather than an accident of the type.
 *
 * ## Why the assertion is *pure*
 *
 * It reads a record and answers a question. It does not write, and it does
 * not read a clock. The store calls it and decides what to do with the
 * answer; the oracle calls it and asserts.
 */

import {
  ELEMENT_NUMBERS,
  REQUIRED_ELEMENTS,
  type RequiredElement,
  type RunRecord,
} from './types.js';

/**
 * The elements that may be **present but empty**.
 *
 * Each is a list the corpus describes as a set of things that happened:
 *
 * * `toolCalls` — "every tool call" (element 4). A run that called no tool
 *   has an empty list, and that is true, not missing.
 * * `prompts` — "all prompts and generated text" (element 5). A
 *   deterministic stage generates no text.
 * * `verification` — "verification results, per layer" (element 6). A
 *   stage with no verification layer has none.
 * * `artefacts` — "artefacts produced" (element 7). A run that produced
 *   nothing has none.
 * * `authority` — "the approval and the authority" (element 9). A run that
 *   was never approved has none — and recording that is the point.
 * * `policyDecisions` — "policy decisions" (element 12). A run that
 *   consulted no policy has none.
 *
 * The **nodes** are not in the list. A run with no nodes is a run that
 * never started — and `nodes` is not one of the twelve anyway; it is the
 * blueprint's grouping, and elements 4, 6 and 7 are flattened out of it.
 */
export const MAY_BE_EMPTY: ReadonlySet<RequiredElement> = new Set<RequiredElement>([
  'toolCalls',
  'prompts',
  'verification',
  'artefacts',
  'authority',
  'policyDecisions',
]);

/**
 * One element's verdict.
 */
export interface ElementVerdict {
  /** The element's name. */
  readonly element: RequiredElement;
  /** The element's number in blueprint 15 §2.2. */
  readonly number: number;
  /** Whether the element is in the record at all. */
  readonly present: boolean;
  /** Whether the element carries content. */
  readonly nonEmpty: boolean;
  /** Why the element failed, when it did. */
  readonly reason?: string;
}

/**
 * The result of the completeness assertion.
 */
export interface CompletenessReport {
  /** Whether the record is complete. */
  readonly complete: boolean;
  /** Each element's verdict, in the blueprint's order. */
  readonly elements: readonly ElementVerdict[];
  /** The elements that failed, by name. */
  readonly missing: readonly RequiredElement[];
}

/**
 * Is a value "non-empty" for the purposes of an element?
 *
 * The rules differ by shape:
 *
 * * an **array** is non-empty when it has at least one element;
 * * an **object** is non-empty when it has at least one member — so an
 *   empty `{}` is empty;
 * * a **string** is non-empty when it is not `''`;
 * * a **number** is non-empty when it is not `0` — a cost of zero is a
 *   *value*, but the cost element has four token counts and three amounts,
 *   so the element as a whole is judged by its object shape;
 * * `null` and `undefined` are empty.
 */
const isNonEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return false;
};

/**
 * The element's value in the record, or `undefined` when it is absent.
 *
 * The twelve elements are read by name. `nodes` is not one of them, so a
 * record that has nodes but no flattened `toolCalls` has no element 4 —
 * which is correct: the flattened list is the element, and the per-node
 * copy is a convenience.
 */
const elementValue = (record: RunRecord, element: RequiredElement): unknown =>
  (record as unknown as Record<string, unknown>)[element];

/**
 * Assert that a record carries every one of the twelve elements.
 *
 * @param record the record to check.
 * @returns the report — `complete` is true when every element is present,
 * and every element that may not be empty is non-empty.
 */
export const assertComplete = (record: RunRecord): CompletenessReport => {
  const elements: ElementVerdict[] = [];
  const missing: RequiredElement[] = [];

  for (const element of REQUIRED_ELEMENTS) {
    const value = elementValue(record, element);
    const present = value !== undefined && value !== null;
    const mayBeEmpty = MAY_BE_EMPTY.has(element);
    // `nonEmpty` reports the **fact** — does the element carry content? —
    // not the verdict. A list that is present and empty is *not* non-empty,
    // even though its emptiness is permitted. The verdict is decided by the
    // two checks below, and `reason` says which one failed.
    const nonEmpty = present && isNonEmpty(value);

    let reason: string | undefined;
    if (!present) {
      reason = `element ${String(ELEMENT_NUMBERS[element])} (${element}) is absent`;
    } else if (!mayBeEmpty && !nonEmpty) {
      reason = `element ${String(ELEMENT_NUMBERS[element])} (${element}) is empty`;
    }

    if (reason !== undefined) {
      missing.push(element);
    }

    elements.push({
      element,
      number: ELEMENT_NUMBERS[element],
      present,
      nonEmpty,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  return { complete: missing.length === 0, elements, missing };
};

/**
 * Whether a record is complete.
 *
 * A thin wrapper over {@link assertComplete}, for the call sites that only
 * want the answer.
 */
export const isComplete = (record: RunRecord): boolean => assertComplete(record).complete;

/**
 * The message the store refuses with when a record is incomplete.
 *
 * It names the missing elements **and their numbers**, because a report
 * that says "element 7 missing" tells a reader which of the twelve it is
 * without consulting the blueprint.
 */
export const incompletenessMessage = (report: CompletenessReport): string => {
  if (report.complete) {
    return 'the record is complete';
  }
  const described = report.missing
    .map((element) => `element ${String(ELEMENT_NUMBERS[element])} (${element})`)
    .join(', ');
  return `the run record is incomplete: ${described}`;
};
