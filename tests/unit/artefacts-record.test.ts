/**
 * The run record's **assembly and hash**.
 *
 * blueprint 15 §2.2 lists the twelve elements; §2.3 gives the structure;
 * §2.4 says "The artefact has a content hash".
 *
 * The hash's three properties are what make it a witness to the content:
 *
 * * it is **stable** — the same facts hash the same, so a record can be
 *   re-derived;
 * * it is **independent of key order** — the hash is over canonical JSON;
 * * it **changes when any element changes** — so it is a witness.
 */

import { describe, expect, it } from 'vitest';

import {
  REQUIRED_ELEMENTS,
  buildRecord,
  hashRecord,
  hashRecordContent,
  recordHashVerifies,
} from '../../packages/artefacts/src/index.ts';

import { THE_PARTS, THE_RECORD, parts } from '../helpers/artefacts.ts';

describe('the run record', () => {
  it('carries every one of the twelve required elements', () => {
    // blueprint 15 §2.2 numbers twelve elements. The list is asserted
    // against the corpus's *count* — a constant asserted against itself
    // cannot notice itself changing.
    expect(REQUIRED_ELEMENTS.length).toBe(12);
    expect(new Set(REQUIRED_ELEMENTS).size).toBe(12);
  });

  it('carries each of the twelve elements as a member of the record', () => {
    for (const element of REQUIRED_ELEMENTS) {
      expect(
        Object.prototype.hasOwnProperty.call(THE_RECORD, element),
        `the record is missing the element "${element}"`,
      ).toBe(true);
    }
  });

  it('keeps the blueprint 15 §2.3 member names', () => {
    // The blueprint's structure is the record's structure, so a reader
    // holding the blueprint can read the record.
    expect(THE_RECORD.identity.runId).toBe('run_01JCZ8JYTESTRUN000000');
    expect(THE_RECORD.identity.workflow).toEqual({ id: 'wf_bugfix', version: '4' });
    expect(THE_RECORD.outcome.status).toBe('success');
    expect(THE_RECORD.outcome.failureClassification).toBeNull();
    expect(THE_RECORD.retention.class).toBe('engineering');
  });

  it('flattens the nodes’ tool calls, verification and artefacts to the top level', () => {
    // blueprint 15 §2.2 lists the tool calls, the verification results and
    // the produced artefacts as *record* elements; §2.3 puts them per node.
    // The record carries both, and the two copies are the same facts.
    expect(THE_RECORD.toolCalls.length).toBe(1);
    expect(THE_RECORD.toolCalls[0]?.capabilityId).toBe('repo.read');
    expect(THE_RECORD.verification.length).toBe(2);
    expect(THE_RECORD.verification[0]?.layer).toBe('acceptance');
    expect(THE_RECORD.artefacts.length).toBe(1);
    expect(THE_RECORD.artefacts[0]?.kind).toBe('patch');
  });

  it('records the verification authorship, because an agent’s layer is not trusted', () => {
    // blueprint 15 §2.2: "Verification results, per layer, with authorship
    // flags". The flag is the point — a trusted=false layer must say so.
    const byLayer = new Map(THE_RECORD.verification.map((v) => [v.layer, v]));
    expect(byLayer.get('acceptance')?.authoredBy).toBe('generator');
    expect(byLayer.get('acceptance')?.trusted).toBe(true);
    expect(byLayer.get('unit')?.authoredBy).toBe('agent');
    expect(byLayer.get('unit')?.trusted).toBe(false);
  });

  it('records the approval’s artefact hash, because the approval binds to the content', () => {
    // blueprint 15 §2.2: "The approval and the authority under which the
    // action occurred". The artefactSha256 is what binds the approval to
    // this exact change.
    expect(THE_RECORD.authority[0]?.action).toBe('merge');
    expect(THE_RECORD.authority[0]?.artefactSha256).toBe(THE_RECORD.artefacts[0]?.sha256);
  });

  it('records the cost in integer micro-USD', () => {
    // pack 04 §6: "Costs are integer micro-USD." A float would make the
    // cost a float computation, and the error lands on the budget check.
    expect(Number.isInteger(THE_RECORD.cost.totalUsdMicros)).toBe(true);
    expect(THE_RECORD.cost.totalUsdMicros).toBe(2_077_000);
  });
});

describe('the record’s content hash', () => {
  it('verifies against its own content', () => {
    expect(recordHashVerifies(THE_RECORD)).toBe(true);
  });

  it('is stable across key order', () => {
    // AGENTS.md §4: "hashes over canonical JSON only". The same facts in a
    // different key order must hash the same, or a re-derived record would
    // look like a changed one.
    //
    // The reordered object is built from the *record's own* members, so
    // the only thing that differs is the order they were inserted in.
    const { sha256: _sealed, ...content } = THE_RECORD;
    void _sealed;
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(content).reverse()) {
      reordered[key] = (content as Record<string, unknown>)[key];
    }

    expect(Object.keys(reordered)).not.toEqual(Object.keys(content));
    expect(hashRecordContent(reordered as never)).toBe(THE_RECORD.sha256);
  });

  it('changes when an element changes', () => {
    // The hash is a witness to the content. A changed element must change
    // it, or the hash would witness nothing.
    const changed = buildRecord(
      parts({ outcome: { status: 'failure', failureClassification: 'model.reasoning' } }),
    );
    expect(changed.sha256).not.toBe(THE_RECORD.sha256);
  });

  it('changes when a node’s tool call changes', () => {
    const nodes = THE_PARTS.nodes.map((node) => ({
      ...node,
      toolCalls: node.toolCalls.map((call) => ({ ...call, durationMs: call.durationMs + 1 })),
    }));
    const changed = buildRecord(parts({ nodes }));
    expect(changed.sha256).not.toBe(THE_RECORD.sha256);
  });

  it('is the digest of the record’s content, and not of itself', () => {
    // The hash member is excluded from the computation, so hashing the
    // record and hashing its content agree.
    expect(hashRecord(THE_RECORD)).toBe(THE_RECORD.sha256);
  });

  it('does not verify when the content was changed after sealing', () => {
    // The verification is what a reader runs against an object retrieved
    // from the store. A record whose content moved must fail it.
    const tampered = { ...THE_RECORD, outcome: { status: 'failure' as const, failureClassification: 'unknown' as const } };
    expect(recordHashVerifies(tampered)).toBe(false);
  });

  it('is in the sha256:<64 hex> form the contracts use', () => {
    expect(THE_RECORD.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
