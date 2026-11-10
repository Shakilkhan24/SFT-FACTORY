/**
 * T-1.10 — the portable structured output.
 *
 * pack 02 §4.7: *"`responseFormat: json-schema` is implemented portably
 * (forced single tool call whose input schema is the JSON schema) or
 * with the provider's native structured outputs when available
 * `[VERIFY]`; the result is always **re-validated with Zod**; one
 * repair attempt counts as a retry."*
 *
 * ## The ticket's oracle
 *
 * *"invalid structured output twice ⇒ `model.reasoning`"*
 *
 * ## What these tests hold
 *
 * 1. **The forced tool call is built** — one tool, whose input schema
 *    **is** the request's JSON schema.
 * 2. **The forced tool is offered** to the provider.
 * 3. **The answer is re-validated with Zod** — a provider's word is
 *    not the schema's word.
 * 4. **One invalid answer is repaired once** — the repair feeds the
 *    validation failure back to the model.
 * 5. **Two invalid answers ⇒ `model.reasoning`** — and the provider
 *    was asked **exactly twice**, not three times.
 * 6. **A valid answer is not repaired.**
 */

import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import {
  extractStructured,
  FORCED_TOOL_NAME,
  forcedToolFor,
  revalidate,
  repairInstruction,
  STRUCTURED_ATTEMPTS,
  STRUCTURED_FAILURE_CLASS,
  toolsFor,
} from '../../packages/gateway/src/index.ts';

import { aRequest, buildGateway, THE_POLICY } from '../helpers/gateway.ts';

/**
 * The schema a structured request asks for.
 */
const ANSWER = z.object({
  verdict: z.enum(['pass', 'fail']),
  note: z.string().min(1),
});

/**
 * A request that asks for a structured answer.
 */
const aStructuredRequest = (overrides: Parameters<typeof aRequest>[0] = {}) =>
  aRequest({
    responseFormat: {
      kind: 'json-schema',
      name: 'answer',
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['pass', 'fail'] },
          note: { type: 'string' },
        },
        required: ['verdict', 'note'],
      },
    },
    ...overrides,
  });

describe('T-1.10 — the structured output', () => {
  describe('the forced tool call', () => {
    it('is BUILT for a request that asks for a structured answer', () => {
      const request = aStructuredRequest();

      const tool = forcedToolFor(request);

      expect(tool).toBeDefined();
      expect(tool?.name).toBe(FORCED_TOOL_NAME);
    });

    it('carries the request’s JSON schema as its INPUT schema', () => {
      // "forced single tool call whose input schema is the JSON
      // schema" — the schema is the *tool's* schema, not a note in
      // the description.
      const request = aStructuredRequest();

      const tool = forcedToolFor(request);

      expect(tool?.inputSchema).toEqual(request.responseFormat?.schema);
    });

    it('is NOT built for a request that asks for no structured answer', () => {
      expect(forcedToolFor(aRequest())).toBeUndefined();
    });

    it('is OFFERED to the provider', () => {
      const request = aStructuredRequest();

      const tools = toolsFor(request);

      expect(tools?.some((tool) => tool.name === FORCED_TOOL_NAME)).toBe(true);
    });

    it('is offered LAST, so the provider’s own tools keep their places', () => {
      const request = aStructuredRequest({
        tools: [{ name: 'a-tool', description: 'd', inputSchema: {} }],
      });

      const tools = toolsFor(request);

      expect(tools?.[0]?.name).toBe('a-tool');
      expect(tools?.[tools.length - 1]?.name).toBe(FORCED_TOOL_NAME);
    });
  });

  describe('extracting the answer', () => {
    it('is the forced tool call’s input', () => {
      const extracted = extractStructured([
        { id: 'call_1', name: FORCED_TOOL_NAME, input: { verdict: 'pass' } },
      ]);

      expect(extracted.ok).toBe(true);
      expect(extracted.ok && extracted.value).toEqual({ verdict: 'pass' });
    });

    it('fails when the provider made NO tool call', () => {
      expect(extractStructured([]).ok).toBe(false);
      expect(extractStructured(undefined).ok).toBe(false);
    });

    it('fails when the provider called a DIFFERENT tool', () => {
      const extracted = extractStructured([
        { id: 'call_1', name: 'some_other_tool', input: {} },
      ]);

      expect(extracted.ok).toBe(false);
    });
  });

  describe('the Zod revalidation', () => {
    it('PASSES a value that matches the schema', () => {
      const validated = revalidate(ANSWER, { verdict: 'pass', note: 'ok' });

      expect(validated.ok).toBe(true);
    });

    it('REFUSES a value that does not match the schema', () => {
      const validated = revalidate(ANSWER, { verdict: 'maybe', note: 'ok' });

      expect(validated.ok).toBe(false);
    });

    it('REFUSES a value that is missing a field', () => {
      const validated = revalidate(ANSWER, { verdict: 'pass' });

      expect(validated.ok).toBe(false);
    });

    it('says WHAT was wrong, so the repair can be a correction', () => {
      const validated = revalidate(ANSWER, { verdict: 'maybe' });

      expect(validated.ok === false && validated.reason).toContain('verdict');
    });
  });

  describe('the gateway’s structured path', () => {
    it('gets EXACTLY two attempts — the original and one repair', () => {
      // pack 02 §4.7: "one repair attempt counts as a retry." So the
      // attempt count is **two** — the original and one repair — and
      // "twice" means the second attempt failed, not the third.
      //
      // The other assertions in this file use the literal `2` rather
      // than this constant, on purpose: a constant asserted against
      // itself cannot notice itself changing. This test pins the
      // constant to the corpus's number.
      expect(STRUCTURED_ATTEMPTS).toBe(2);
    });

    it('returns the VALIDATED answer', async () => {
      const { gateway } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'pass', note: 'looks right' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.json).toEqual({
        verdict: 'pass',
        note: 'looks right',
      });
    });

    it('REPAIRS an invalid answer exactly once', async () => {
      // The fake answers the same thing every time, so the repair also
      // fails — and the point of the count is that the provider was
      // asked **twice**, not three times.
      const { gateway, alpha } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(false);
      // The literal **2**, not `STRUCTURED_ATTEMPTS` — asserting the
      // constant would assert the constant against itself, and a change
      // to the constant would move the expectation with it. pack 02
      // §4.7: "one repair attempt counts as a retry" — the original and
      // one repair, and no third.
      expect(alpha.callCount).toBe(2);
    });

    it('feeds the validation failure back to the model', async () => {
      // "one repair attempt counts as a retry" — a retry that says
      // nothing about what went wrong is just the same call again.
      const { gateway, alpha } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      await gateway.complete(aStructuredRequest());

      const repair = alpha.calls[1]?.request.messages.at(-1);
      expect(repair?.content).toContain('rejected');
    });

    it('does NOT repair a valid answer', async () => {
      const { gateway, alpha } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'pass', note: 'ok' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(true);
      expect(alpha.callCount).toBe(1);
    });

    it('REFUSES a request with no schema configured', async () => {
      // The gateway cannot validate what it has no schema for, so it
      // refuses rather than passing the answer through unchecked.
      const { gateway } = buildGateway({
        alpha: { structuredAnswer: { verdict: 'pass', note: 'ok' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe(
        'workflow.composition',
      );
    });
  });

  describe('an invalid answer twice', () => {
    it('is `model.reasoning`', async () => {
      // The ticket's oracle, verbatim.
      const { gateway } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe(
        STRUCTURED_FAILURE_CLASS,
      );
      expect(result.ok === false && result.error.class).toBe(
        'model.reasoning',
      );
    });

    it('names the attempt count in the detail', async () => {
      const { gateway } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      // The literal **2**, not `STRUCTURED_ATTEMPTS` — the detail must
      // report the corpus's count, and asserting the constant would
      // move the expectation with any change to it.
      expect(result.ok === false && result.error.detail?.['attempts']).toBe(2);
    });

    it('says WHY it failed', async () => {
      const { gateway } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok === false && result.error.message).toContain('verdict');
    });

    it('DOES fail over — the model answered, wrongly', async () => {
      // blueprint 08: "`model.reasoning` | The agent produced an
      // incorrect or incomplete result given correct context and
      // correct tools. | Retry with a **different model** or a
      // different decomposition." And pack 03 §4.6 lists
      // `schema-invalid-twice` in `failover.on`.
      //
      // So a schema failure *does* fail over — the second provider is
      // a different model. What it must not do is succeed with an
      // unvalidated answer.
      const { gateway, beta } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
        beta: { structuredAnswer: { verdict: 'also-wrong' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(false);
      // The fallback gets the **same** two attempts — the original and
      // one repair — before it is declared a failure. The literal **2**,
      // not the constant: asserting the constant against itself would
      // not notice the constant changing.
      expect(beta.callCount).toBe(2);
    });

    it('is `model.reasoning` after EVERY candidate has failed', async () => {
      // FI-8: "Provider returns schema-invalid output twice |
      // `model.reasoning` failure; bounded retries." The failure is
      // classified as `model.reasoning` — the failure is in what the
      // model produced, not in what it was asked to do.
      const { gateway } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
        beta: { structuredAnswer: { verdict: 'also-wrong' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe(
        'model.reasoning',
      );
    });

    it('does NOT fail over when the policy says neverOn', async () => {
      // The policy decides — pack 03 §4.6's `neverOn` is the corpus's
      // example. A policy that declares `schema-invalid-twice` in
      // `neverOn` gets exactly that.
      const { gateway, beta } = buildGateway({
        policy: {
          ...THE_POLICY,
          spec: {
            ...THE_POLICY.spec,
            failover: {
              on: ['provider-error', 'schema-invalid-twice'],
              neverOn: ['budget-exhausted', 'schema-invalid-twice'],
            },
          },
        },
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      const result = await gateway.complete(aStructuredRequest());

      expect(result.ok).toBe(false);
      expect(beta.callCount).toBe(0);
    });

    it('records NO model call', async () => {
      // The provider was called, but the call produced nothing the
      // factory can bill as work done.
      const { gateway, calls } = buildGateway({
        structuredSchema: ANSWER,
        alpha: { structuredAnswer: { verdict: 'maybe' } },
      });

      await gateway.complete(aStructuredRequest());

      expect(calls.records).toHaveLength(0);
    });
  });

  describe('the repair instruction', () => {
    it('names the tool to call again', () => {
      const instruction = repairInstruction('verdict was wrong');

      expect(instruction).toContain(FORCED_TOOL_NAME);
    });

    it('carries the reason', () => {
      const instruction = repairInstruction('verdict was wrong');

      expect(instruction).toContain('verdict was wrong');
    });
  });
});
