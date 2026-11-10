/**
 * T-1.08 — the **subset JSON Schema validator**.
 *
 * ## Why the validator is written in-repo
 *
 * HR-6 forbids a new dependency without an ADR, and the owner chose to
 * write the validator here rather than add one. `ajv` is not resolvable in
 * this workspace, and `ajv@6` — present only as ESLint's transitive
 * dependency — does not support draft 2020-12, which is the dialect
 * `packages/contracts` emits.
 *
 * So the validator supports the subset the factory actually uses and
 * **fails closed on anything outside it**.
 *
 * ## The fail-closed rule is the whole point
 *
 * A validator that ignores an unknown keyword is a validator that can be
 * *made* to accept a payload it should refuse. If a schema says
 * `{"type": "string", "unevaluatedProperties": false}` and the validator
 * does not know `unevaluatedProperties`, then a validator that skips
 * unknown keywords would accept a payload carrying a property the schema
 * meant to forbid — and a schema that *relied* on the keyword would be
 * silently weaker than it reads.
 *
 * So an unknown keyword is an **error**, not a no-op. That is what the
 * first test asserts, and it is the reason the rule exists.
 *
 * ## What else matters here
 *
 * * `undefined` accepts anything — a capability that declares no schema
 *   accepts any arguments, and the broker does not invent a schema the
 *   capability did not declare.
 * * The composition keywords (`allOf`, `anyOf`, `oneOf`, `not`) are
 *   real assertions, not annotations: a payload that satisfies `oneOf`
 *   twice must be **refused**.
 * * `multipleOf` compares through a rounding step, so floating-point noise
 *   does not make a valid multiple fail.
 */

import { describe, expect, it } from 'vitest';

import { validate } from '../../packages/broker/src/schema/json-schema.ts';

/**
 * Whether a value validates.
 */
const accepts = (schema: unknown, value: unknown): boolean =>
  validate(schema, value).valid;

/**
 * The error messages a validation produced.
 */
const errorsOf = (schema: unknown, value: unknown): readonly string[] => {
  const result = validate(schema, value);
  return result.valid ? [] : result.errors;
};

describe('T-1.08 — the JSON Schema subset validator', () => {
  describe('the fail-closed rule', () => {
    it('refuses a schema that uses an unknown keyword', () => {
      const result = validate({ type: 'string', unevaluatedProperties: false }, 'x');

      expect(result.valid).toBe(false);
      expect(result.valid === false && result.errors[0]).toContain('unevaluatedProperties');
    });

    it('refuses a schema that uses an unknown keyword even when the value would pass', () => {
      // The value is a perfectly good string. The **schema** is refused,
      // because a schema the validator does not fully understand is a
      // schema whose guarantees are unknown.
      expect(accepts({ type: 'string', madeUpKeyword: true }, 'x')).toBe(false);
    });

    it('refuses a nested unknown keyword', () => {
      const schema = {
        type: 'object',
        properties: { inner: { type: 'string', unknownThing: 1 } },
      };

      expect(accepts(schema, { inner: 'x' })).toBe(false);
    });

    it('accepts every keyword it claims to support', () => {
      // The supported subset, exercised once each. If a keyword were
      // removed from `KNOWN_KEYWORDS` without the check being removed, this
      // test would fail.
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://example.test/s',
        $comment: 'a comment',
        title: 'a title',
        description: 'a description',
        default: {},
        examples: [{}],
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 10, pattern: '^[a-z]+$' },
          count: { type: 'integer', minimum: 0, maximum: 10, exclusiveMinimum: -1, exclusiveMaximum: 11, multipleOf: 2 },
          kind: { enum: ['a', 'b'] },
          fixed: { const: 'x' },
          tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, uniqueItems: true },
        },
        required: ['name'],
        additionalProperties: false,
      };

      expect(accepts(schema, { name: 'abc', count: 4, kind: 'a', fixed: 'x', tags: ['q'] })).toBe(true);
    });
  });

  describe('the types', () => {
    it('accepts each type it knows', () => {
      expect(accepts({ type: 'string' }, 'x')).toBe(true);
      expect(accepts({ type: 'number' }, 1.5)).toBe(true);
      expect(accepts({ type: 'integer' }, 2)).toBe(true);
      expect(accepts({ type: 'boolean' }, true)).toBe(true);
      expect(accepts({ type: 'null' }, null)).toBe(true);
      expect(accepts({ type: 'object' }, {})).toBe(true);
      expect(accepts({ type: 'array' }, [])).toBe(true);
    });

    it('refuses a value of the wrong type', () => {
      expect(accepts({ type: 'string' }, 1)).toBe(false);
      expect(accepts({ type: 'integer' }, 1.5)).toBe(false);
      expect(accepts({ type: 'object' }, [])).toBe(false);
      expect(accepts({ type: 'array' }, {})).toBe(false);
      expect(accepts({ type: 'null' }, undefined)).toBe(false);
    });

    it('accepts a union type', () => {
      expect(accepts({ type: ['string', 'null'] }, 'x')).toBe(true);
      expect(accepts({ type: ['string', 'null'] }, null)).toBe(true);
      expect(accepts({ type: ['string', 'null'] }, 1)).toBe(false);
    });

    it('refuses a schema naming an unknown type', () => {
      const result = validate({ type: 'strng' }, 'x');

      expect(result.valid).toBe(false);
      expect(result.valid === false && result.errors[0]).toContain('unknown type');
    });

    it('refuses a schema whose type is not a string', () => {
      // A malformed schema must be reported as malformed, not flow into
      // the type check as an `any` that matches everything.
      expect(accepts({ type: 42 }, 'x')).toBe(false);
    });
  });

  describe('the string constraints', () => {
    it('applies minLength and maxLength', () => {
      expect(accepts({ type: 'string', minLength: 2 }, 'ab')).toBe(true);
      expect(accepts({ type: 'string', minLength: 2 }, 'a')).toBe(false);
      expect(accepts({ type: 'string', maxLength: 2 }, 'ab')).toBe(true);
      expect(accepts({ type: 'string', maxLength: 2 }, 'abc')).toBe(false);
    });

    it('applies pattern', () => {
      expect(accepts({ type: 'string', pattern: '^[a-z]+$' }, 'abc')).toBe(true);
      expect(accepts({ type: 'string', pattern: '^[a-z]+$' }, 'ABC')).toBe(false);
    });
  });

  describe('the number constraints', () => {
    it('applies minimum and maximum', () => {
      expect(accepts({ type: 'number', minimum: 1 }, 1)).toBe(true);
      expect(accepts({ type: 'number', minimum: 1 }, 0)).toBe(false);
      expect(accepts({ type: 'number', maximum: 1 }, 1)).toBe(true);
      expect(accepts({ type: 'number', maximum: 1 }, 2)).toBe(false);
    });

    it('applies exclusiveMinimum and exclusiveMaximum', () => {
      expect(accepts({ type: 'number', exclusiveMinimum: 1 }, 1)).toBe(false);
      expect(accepts({ type: 'number', exclusiveMinimum: 1 }, 1.1)).toBe(true);
      expect(accepts({ type: 'number', exclusiveMaximum: 1 }, 1)).toBe(false);
      expect(accepts({ type: 'number', exclusiveMaximum: 1 }, 0.9)).toBe(true);
    });

    it('applies multipleOf without tripping on floating-point noise', () => {
      expect(accepts({ type: 'number', multipleOf: 2 }, 4)).toBe(true);
      expect(accepts({ type: 'number', multipleOf: 2 }, 5)).toBe(false);
      // 0.3 / 0.1 is 2.9999999999999996 in IEEE 754. The rounding step
      // makes the valid multiple pass.
      expect(accepts({ type: 'number', multipleOf: 0.1 }, 0.3)).toBe(true);
    });
  });

  describe('the array constraints', () => {
    it('applies items, minItems and maxItems', () => {
      const schema = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 };
      expect(accepts(schema, ['a'])).toBe(true);
      expect(accepts(schema, ['a', 'b'])).toBe(true);
      expect(accepts(schema, [])).toBe(false);
      expect(accepts(schema, ['a', 'b', 'c'])).toBe(false);
      expect(accepts(schema, ['a', 1])).toBe(false);
    });

    it('applies uniqueItems', () => {
      expect(accepts({ type: 'array', uniqueItems: true }, ['a', 'b'])).toBe(true);
      expect(accepts({ type: 'array', uniqueItems: true }, ['a', 'a'])).toBe(false);
      expect(accepts({ type: 'array', uniqueItems: true }, [{ x: 1 }, { x: 1 }])).toBe(false);
      expect(accepts({ type: 'array', uniqueItems: true }, [{ x: 1 }, { x: 2 }])).toBe(true);
    });
  });

  describe('the object constraints', () => {
    it('applies properties and required', () => {
      const schema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      };
      expect(accepts(schema, { a: 'x' })).toBe(true);
      expect(accepts(schema, {})).toBe(false);
      expect(accepts(schema, { a: 1 })).toBe(false);
    });

    it('applies additionalProperties: false', () => {
      const schema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
      };
      expect(accepts(schema, { a: 'x' })).toBe(true);
      expect(accepts(schema, { a: 'x', b: 1 })).toBe(false);
    });

    it('applies a schema as additionalProperties', () => {
      const schema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: { type: 'number' },
      };
      expect(accepts(schema, { a: 'x', b: 1 })).toBe(true);
      expect(accepts(schema, { a: 'x', b: 'no' })).toBe(false);
    });
  });

  describe('the composition keywords', () => {
    it('applies allOf as a conjunction', () => {
      const schema = {
        allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }],
      };
      expect(accepts(schema, { a: 1, b: 2 })).toBe(true);
      expect(accepts(schema, { a: 1 })).toBe(false);
    });

    it('applies anyOf as a disjunction', () => {
      const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
      expect(accepts(schema, 'x')).toBe(true);
      expect(accepts(schema, 1)).toBe(true);
      expect(accepts(schema, true)).toBe(false);
    });

    it('applies oneOf as an exclusive disjunction', () => {
      // A payload that satisfies **both** branches must be refused: `oneOf`
      // means exactly one.
      const schema = { oneOf: [{ type: 'number' }, { type: 'number', minimum: 0 }] };
      expect(accepts(schema, -1)).toBe(true);
      expect(accepts(schema, 1)).toBe(false);
    });

    it('applies not', () => {
      const schema = { not: { type: 'string' } };
      expect(accepts(schema, 1)).toBe(true);
      expect(accepts(schema, 'x')).toBe(false);
    });
  });

  describe('the enum and const keywords', () => {
    it('applies enum', () => {
      expect(accepts({ enum: ['a', 'b'] }, 'a')).toBe(true);
      expect(accepts({ enum: ['a', 'b'] }, 'c')).toBe(false);
    });

    it('applies const structurally', () => {
      expect(accepts({ const: { x: 1 } }, { x: 1 })).toBe(true);
      expect(accepts({ const: { x: 1 } }, { x: 2 })).toBe(false);
    });
  });

  describe('the no-schema case', () => {
    it('accepts anything when the schema is undefined', () => {
      // A capability that declares no schema accepts any arguments, and
      // the broker does not invent a schema the capability did not declare.
      expect(accepts(undefined, { anything: true })).toBe(true);
      expect(accepts(undefined, 'a string')).toBe(true);
      expect(accepts(undefined, null)).toBe(true);
    });
  });

  describe('the error messages', () => {
    it('names the path of the offending property', () => {
      const schema = {
        type: 'object',
        properties: { outer: { type: 'object', properties: { inner: { type: 'string' } } } },
      };

      const errors = errorsOf(schema, { outer: { inner: 1 } });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('$.outer.inner');
    });

    it('names the index of the offending array item', () => {
      const schema = { type: 'array', items: { type: 'string' } };

      const errors = errorsOf(schema, ['a', 2]);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('$[1]');
    });
  });
});
