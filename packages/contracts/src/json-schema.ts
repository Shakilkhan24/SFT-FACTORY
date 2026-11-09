/**
 * A minimal Zod → JSON Schema (draft 2020-12) emitter.
 *
 * pack 03 §3: "Rules: Zod schemas are the source of truth → TS types + JSON
 * Schema are derived." checklist 02 T-1.01: "`packages/contracts` — Zod
 * schemas for every item in `03` §3–§7. **Export JSON Schema to
 * `/schemas`**."
 *
 * Why not `zod-to-json-schema`: the emitter needs to be *pure* (it lives in
 * `contracts`, which may not do I/O) and the output needs to be stable and
 * reviewable — the exported schemas are a contract artefact that humans read.
 * A hand-written emitter for the subset of Zod this package uses is smaller
 * than the dependency and produces exactly the shape we want.
 *
 * The subset supported is the one the contracts actually use:
 * `string` (with `regex`/`min`/`max`), `number` (with `int`/`min`/`max`),
 * `boolean`, `null`, `literal`, `enum`, `union`, `array`, `object`, `record`,
 * `unknown`, `never`, `optional`, `nullable`, `default`.
 */

import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

const isZodType = (value: unknown): value is z.ZodTypeAny =>
  typeof value === 'object' &&
  value !== null &&
  '_def' in value &&
  typeof (value as { _def?: unknown })._def === 'object';

/**
 * Convert a Zod schema into a JSON Schema document.
 *
 * @param schema the Zod schema
 * @param options `name` sets the `$id`; `ref` sets the `$ref` used for
 *   recursive references.
 */
export const toJsonSchema = (
  schema: z.ZodTypeAny,
  options: { readonly name?: string; readonly ref?: string } = {},
): JsonSchema => {
  const out = convert(schema);

  if (typeof out !== 'object' || out === null || Array.isArray(out)) {
    return { $schema: DIALECT, ...(options.name === undefined ? {} : { $id: options.name }), type: 'object' };
  }

  const document: JsonSchema = { $schema: DIALECT };

  if (options.name !== undefined) {
    document['$id'] = options.name;
  }

  for (const [key, value] of Object.entries(out)) {
    document[key] = value;
  }

  return document;
};

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const withNullable = (schema: JsonSchema): JsonSchema => {
  const existing = schema['type'];
  if (existing === undefined) {
    return { anyOf: [schema, { type: 'null' }] };
  }
  if (Array.isArray(existing)) {
    const widened: string[] = [];
    for (const member of existing) {
      if (typeof member === 'string') {
        widened.push(member);
      }
    }
    widened.push('null');
    return { ...schema, type: widened };
  }
  if (typeof existing !== 'string') {
    return { anyOf: [schema, { type: 'null' }] };
  }
  return { ...schema, type: [existing, 'null'] };
};

const convert = (schema: z.ZodTypeAny): JsonSchema => {
  if (!isZodType(schema)) {
    return {};
  }

  const def = schema._def as z.ZodTypeDef & {
    typeName?: string;
    type?: z.ZodTypeAny;
    innerType?: z.ZodTypeAny;
    schema?: z.ZodTypeAny;
    typeOf?: z.ZodTypeAny;
    options?: z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>;
    values?: unknown[];
    value?: unknown;
    valueType?: z.ZodTypeAny;
    unknownKeys?: string;
    shape?: () => Record<string, z.ZodTypeAny>;
    checks?: { kind: string; value?: number; regex?: RegExp }[];
    description?: string;
    defaultValue?: () => unknown;
    nullable?: boolean;
  };

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const out: JsonSchema = { type: 'string' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'regex' && check.regex !== undefined) {
          out['pattern'] = check.regex.source;
        }
        if (check.kind === 'min' && typeof check.value === 'number') {
          out['minLength'] = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          out['maxLength'] = check.value;
        }
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const out: JsonSchema = { type: 'number' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'int') {
          out['type'] = 'integer';
        }
        if (check.kind === 'min' && typeof check.value === 'number') {
          out['minimum'] = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          out['maximum'] = check.value;
        }
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean' };

    case z.ZodFirstPartyTypeKind.ZodNull:
      return { type: 'null' };

    case z.ZodFirstPartyTypeKind.ZodUndefined:
      return { not: {} };

    case z.ZodFirstPartyTypeKind.ZodAny:
    case z.ZodFirstPartyTypeKind.ZodUnknown:
      return {};

    case z.ZodFirstPartyTypeKind.ZodNever:
      return { not: {} };

    case z.ZodFirstPartyTypeKind.ZodLiteral: {
      const value = def.value;
      if (typeof value === 'string') {
        return { const: value };
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { const: value };
      }
      return {};
    }

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: 'string', enum: [...(def.values ?? [])] };

    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return { type: 'string', enum: Object.values(def.values ?? {}) };

    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options = (def.options ?? []) as z.ZodTypeAny[];
      return { anyOf: options.map((option) => convert(option)) };
    }

    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const options = (def.options ?? []) as z.ZodTypeAny[];
      return { anyOf: options.map((option) => convert(option)) };
    }

    case z.ZodFirstPartyTypeKind.ZodArray: {
      const out: JsonSchema = { type: 'array' };
      if (def.type !== undefined) {
        out['items'] = convert(def.type);
      }
      for (const check of def.checks ?? []) {
        if (check.kind === 'min' && typeof check.value === 'number') {
          out['minItems'] = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          out['maxItems'] = check.value;
        }
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!isOptionalSchema(value)) {
          required.push(key);
        }
      }
      const out: JsonSchema = { type: 'object', properties };
      if (required.length > 0) {
        out['required'] = required;
      }
      // `.strict()` — the Zod `unknownKeys` discriminator is `'strict'` for
      // `.strict()`, `'passthrough'` for `.passthrough()`, `'strip'` for the
      // default.
      if (def.unknownKeys === 'strict') {
        out['additionalProperties'] = false;
      } else if (def.unknownKeys === 'passthrough') {
        out['additionalProperties'] = true;
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodRecord: {
      const out: JsonSchema = { type: 'object' };
      if (def.valueType !== undefined) {
        out['additionalProperties'] = convert(def.valueType);
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodOptional: {
      const inner = def.innerType;
      return inner === undefined ? {} : convert(inner);
    }

    case z.ZodFirstPartyTypeKind.ZodNullable: {
      const inner = def.innerType;
      const converted = inner === undefined ? {} : convert(inner);
      return withNullable(converted);
    }

    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const inner = def.innerType;
      const converted = inner === undefined ? {} : convert(inner);
      const value = def.defaultValue?.();
      if (value === undefined) {
        return converted;
      }
      return { ...converted, default: value };
    }

    case z.ZodFirstPartyTypeKind.ZodEffects: {
      const inner = def.schema;
      return inner === undefined ? {} : convert(inner);
    }

    default:
      return {};
  }
};

/**
 * Whether a schema is optional — i.e. its key is not required in the parent
 * object.
 */
const isOptionalSchema = (schema: z.ZodTypeAny): boolean => {
  if (!isZodType(schema)) {
    return false;
  }
  const def = schema._def as { typeName?: string; innerType?: z.ZodTypeAny };
  if (def.typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
    return true;
  }
  if (def.typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
    return true;
  }
  if (def.typeName === z.ZodFirstPartyTypeKind.ZodEffects) {
    const effect = (schema as unknown as { effect?: { type?: string } }).effect;
    if (effect?.type === 'optional') {
      return true;
    }
  }
  return false;
};
