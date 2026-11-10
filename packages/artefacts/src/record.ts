/**
 * `artefacts` — the **record builder**.
 *
 * ## What this does
 *
 * It assembles a {@link RunRecord} from what the framework observed, and
 * computes the record's **content hash**.
 *
 * ## Why the builder exists at all
 *
 * The record has **twelve** elements, and they arrive from **seven**
 * different places: the identity from the control plane, the context from
 * the context assembler, the tool calls from the broker, the prompts from
 * the harness, the verification from the verify runtime, the cost from the
 * gateway, the policy decisions from the policy engine. If each of those
 * places assembled its own record fragment, the twelve elements would be
 * assembled **seven** times, and they would drift.
 *
 * So the assembly happens **once**, here, and it is **pure** — it reads no
 * clock, does no I/O, and mutates nothing. The store drives it.
 *
 * ## The hash
 *
 * blueprint 15 §2.4: "The artefact has a content hash; the merge approval
 * binds to the change artefact's hash, and the run artefact links to it."
 *
 * The hash is over the **canonical JSON** of the record's content — every
 * member except the hash itself. Two consequences follow, and both are
 * wanted:
 *
 * * the hash is **stable across key order** (AGENTS.md §4: "hashes over
 *   canonical JSON only"), so a record assembled twice hashes the same;
 * * the hash is a function of the **content**, so changing any element
 *   changes the hash — which is what makes it a witness to the content.
 *
 * ## Why the record is hashed *after* redaction
 *
 * The hash is computed over the **stored** record — the redacted one. A
 * hash over the unredacted content would be a digest of bytes that were
 * never written, so it could not be verified against the object in the
 * store. The redaction is part of the record, not a transformation applied
 * to it afterwards.
 */

import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

import type {
  RunRecord,
  RunRecordContent,
  VerificationResult,
  ProducedArtefact,
  ToolCallRecord,
} from './types.js';

/**
 * The digest form the record's hash takes — `sha256:<64 hex>`.
 */
export type RecordDigest = `sha256:${string}`;

/**
 * The content hash of a record.
 *
 * @param content the record's content — every member but `sha256`.
 * @returns the digest, in the `sha256:<64 hex>` form.
 */
export const hashRecordContent = (content: RunRecordContent): RecordDigest =>
  `sha256:${sha256(canonicalJsonOfUnknown(content))}`;

/**
 * The content hash of a **whole** record.
 *
 * Strips the hash member first, so the result is the same digest the
 * builder produced. A record whose stored hash does not match this is a
 * record whose content was changed after it was sealed — which is exactly
 * what the verification is for.
 */
export const hashRecord = (record: RunRecord): RecordDigest => {
  const { sha256: _sealed, ...content } = record;
  void _sealed;
  return hashRecordContent(content as RunRecordContent);
};

/**
 * Whether a record's stored hash matches its content.
 *
 * @param record the record to check.
 */
export const recordHashVerifies = (record: RunRecord): boolean =>
  record.sha256 === hashRecord(record);

/**
 * The inputs the builder assembles a record from.
 *
 * Everything is **already redacted** by the time it reaches here: the
 * redaction pipeline (`redaction.ts`) runs at capture, before the builder.
 * The builder's job is assembly, not scrubbing — a builder that scrubbed
 * would make the *stored* bytes depend on the order in which the fields
 * happened to be visited.
 */
export interface RecordParts {
  /** Element 1. */
  readonly identity: RunRecord['identity'];
  /** Element 2. */
  readonly context: RunRecord['context'];
  /** Element 3. */
  readonly configuration: RunRecord['configuration'];
  /** The run's nodes. */
  readonly nodes: RunRecord['nodes'];
  /** Element 5 — prompts and generated text. */
  readonly prompts: RunRecord['prompts'];
  /** Element 8. */
  readonly outcome: RunRecord['outcome'];
  /** Element 9. */
  readonly authority: RunRecord['authority'];
  /** Element 10. */
  readonly cost: RunRecord['cost'];
  /** Element 11. */
  readonly budget: RunRecord['budget'];
  /** Element 12. */
  readonly policyDecisions: RunRecord['policyDecisions'];
  /** The redaction receipt. */
  readonly redaction: RunRecord['redaction'];
  /** The retention class and expiry. */
  readonly retention: RunRecord['retention'];
  /** When the run started. */
  readonly startedAt: string;
  /** When the run completed. */
  readonly completedAt: string;
}

/**
 * Assemble a {@link RunRecord} from its parts.
 *
 * Elements 4, 6 and 7 are **flattened** from the nodes: the record carries
 * the tool calls, the verification results and the produced artefacts both
 * per-node (where they happened) and at the top level (where a reader
 * looks for them). blueprint 15 §2.3 puts them per-node; §2.2 lists them
 * as record elements. Carrying both is the only way to satisfy both
 * readings, and the two copies are the same objects.
 *
 * The hash is computed **last**, over the assembled content.
 */
export const buildRecord = (parts: RecordParts): RunRecord => {
  const toolCalls: ToolCallRecord[] = [];
  const verification: VerificationResult[] = [];
  const artefacts: ProducedArtefact[] = [];

  for (const node of parts.nodes) {
    toolCalls.push(...node.toolCalls);
    verification.push(...node.verification);
    artefacts.push(...node.artefacts);
  }

  const content: RunRecordContent = {
    identity: parts.identity,
    context: parts.context,
    configuration: parts.configuration,
    nodes: parts.nodes,
    toolCalls,
    prompts: parts.prompts,
    verification,
    artefacts,
    outcome: parts.outcome,
    authority: parts.authority,
    cost: parts.cost,
    budget: parts.budget,
    policyDecisions: parts.policyDecisions,
    redaction: parts.redaction,
    retention: parts.retention,
    startedAt: parts.startedAt,
    completedAt: parts.completedAt,
  };

  return { ...content, sha256: hashRecordContent(content) };
};

/**
 * A **partial** record — what an incremental write holds.
 *
 * blueprint 15 §2.4: "Incremental | Partial artefacts are written during
 * the run, so a killed run still leaves a record."
 *
 * A partial record has everything the framework has observed **so far**,
 * and the elements it has not reached yet are **absent** — not empty
 * arrays pretending to be "no tool calls". The distinction matters: an
 * empty array means *"there were none"*; an absent member means *"we never
 * got there"*. A killed run's partial record must say the second, or a
 * reader would conclude the run made no tool calls when in fact it was
 * killed before it made any.
 */
export type PartialRunRecord = Partial<RunRecordContent> & {
  /** The run's id — the one thing a partial record always has. */
  readonly runId: string;
  /** The hash of the partial content. */
  readonly sha256?: RecordDigest;
};
