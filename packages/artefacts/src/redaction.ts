/**
 * `artefacts` — **redaction at capture**.
 *
 * blueprint 15 §2.4: "Redacted at capture | Secrets are redacted **at
 * capture time**, not at query time. A stored artefact never held secret
 * material."
 *
 * ## The rule is about the *stored* bytes
 *
 * The strongest form of the rule has a testable consequence: the record
 * **in the object store** contains no secret. Not "the secret is masked
 * when it is read back" — masked on read means the bytes on disk held the
 * secret, and a compromised bucket holds the secret.
 *
 * So the redaction happens **before** the record is written, and the
 * written bytes are the redacted ones.
 *
 * ## The two pipelines, and why both are needed
 *
 * pack 02 §4.11 names three layers:
 *
 * 1. exact-match scrub of the task's minted secrets;
 * 2. pattern scrub (token formats, private keys, JWTs, high-entropy strings
 *    near `key|token|secret|password`);
 * 3. deny-listed env names.
 *
 * The **first and third** are `packages/credentials`' `RedactionRegistry`'s
 * job — it is a *textual* pass over a string, and it knows the task's
 * minted secrets exactly.
 *
 * The **second** is `packages/eventlog`'s `redactorFor`'s job — it is a
 * *structural* pass over a JSON value: it replaces the values of sensitive
 * **key names** wholesale and reports the **paths** it touched.
 *
 * Both are needed because they catch different things:
 *
 * * a **prompt** is a string. The event log's redactor walks JSON, so it
 *   would redact a prompt only if the prompt sat under a sensitive *key*.
 *   The registry's pattern layer is what catches a token pasted into a
 *   prompt.
 * * a **tool call's arguments** are a structure. The registry's
 *   `scrubJson` walks the strings inside it, but it does not know that a
 *   member called `authorization` is secret regardless of its value. The
 *   structural pass does.
 *
 * So the record's redaction is the **composition** of the two, and the
 * receipt records which layer caught what.
 *
 * ## What the receipt carries
 *
 * blueprint 15 §2.5: "The redaction is itself recorded — `redaction.applied`
 * and `redaction.policyRef` — so a reader knows that something was removed
 * rather than assuming it was never there."
 *
 * The receipt carries the **path**, the **rule** and a **digest** of the
 * removed value. Never the value. A receipt that named the secret would be
 * a second copy of the secret, stored beside the record it protects.
 */

import type { RedactionRegistry } from '@factory/credentials';
import { redactorFor, type RedactionPolicy } from '@factory/eventlog';

import type { AppliedRedaction, RedactionReceipt } from './types.js';

/**
 * The outcome of a capture-time redaction pass.
 *
 * The receipt is *part of the record*, not a side-channel: it travels with
 * the redacted content, so a reader can never see redacted content without
 * also seeing that it was redacted.
 */
export interface CaptureRedaction {
  /** The receipt — what was removed, and under which policy. */
  readonly receipt: RedactionReceipt;
  /** The redacted record. */
  readonly value: unknown;
}

/**
 * The redaction rules the receipt names.
 *
 * These are the registry's rule names — `exact.minted`, `pattern.token`,
 * `deny.env-name` and so on — plus the structural pass's own name.
 */
export const STRUCTURAL_RULE = 'structure.sensitive-key';

/**
 * The policy the structural pass runs under when the caller gives none.
 *
 * `packages/eventlog`'s `defaultRedactionPolicy()` supplies the sensitive
 * key names and the deny-listed env names; this is the same default with
 * the policy's own reference, so the receipt names the policy that ran.
 */
export const DEFAULT_CAPTURE_POLICY_REF = 'redaction.v1';

/**
 * The structural policy for a capture-time pass.
 *
 * @param secrets the task's minted secrets — the exact-match layer.
 * @param policyRef the policy identifier the receipt names.
 */
export const capturePolicy = (
  secrets: readonly string[] = [],
  policyRef: string = DEFAULT_CAPTURE_POLICY_REF,
): RedactionPolicy => ({
  policyRef,
  secrets: [...secrets],
});

/**
 * Redact a value at capture time.
 *
 * The pass is **pure** — it takes a value and returns a redacted value
 * plus the receipt. It performs no I/O and reads no clock.
 *
 * @param value the value to redact.
 * @param registry the task's redaction registry — the textual pass.
 * @param policy the structural policy — the JSON pass.
 *
 * @returns the redacted value and the receipt.
 */
export const redactAtCapture = (
  value: unknown,
  registry: RedactionRegistry,
  policy: RedactionPolicy = capturePolicy(),
): CaptureRedaction => {
  const applied: AppliedRedaction[] = [];

  // ---- Pass 1: the textual pass (the registry) ---------------------------
  // `scrubJson` walks the structure and scrubs every string it finds. It
  // reports the *rule* and a *digest* of the removed value, but not the
  // path — so the path is reconstructed by walking the same structure.
  const scrubbed = registry.scrubJson(value);
  collectPaths(value, scrubbed.value, '', applied, scrubbed.applied, { index: 0 });

  // ---- Pass 2: the structural pass (sensitive key names) -----------------
  // The structural redactor replaces the values of sensitive keys wholesale
  // and reports the paths it touched. It runs on the *already* textually
  // scrubbed value, so a value caught by the cheap exact-match layer is not
  // re-examined by the structural one.
  const structural = redactorFor(policy);
  const structuralResult = structural(scrubbed.value as never);

  for (const path of structuralResult.applied) {
    applied.push({
      path,
      rule: STRUCTURAL_RULE,
      // The digest of the *replaced* value is not carried by the structural
      // redactor, so the receipt records the path and the rule — which is
      // what an auditor needs: they learn that something was removed and
      // which layer removed it.
      digest: '',
    });
  }

  return {
    receipt: { applied, policyRef: policy.policyRef },
    value: structuralResult.value,
  };
};

/**
 * Walk the original and the scrubbed values together, recording **where**
 * each textual redaction happened.
 *
 * The registry reports *what* it removed (a rule and a digest) but not
 * *where*. So the two trees are walked in step: a member whose scrubbed
 * value differs from the original's is a place a redaction happened.
 *
 * The walk is over the **original** structure, because that is the
 * structure the path names refer to.
 *
 * ## Why the cursor is shared
 *
 * The registry's report is a **flat list**, and the registry's own walk
 * visits members in a fixed order — object keys in insertion order, array
 * elements in index order. So the report's *n*-th entry belongs to the
 * *n*-th changed member this walk finds.
 *
 * The cursor therefore has to be **one cursor for the whole walk**, not
 * one per branch. A cursor per branch would restart at the first rule in
 * every sub-tree, and the second secret in a record would be reported
 * with the first secret's rule.
 *
 * @param original the value before scrubbing.
 * @param scrubbed the value after scrubbing.
 * @param path the path to the current node.
 * @param applied the receipt being built.
 * @param rules the registry's report, in the order it produced them.
 * @param cursor the shared position in `rules`. Mutated as the walk goes.
 */
const collectPaths = (
  original: unknown,
  scrubbed: unknown,
  path: string,
  applied: AppliedRedaction[],
  rules: readonly { readonly rule: string; readonly digest: string }[],
  cursor: { index: number },
): void => {
  const takeRule = (): { readonly rule: string; readonly digest: string } | undefined => {
    const rule = rules[cursor.index];
    if (rule === undefined) {
      return undefined;
    }
    cursor.index += 1;
    return rule;
  };

  if (typeof original === 'string') {
    if (original !== scrubbed) {
      const rule = takeRule();
      applied.push({
        path: path === '' ? '<root>' : path,
        rule: rule?.rule ?? 'exact.minted',
        digest: rule?.digest ?? '',
      });
    }
    return;
  }

  if (Array.isArray(original) && Array.isArray(scrubbed)) {
    original.forEach((item, index) => {
      collectPaths(
        item,
        scrubbed[index],
        `${path}[${String(index)}]`,
        applied,
        rules,
        cursor,
      );
    });
    return;
  }

  if (
    original !== null &&
    scrubbed !== null &&
    typeof original === 'object' &&
    typeof scrubbed === 'object'
  ) {
    const source = original as Record<string, unknown>;
    const target = scrubbed as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      collectPaths(
        source[key],
        target[key],
        path === '' ? key : `${path}.${key}`,
        applied,
        rules,
        cursor,
      );
    }
  }
};

/**
 * A receipt for a record that was **not** redacted.
 *
 * Used when a caller has no registry — but the receipt is still written,
 * with an empty `applied` list, so a reader can tell "nothing was
 * redacted" from "redaction was never attempted". That distinction is
 * `packages/eventlog`'s `noopRedactor`'s point, and it applies here too.
 */
export const emptyReceipt = (
  policyRef: string = DEFAULT_CAPTURE_POLICY_REF,
): RedactionReceipt => ({ applied: [], policyRef });
