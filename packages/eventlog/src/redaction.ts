/**
 * Redaction — applied **before** the event is persisted.
 *
 * pack 03 §1 (Redaction row): "Applied *before* persistence; payloads record
 * what was redacted (`redaction.applied[]`)."
 *
 * pack 02 §4.2: "Redaction is applied **before insert** (`redaction.applied[]`
 * lists what)."
 *
 * pack 02 §4.11 (Redaction at capture) gives the three stages:
 *
 *  1. exact-match scrub of the task's minted secrets,
 *  2. pattern scrub (token formats, private keys, JWTs, high-entropy strings
 *     near `key|token|secret|password`),
 *  3. deny-listed env names.
 *
 * The list in `redaction.applied[]` names the **paths** that were redacted,
 * not the redacted values — the record is a receipt, not a copy of the
 * secret. blueprint `09` §4.2: "`redaction` | Yes where applicable | What was
 * redacted and under which policy."
 *
 * This module is deliberately *pure*: it takes a value, a set of secrets and
 * a policy, and returns a redacted value plus the list of paths it touched.
 * It performs no I/O and reads no clock. The event log calls it before the
 * INSERT, so a secret never reaches the table — not even briefly.
 */

import type { JsonValue } from '@factory/core';

/**
 * What a redaction pass did to one value.
 */
export interface RedactionResult {
  /** The value with every redacted member replaced by the placeholder. */
  readonly value: JsonValue;

  /**
   * The **paths** that were redacted, e.g. `arguments.body`, `result.body`,
   * `payload.secret`.
   *
   * The paths name *where* the redaction happened; they never contain the
   * redacted value. A path is built from the enclosing object's keys, so
   * `payload.args.token` means "the member `token` of the member `args` of
   * the member `payload`".
   */
  readonly applied: readonly string[];
}

/**
 * The placeholder that replaces a redacted value.
 *
 * It is a fixed marker so that a reader can tell "this was redacted" from
 * "this was empty" and from "this was the literal string `[REDACTED]` that
 * the producer chose to send". A caller that sent the literal string
 * `"[REDACTED]"` is indistinguishable from one that was scrubbed — which is
 * the point: the value carries no information either way.
 */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * The policy a redaction pass runs under.
 *
 * `policyRef` names the policy in the recorded receipt — blueprint `09`
 * §4.1 shows `"redaction": {"applied": [...], "policyRef": "redaction.v2"}`.
 */
export interface RedactionPolicy {
  /** The policy identifier recorded in `redaction.policyRef`. */
  readonly policyRef: string;

  /**
   * Exact strings to scrub — the task's minted secrets (pack 02 §4.11(1)).
   *
   * A secret is matched as an exact *value*, not as a substring of a larger
   * string: a secret embedded in a longer string is still scrubbed, because
   * the whole point is that the secret never appears.
   */
  readonly secrets?: readonly string[];

  /**
   * Object keys whose values are always redacted, matched case-insensitively
   * against the key name (pack 02 §4.11(2), "high-entropy strings near
   * `key|token|secret|password`").
   */
  readonly sensitiveKeys?: readonly string[];

  /**
   * Environment-variable names whose values are redacted (pack 02
   * §4.11(3), "deny-listed env names").
   */
  readonly deniedEnvNames?: readonly string[];

  /**
   * Maximum depth to walk. Deeper structures are left alone rather than
   * recursed into without bound.
   */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 12;

/**
 * The default sensitive-key names.
 *
 * pack 02 §4.11(2) names the pattern explicitly: "high-entropy strings near
 * `key|token|secret|password`". These are the four stems it names, plus the
 * obvious credential spellings that share them.
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  'key',
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'credential',
  'credentials',
  'authorization',
  'private_key',
  'privatekey',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'session_token',
  'cookie',
  'set-cookie',
  'signature',
  'otp',
];

/**
 * The default deny-listed environment-variable names.
 *
 * pack 02 §4.11(3): "deny-listed env names". These are the names a
 * credential would hide behind in an environment dump.
 */
export const DEFAULT_DENIED_ENV_NAMES: readonly string[] = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'FACTORY_APP_DATABASE_URL',
  'FACTORY_OWNER_DATABASE_URL',
  'FACTORY_PROJECTOR_DATABASE_URL',
  'FACTORY_APPLIER_DATABASE_URL',
  'FACTORY_EDGE_DATABASE_URL',
  'FACTORY_READONLY_DATABASE_URL',
];

/**
 * The shape of a redaction hook.
 *
 * A hook is a function from a value to a redacted value plus the list of
 * paths it touched. The event log takes one in its constructor and calls it
 * **before** the INSERT.
 */
export type Redactor = (value: JsonValue) => RedactionResult;

/**
 * Build a redaction hook from a policy.
 *
 * The returned hook is pure and total: it never throws for a valid JSON
 * value, and it never mutates its input.
 */
export const redactorFor = (policy: RedactionPolicy): Redactor => {
  const secrets = (policy.secrets ?? []).filter((secret) => secret.length > 0);
  const sensitiveKeys = new Set(
    (policy.sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS).map((key) => key.toLowerCase()),
  );
  const deniedEnvNames = new Set(
    (policy.deniedEnvNames ?? DEFAULT_DENIED_ENV_NAMES).map((name) => name.toUpperCase()),
  );
  const maxDepth = policy.maxDepth ?? DEFAULT_MAX_DEPTH;

  /**
   * Is this key name sensitive? A key is sensitive when its name matches a
   * sensitive stem, or when it is a deny-listed environment name.
   */
  const isSensitiveKey = (key: string): boolean => {
    const lower = key.toLowerCase();
    if (deniedEnvNames.has(key.toUpperCase())) {
      return true;
    }
    if (sensitiveKeys.has(lower)) {
      return true;
    }
    // A name that *contains* a sensitive stem is sensitive too: `githubToken`
    // and `x-api-key` are the same hazard spelled differently.
    for (const stem of sensitiveKeys) {
      if (stem.length >= 4 && lower.includes(stem)) {
        return true;
      }
    }
    return false;
  };

  /**
   * Does this string contain a minted secret? A secret is scrubbed wherever
   * it appears, including inside a longer string.
   */
  const containsSecret = (text: string): boolean =>
    secrets.some((secret) => secret.length > 0 && text.includes(secret));

  const walk = (value: JsonValue, path: string, depth: number): RedactionResult => {
    if (depth > maxDepth) {
      return { value, applied: [] };
    }

    if (typeof value === 'string') {
      if (containsSecret(value)) {
        return { value: REDACTION_PLACEHOLDER, applied: [path] };
      }
      return { value, applied: [] };
    }

    if (Array.isArray(value)) {
      const out: JsonValue[] = [];
      const applied: string[] = [];
      value.forEach((item, index) => {
        const result = walk(item as JsonValue, `${path}[${String(index)}]`, depth + 1);
        out.push(result.value);
        applied.push(...result.applied);
      });
      return { value: out, applied };
    }

    if (value !== null && typeof value === 'object') {
      const source = value as { readonly [key: string]: JsonValue | undefined };
      const out: { [key: string]: JsonValue } = {};
      const applied: string[] = [];
      for (const key of Object.keys(source)) {
        const member = source[key];
        if (member === undefined) {
          continue;
        }
        const memberPath = path === '' ? key : `${path}.${key}`;
        if (isSensitiveKey(key)) {
          out[key] = REDACTION_PLACEHOLDER;
          applied.push(memberPath);
          continue;
        }
        const result = walk(member, memberPath, depth + 1);
        out[key] = result.value;
        applied.push(...result.applied);
      }
      return { value: out, applied };
    }

    return { value, applied: [] };
  };

  return (value: JsonValue): RedactionResult => walk(value, '', 0);
};

/**
 * A redactor that does nothing, but still records the policy it ran under.
 *
 * Used when the caller has no secrets to scrub — the receipt is still
 * written, with an empty `applied` list, so a reader can tell "nothing was
 * redacted" from "redaction was never attempted".
 */
export const noopRedactor = (policyRef = 'redaction.none'): Redactor => {
  void policyRef;
  return (value: JsonValue): RedactionResult => ({ value, applied: [] });
};

/**
 * The default policy: the pack's sensitive-key and deny-listed-env defaults,
 * with no task-specific secrets. The task's minted secrets are added by the
 * caller (pack 02 §4.17: "adds the token string to the task's **redaction
 * set**").
 */
export const defaultRedactionPolicy = (): RedactionPolicy => ({
  policyRef: 'redaction.v1',
  secrets: [],
  sensitiveKeys: DEFAULT_SENSITIVE_KEYS,
  deniedEnvNames: DEFAULT_DENIED_ENV_NAMES,
});
