/**
 * `credentials` — the **redaction-set registry**.
 *
 * pack 04 §2.2 step 3: *"the token string is added to the task redaction
 * set."* pack 02 §4.6: *"adds the token string to the task's **redaction
 * set** (exact-match scrubbing in artefacts, events, logs)."*
 *
 * ## What the registry holds
 *
 * The **strings** that must never appear in any artefact, event or log —
 * the minted tokens, and the control-plane secrets the process holds.
 *
 * ## Why exact-match, and why it is not enough
 *
 * Exact-match scrubbing catches the token **whole**. It does not catch:
 *
 * * the token with a prefix or suffix (`Bearer ghs_…`, a URL with the
 *   token in a query parameter);
 * * the token base64-encoded, or JSON-escaped inside a larger string;
> * a *different* secret the factory never minted — a token from a
 *   previous task, or a credential pasted into an issue comment.
 *
 * So the registry carries **three** layers, in the order pack 02 §4.11's
 * redaction pipeline names them:
 *
 * 1. **exact** — the minted strings;
 * 2. **pattern** — token formats, private keys, JWTs, and high-entropy
 *    strings near a secret-ish word;
 * 3. **deny-listed env names** — the *names* of environment variables that
 *    must never be captured at all.
 *
 * The layers are applied in that order because exact-match is the
 * **cheapest and most certain**, and a value caught by it should not be
 * re-examined by the more expensive pattern rules.
 *
 * ## What is redacted is reported
 *
 * Every scrub reports **what** it removed, so the artefact record can
 * list `redaction.applied[]`. A redaction that leaves no trace is a
 * redaction nobody can audit — and an auditor who cannot see that
 * something was redacted cannot tell a clean artefact from a scrubbed
 * one.
 *
 * The report records the **rule** that matched and a **digest** of the
 * removed value — never the value.
 */

import { sha256 } from '@factory/core';

/**
 * A redaction rule's name.
 *
 * The name goes into the artefact's `redaction.applied[]`, so it must be
 * stable and must not leak anything about the value.
 */
export type RedactionRule =
  | 'exact.minted'
  | 'exact.control-plane'
  | 'pattern.token'
  | 'pattern.private-key'
  | 'pattern.jwt'
  | 'pattern.high-entropy'
  | 'deny.env-name';

/**
 * One redaction.
 */
export interface Redaction {
  /** The rule that matched. */
  readonly rule: RedactionRule;
  /** A digest of the removed value — proof of what was removed, not what. */
  readonly digest: string;
}

/**
 * The result of scrubbing a value.
 */
export interface RedactionResult {
  /** The scrubbed value. */
  readonly value: string;
  /** What was removed. */
  readonly applied: readonly Redaction[];
}

/**
 * The registry — the task's redaction set.
 *
 * ## Why it is **per task**
 *
 * blueprint 11 §7.1 rule 2: a credential is *"per-task — minted for one
 * task, revoked at task end."* The redaction set follows the credential's
 * life: when the task ends, the set goes with it.
 *
 * A **global** set would be wrong in both directions — it would keep
 * scrubbing a task's token after the task ended (harmless but noisy), and
 * it would make every task's artefact depend on every other task's
 * secrets.
 */
export class RedactionRegistry {
  /**
   * The exact strings to scrub — the minted tokens.
   */
  readonly #minted = new Set<string>();

  /**
   * The exact strings to scrub — the control-plane secrets.
   */
  readonly #controlPlane = new Set<string>();

  /**
   * The environment variable names that must never be captured.
   */
  readonly #deniedEnvNames = new Set<string>();

  /**
   * The task this registry belongs to.
   */
  public readonly taskId: string;

  public constructor(taskId: string) {
    this.taskId = taskId;
  }

  /**
   * Add a **minted** secret — a token the broker handed out.
   *
   * An empty string is refused: an empty needle would match at every
   * position and turn the scrub into a no-op that reports a redaction
   * everywhere.
   */
  public addMinted(value: string): void {
    if (value.length === 0) {
      return;
    }
    this.#minted.add(value);
  }

  /**
   * Add a **control-plane** secret.
   */
  public addControlPlane(value: string): void {
    if (value.length === 0) {
      return;
    }
    this.#controlPlane.add(value);
  }

  /**
   * Add a deny-listed environment variable **name**.
   */
  public addDeniedEnvName(name: string): void {
    if (name.length === 0) {
      return;
    }
    this.#deniedEnvNames.add(name);
  }

  /**
   * The number of exact strings registered.
   *
   * A count, never the strings.
   */
  public get size(): number {
    return this.#minted.size + this.#controlPlane.size;
  }

  /**
   * Whether any environment variable name is deny-listed.
   */
  public deniesEnvName(name: string): boolean {
    return this.#deniedEnvNames.has(name);
  }

  /**
   * The deny-listed environment variable names.
   *
   * Names, not values — the names are not secret.
   */
  public deniedEnvNames(): readonly string[] {
    return [...this.#deniedEnvNames].sort();
  }

  /**
   * Scrub a value.
   *
   * The layers run in order: exact-match first, then the patterns, then
   * the deny-listed names. Each layer's matches are reported.
   */
  public scrub(input: string): RedactionResult {
    let value = input;
    const applied: Redaction[] = [];

    // ---- Layer 1: exact match ------------------------------------------------
    for (const [needle, rule] of [
      ...[...this.#minted].map((v): [string, RedactionRule] => [v, 'exact.minted']),
      ...[...this.#controlPlane].map(
        (v): [string, RedactionRule] => [v, 'exact.control-plane'],
      ),
    ]) {
      if (!value.includes(needle)) {
        continue;
      }
      value = value.split(needle).join(REDACTION_PLACEHOLDER);
      applied.push({ rule, digest: sha256(needle) });
    }

    // ---- Layer 2: patterns --------------------------------------------------
    const patterned = scrubPatterns(value);
    value = patterned.value;
    applied.push(...patterned.applied);

    // ---- Layer 3: deny-listed env names -------------------------------------
    // A deny-listed *name* appearing in the text is a leak of the name
    // alongside its value — e.g. `GITHUB_APP_PRIVATE_KEY=-----BEGIN...`.
    // The name is scrubbed too, because the name alone tells a reader
    // that a secret of that kind was present here.
    for (const name of this.#deniedEnvNames) {
      if (!value.includes(name)) {
        continue;
      }
      value = value.split(name).join(REDACTION_PLACEHOLDER);
      applied.push({
        rule: 'deny.env-name',
        digest: sha256(name),
      });
    }

    return { value, applied };
  }

  /**
   * Scrub a JSON-serialisable value, recursively.
   *
   * The digest of a removed value is a digest of the **string that was
   * removed**, so a JSON string and the same string appearing in prose
   * produce the same digest — which is what makes the report comparable.
   */
  public scrubJson<T>(value: T): { readonly value: T; readonly applied: readonly Redaction[] } {
    const applied: Redaction[] = [];

    const walk = (node: unknown): unknown => {
      if (typeof node === 'string') {
        const scrubbed = this.scrub(node);
        applied.push(...scrubbed.applied);
        return scrubbed.value;
      }
      if (Array.isArray(node)) {
        return node.map(walk);
      }
      if (node !== null && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(node)) {
          out[key] = walk(child);
        }
        return out;
      }
      return node;
    };

    return { value: walk(value) as T, applied };
  }
}

/**
 * The placeholder a redacted value is replaced with.
 *
 * A fixed string, so the scrubbed output is **stable** — the same input
 * scrubs to the same output, which is what makes an artefact's hash
 * reproducible.
 */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * The pattern rules.
 *
 * ## Why these are patterns and not exact strings
 *
 * The factory's own minted tokens are known exactly, so they are caught
 * by the exact-match layer. But a **foreign** token — one from another
 * tool, another task, or a human pasting one into a comment — is not
 * known in advance. Its *shape* is.
 *
 * The shapes below are the ones pack 02 §4.11 names: token formats,
 * private keys, JWTs, high-entropy strings near a secret-ish word.
 */

/**
 * A GitHub token — the `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` families and the
 * newer `github_pat_` form.
 */
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

/**
 * A private key block, in PEM or OpenSSH form.
 */
const PRIVATE_KEY =
  /-----BEGIN(?:[A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END(?:[A-Z ]*)PRIVATE KEY-----/g;

/**
 * A JSON web token — three base64url segments.
 */
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;

/**
 * A secret-ish word near a long opaque token.
 *
 * The word is required: a bare high-entropy string is usually a git SHA,
 * a content digest, or a ULID, and redacting those would destroy the
 * artefact. A high-entropy string **next to** `key`, `token`, `secret` or
 * `password` is a credential being assigned.
 */
const HIGH_ENTROPY_NEAR_SECRET_WORD =
  /((?:key|token|secret|password|passwd|pwd)["'\s:=]{1,4})([A-Za-z0-9+/=_-]{20,})/gi;

/**
 * The words the high-entropy rule looks for.
 */
export const SECRET_WORDS: readonly string[] = [
  'key',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
];

/**
 * Apply the pattern rules.
 */
const scrubPatterns = (input: string): RedactionResult => {
  let value = input;
  const applied: Redaction[] = [];

  const apply = (
    pattern: RegExp,
    rule: RedactionRule,
    transform: (match: string) => string,
  ): void => {
    // The pattern is fresh per call — a global regex carries `lastIndex`
    // between uses, so a shared instance would skip matches.
    const matches = value.match(pattern);
    if (matches === null || matches.length === 0) {
      return;
    }
    for (const match of matches) {
      applied.push({ rule, digest: sha256(match) });
    }
    value = value.replace(pattern, transform);
  };

  apply(GITHUB_TOKEN, 'pattern.token', () => REDACTION_PLACEHOLDER);
  apply(PRIVATE_KEY, 'pattern.private-key', () => REDACTION_PLACEHOLDER);
  apply(JWT, 'pattern.jwt', () => REDACTION_PLACEHOLDER);
  apply(
    HIGH_ENTROPY_NEAR_SECRET_WORD,
    'pattern.high-entropy',
    (match) => {
      const separator = match.match(/^(key|token|secret|password|passwd|pwd)["'\s:=]{1,4}/i);
      const prefix = separator === null ? '' : separator[0];
      return `${prefix}${REDACTION_PLACEHOLDER}`;
    },
  );

  return { value, applied };
};
