/**
 * `gateway` — the portable structured output.
 *
 * ## The mechanism
 *
 * pack 02 §4.7: *"`responseFormat: json-schema` is implemented portably
 * (forced single tool call whose input schema is the JSON schema) or
 * with the provider's native structured outputs when available
 * `[VERIFY]`; the result is always **re-validated with Zod**; one
 * repair attempt counts as a retry."*
 *
 * So the **portable** mechanism is a *forced single tool call* whose
 * input schema **is** the caller's JSON schema. The provider is told
 * to call exactly one tool, and the tool's arguments are the answer.
 *
 * That is portable because every provider can be told to call a tool;
 * not every provider can be told to "return JSON" in the same way.
 *
 * The provider-*native* mechanism is **not** implemented here — whether
 * it is available, and what it costs, are the findings of spike **S-6**
 * ("Structured output portability | T-1.10 | forced tool call vs native
 * structured output on both providers; invalid-JSON rate; token
 * overhead"). Implementing it against unconfirmed facts is the mistake
 * this ticket exists not to make; the gap is escalated in
 * `docs/escalations/T-1.10-structured-output-portability-spike-s6.md`.
 *
 * ## The Zod revalidation is not optional
 *
 * A provider that was told to call a tool with a JSON schema will
 * *usually* produce a value matching it. "Usually" is the problem: the
 * gateway hands the result to the caller, and a caller that trusted a
 * malformed answer would act on it.
 *
 * So the value is **re-validated with Zod** against the caller's schema
 * after it comes back. The provider's word is not the schema's word.
 *
 * ## One repair attempt is one retry
 *
 * pack 02 §4.7: *"one repair attempt counts as a retry."*
 *
 * So an invalid result gets **one** repair — a second call, with the
 * validation failure fed back so the model can correct itself. A second
 * invalid result is not repaired again: the trigger is
 * `schema-invalid-twice` and the outcome is `model.reasoning`.
 *
 * The count is **exactly two attempts in total** — the original and one
 * repair. "Twice" means the second attempt failed, not the third.
 */

import type { z } from 'zod';

import type { ModelRequest, ToolSpec, ToolUse } from '@factory/contracts';

/**
 * The name of the forced tool the gateway builds for a structured
 * request.
 *
 * It is a **constant**, not a model id — the gateway never names a
 * model (INV-9), and the forced tool's name is part of the mechanism,
 * not of the configuration.
 */
export const FORCED_TOOL_NAME = 'structured_output';

/**
 * The instruction the gateway puts in the forced tool's description.
 */
export const FORCED_TOOL_DESCRIPTION =
  'Return the answer as the arguments of this call. The arguments must match the schema exactly.';

/**
 * The number of attempts a structured request gets: the original, plus
 * one repair.
 */
export const STRUCTURED_ATTEMPTS = 2;

/**
 * Build the forced tool call for a structured request.
 *
 * The tool's input schema **is** the request's JSON schema. The
 * provider is then told to call exactly this one tool.
 *
 * @param request the model request.
 * @returns the tool to offer, or `undefined` when the request does not
 * ask for a structured answer.
 */
export const forcedToolFor = (request: ModelRequest): ToolSpec | undefined => {
  if (request.responseFormat === undefined) {
    return undefined;
  }
  return {
    name: FORCED_TOOL_NAME,
    description: FORCED_TOOL_DESCRIPTION,
    inputSchema: request.responseFormat.schema,
  };
};

/**
 * The tools to offer the provider.
 *
 * The forced tool is **added** to the request's own tools, and it is
 * added **last** — so the provider's own tools keep their positions and
 * the forced one is the final, obvious choice.
 */
export const toolsFor = (request: ModelRequest): readonly ToolSpec[] | undefined => {
  const forced = forcedToolFor(request);
  if (forced === undefined) {
    return request.tools;
  }
  return [...(request.tools ?? []), forced];
};

/**
 * The result of validating a structured answer.
 */
export type StructuredValidation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * Extract the structured answer from a provider's response.
 *
 * The answer is the **forced tool call's input**. A response that made
 * no tool call, or that called some other tool, has no answer — and a
 * response that called the forced tool *and* said something else is
 * still the forced tool's input that counts, because the provider was
 * told to call exactly one tool.
 *
 * @param toolCalls the provider's tool calls.
 */
export const extractStructured = (
  toolCalls: readonly ToolUse[] | undefined,
): StructuredValidation => {
  if (toolCalls === undefined || toolCalls.length === 0) {
    return {
      ok: false,
      reason: 'the provider made no tool call, so there is no structured answer',
    };
  }

  const forced = toolCalls.find((call) => call.name === FORCED_TOOL_NAME);

  if (forced === undefined) {
    return {
      ok: false,
      reason: `the provider called no "${FORCED_TOOL_NAME}" tool`,
    };
  }

  return { ok: true, value: forced.input };
};

/**
 * Re-validate a structured answer with Zod.
 *
 * @param schema the caller's Zod schema.
 * @param value the answer the provider produced.
 */
export const revalidate = (
  schema: z.ZodType,
  value: unknown,
): StructuredValidation => {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

  return {
    ok: false,
    reason: `the structured answer does not match the schema: ${issues}`,
  };
};

/**
 * The repair instruction fed back to the model.
 *
 * It names **what** was wrong, so the repair is a correction rather
 * than another attempt at the same thing.
 */
export const repairInstruction = (reason: string): string =>
  `Your previous answer was rejected: ${reason}. Call ${FORCED_TOOL_NAME} again with a corrected answer.`;

/**
 * The failure class for a structured answer that failed twice.
 *
 * The ticket's oracle: *"invalid structured output twice ⇒
 * `model.reasoning`."* The class is `model.reasoning` and not
 * `model.capability` because the failure is in **what the model
 * produced**, not in what it was asked to do.
 */
export const STRUCTURED_FAILURE_CLASS = 'model.reasoning';

/**
 * The failover trigger for a structured answer that failed twice.
 *
 * pack 03 §4.6 names it: `failover: { on: [provider-error,
 * rate-limited, schema-invalid-twice], neverOn: [budget-exhausted] }`.
 *
 * The trigger is **carried by the error**, so the failover loop
 * consults the policy about *this* failure. Without it, a schema
 * failure would be mistaken for a provider error — and a policy that
 * forbids `schema-invalid-twice` failover would not be obeyed.
 */
export const SCHEMA_INVALID_TRIGGER = 'schema-invalid-twice';
