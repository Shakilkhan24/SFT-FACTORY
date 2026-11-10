/**
 * The JSON Schema subset validator.
 *
 * ## Why it is written here rather than depended on
 *
 * HR-6 (boring technology) forbids a new dependency without an ADR, and the
 * owner chose — for this ticket — to write the validator in-repo rather than
 * add one. `ajv` is not resolvable in this workspace, and `ajv@6` (which is
 * only present as ESLint's transitive dependency) does not support draft
 * 2020-12, which is the dialect `packages/contracts` emits.
 *
 * So the validator supports the subset the factory actually uses, and
 * **fails closed on anything outside it**.
 *
 * ## The fail-closed rule
 *
 * A validator that ignores an unknown keyword is a validator that can be
 * *made* to accept a payload it should refuse. If a schema says
 * `{"type": "string", "unevaluatedProperties": false}` and the validator
 * does not know `unevaluatedProperties`, then a validator that skips unknown
 * keywords would accept `{"type": "string", "unevaluatedProperties": false}`
 * — and, worse, a schema that *relied* on the keyword would be silently
 * weaker than it reads.
 *
 * So: **an unknown keyword is an error**, not a no-op. The schema is
 * rejected at registry-load time, before it can guard anything, and the
 * capability that declares it is unavailable.
 *
 * ## The supported subset
 *
 * * **types** — `string`, `number`, `integer`, `boolean`, `null`, `object`,
 *   `array`, and the `type: [...]` union form.
 * * **string** — `minLength`, `maxLength`, `pattern`, `enum`, `const`.
 * * **number** — `minimum`, `maximum`, `exclusiveMinimum`,
 *   `exclusiveMaximum`, `multipleOf`.
 * * **array** — `items`, `minItems`, `maxItems`, `uniqueItems`.
 * * **object** — `properties`, `required`, `additionalProperties`.
 * * **composition** — `allOf`, `anyOf`, `oneOf`, `not`.
 * * **annotations** — `$schema`, `$id`, `title`, `description`, `default`,
 *   `examples`, `$comment`.
 *
 * Everything else is an unknown keyword and is refused.
 */

/**
 * The result of validating a value against a schema.
 */
export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

/**
 * The keywords the validator understands.
 *
 * The list is closed on purpose — see the fail-closed rule above.
 */
const KNOWN_KEYWORDS: ReadonlySet<string> = new Set([
  // annotations
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  // type
  'type',
  'enum',
  'const',
  // string
  'minLength',
  'maxLength',
  'pattern',
  // number
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  // array
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  // object
  'properties',
  'required',
  'additionalProperties',
  // composition
  'allOf',
  'anyOf',
  'oneOf',
  'not',
]);

/**
 * The type names the validator understands.
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'object',
  'array',
]);

/**
 * The keywords that may appear *inside* a schema object.
 *
 * `$ref` is deliberately absent: resolving a `$ref` needs a document
 * resolver, and a resolver that resolves against the *filesystem* would be
 * I/O inside the broker. The registry resolves refs **before** the schema
 * reaches the validator, so a `$ref` reaching the validator is a bug, and
 * an unknown keyword is the right way to say so.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate a value against a schema.
 *
 * @param schema the schema. `undefined` accepts anything — a capability
 *   that declares no `inputSchema` accepts any arguments, and the broker
 *   does not invent a schema the capability did not declare.
 * @param value the value to validate.
 * @param path the JSON pointer prefix for the error messages.
 */
export const validate = (
  schema: unknown,
  value: unknown,
  path = '$',
): ValidationResult => {
  // A capability with no schema accepts anything. This is the definition's
  // own choice, recorded as such.
  if (schema === undefined) {
    return { valid: true };
  }

  const errors: string[] = [];
  check(schema, value, path, errors);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
};

/**
 * The check proper.
 */
const check = (
  schema: unknown,
  value: unknown,
  path: string,
  errors: string[],
): void => {
  if (!isPlainObject(schema)) {
    errors.push(`${path}: the schema is not an object`);
    return;
  }

  // The fail-closed rule: an unknown keyword is an error.
  for (const keyword of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(keyword)) {
      errors.push(`${path}: the schema uses the unknown keyword "${keyword}"`);
    }
  }

  for (const [keyword, keywordValue] of Object.entries(schema)) {
    switch (keyword) {
      case 'type':
        checkType(keywordValue, value, path, errors);
        break;
      case 'enum':
        checkEnum(keywordValue, value, path, errors);
        break;
      case 'const':
        if (!deepEqual(keywordValue, value)) {
          errors.push(`${path}: expected the constant ${render(keywordValue)}`);
        }
        break;
      case 'minLength':
        if (typeof value === 'string' && typeof keywordValue === 'number') {
          if (value.length < keywordValue) {
            errors.push(`${path}: the string is shorter than ${keywordValue} characters`);
          }
        }
        break;
      case 'maxLength':
        if (typeof value === 'string' && typeof keywordValue === 'number') {
          if (value.length > keywordValue) {
            errors.push(`${path}: the string is longer than ${keywordValue} characters`);
          }
        }
        break;
      case 'pattern':
        if (typeof value === 'string' && typeof keywordValue === 'string') {
          if (!new RegExp(keywordValue).test(value)) {
            errors.push(`${path}: the string does not match the pattern ${keywordValue}`);
          }
        }
        break;
      case 'minimum':
        if (typeof value === 'number' && typeof keywordValue === 'number') {
          if (value < keywordValue) {
            errors.push(`${path}: the number is below the minimum ${keywordValue}`);
          }
        }
        break;
      case 'maximum':
        if (typeof value === 'number' && typeof keywordValue === 'number') {
          if (value > keywordValue) {
            errors.push(`${path}: the number is above the maximum ${keywordValue}`);
          }
        }
        break;
      case 'exclusiveMinimum':
        if (typeof value === 'number' && typeof keywordValue === 'number') {
          if (value <= keywordValue) {
            errors.push(`${path}: the number is not above the exclusive minimum ${keywordValue}`);
          }
        }
        break;
      case 'exclusiveMaximum':
        if (typeof value === 'number' && typeof keywordValue === 'number') {
          if (value >= keywordValue) {
            errors.push(`${path}: the number is not below the exclusive maximum ${keywordValue}`);
          }
        }
        break;
      case 'multipleOf':
        if (typeof value === 'number' && typeof keywordValue === 'number' && keywordValue !== 0) {
          // The quotient is compared through a rounding step so that
          // floating-point noise does not make a valid multiple fail.
          const quotient = value / keywordValue;
          if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
            errors.push(`${path}: the number is not a multiple of ${keywordValue}`);
          }
        }
        break;
      case 'items':
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            check(keywordValue, item, `${path}[${index}]`, errors);
          });
        }
        break;
      case 'minItems':
        if (Array.isArray(value) && typeof keywordValue === 'number') {
          if (value.length < keywordValue) {
            errors.push(`${path}: the array has fewer than ${keywordValue} items`);
          }
        }
        break;
      case 'maxItems':
        if (Array.isArray(value) && typeof keywordValue === 'number') {
          if (value.length > keywordValue) {
            errors.push(`${path}: the array has more than ${keywordValue} items`);
          }
        }
        break;
      case 'uniqueItems':
        if (Array.isArray(value) && keywordValue === true) {
          const seen = new Set<string>();
          for (const item of value) {
            const key = JSON.stringify(item);
            if (seen.has(key)) {
              errors.push(`${path}: the array's items are not unique`);
              break;
            }
            seen.add(key);
          }
        }
        break;
      case 'properties':
        if (isPlainObject(value) && isPlainObject(keywordValue)) {
          for (const [name, propertySchema] of Object.entries(keywordValue)) {
            if (name in value) {
              check(propertySchema, value[name], `${path}.${name}`, errors);
            }
          }
        }
        break;
      case 'required':
        if (isPlainObject(value) && Array.isArray(keywordValue)) {
          for (const name of keywordValue) {
            if (typeof name === 'string' && !(name in value)) {
              errors.push(`${path}: the required property "${name}" is missing`);
            }
          }
        }
        break;
      case 'additionalProperties':
        checkAdditionalProperties(keywordValue, schema, value, path, errors);
        break;
      case 'allOf':
        if (Array.isArray(keywordValue)) {
          for (const subSchema of keywordValue) {
            check(subSchema, value, path, errors);
          }
        }
        break;
      case 'anyOf':
        if (Array.isArray(keywordValue)) {
          const matched = keywordValue.some(
            (subSchema) => validate(subSchema, value, path).valid,
          );
          if (!matched) {
            errors.push(`${path}: the value matches none of the anyOf schemas`);
          }
        }
        break;
      case 'oneOf':
        if (Array.isArray(keywordValue)) {
          const matched = keywordValue.filter(
            (subSchema) => validate(subSchema, value, path).valid,
          ).length;
          if (matched !== 1) {
            errors.push(`${path}: the value matches ${matched} oneOf schemas, expected exactly one`);
          }
        }
        break;
      case 'not':
        if (validate(keywordValue, value, path).valid) {
          errors.push(`${path}: the value matches a schema it must not match`);
        }
        break;
      default:
        // The annotation keywords carry no assertion.
        break;
    }
  }
};

/**
 * The `additionalProperties` check.
 *
 * `false` forbids any property not named in `properties`; `true` allows
 * them; and a schema validates each extra property against it.
 */
const checkAdditionalProperties = (
  additional: unknown,
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  errors: string[],
): void => {
  if (!isPlainObject(value)) {
    return;
  }
  const properties = isPlainObject(schema['properties']) ? schema['properties'] : {};
  const extras = Object.keys(value).filter((name) => !(name in properties));

  if (additional === false) {
    for (const name of extras) {
      errors.push(`${path}: the property "${name}" is not allowed`);
    }
    return;
  }

  if (isPlainObject(additional)) {
    for (const name of extras) {
      check(additional, value[name], `${path}.${name}`, errors);
    }
  }
};

/**
 * The `type` check.
 */
const checkType = (
  expected: unknown,
  value: unknown,
  path: string,
  errors: string[],
): void => {
  const raw = Array.isArray(expected) ? expected : [expected];

  // The names are narrowed to strings first: a `type` that is not a string
  // is a malformed schema, and it must be reported as such rather than
  // flowing into the type check as an `any`.
  const names: string[] = [];
  for (const name of raw) {
    if (typeof name !== 'string') {
      errors.push(`${path}: the schema's "type" is not a string`);
      return;
    }
    if (!KNOWN_TYPES.has(name)) {
      errors.push(`${path}: the schema names the unknown type "${name}"`);
      return;
    }
    names.push(name);
  }

  if (!names.some((name) => matchesType(name, value))) {
    errors.push(
      `${path}: expected ${names.map((name) => render(name)).join(' or ')}, got ${typeOf(value)}`,
    );
  }
};

/**
 * Whether a value has a JSON type.
 */
const matchesType = (name: string, value: unknown): boolean => {
  switch (name) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    default:
      // An unknown type cannot match. The keyword check already reported
      // it; this keeps the type check from passing vacuously.
      return false;
  }
};

/**
 * The `enum` check.
 */
const checkEnum = (
  allowed: unknown,
  value: unknown,
  path: string,
  errors: string[],
): void => {
  if (!Array.isArray(allowed)) {
    errors.push(`${path}: the schema's "enum" is not an array`);
    return;
  }
  if (!allowed.some((candidate) => deepEqual(candidate, value))) {
    errors.push(
      `${path}: expected one of ${allowed.map((candidate) => render(candidate)).join(', ')}`,
    );
  }
};

/**
 * The JSON type of a value, for the error messages.
 */
const typeOf = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
};

/**
 * Structural equality, for `const` and `enum`.
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key, index) => key === bKeys[index]) &&
      aKeys.every((key) => deepEqual(a[key], b[key]))
    );
  }
  return false;
};

/**
 * Render a value for an error message.
 */
const render = (value: unknown): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return JSON.stringify(value) ?? String(value);
};
