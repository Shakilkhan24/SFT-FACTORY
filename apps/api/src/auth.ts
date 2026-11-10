/**
 * `api/auth` — **who is calling** (T-1.14).
 *
 * ## The two ways in
 *
 * pack `04` §3: "Auth: browser = GitHub-OAuth session cookie + CSRF token;
 * CLI = bearer token `fac_…` (stored hashed, scoped, expiring, revocable)."
 *
 * So there are exactly two credentials, and they are **not**
 * interchangeable:
 *
 * * the **browser** has a session cookie, and every mutating call must
 *   also carry the session's **CSRF token**;
 * * the **CLI** has a bearer token, which is scoped, expiring and
 *   revocable, and which is stored **hashed**.
 *
 * ## Why the CSRF token is separate from the session
 *
 * A session cookie is sent by the browser automatically — that is the
 * point, and it is why it is dangerous. A cookie alone would let a
 * third-party site make the browser issue a mutating request to the
 * factory, with the user's authority, without the user knowing. The CSRF
 * token breaks that: it lives in the page's DOM, and a third-party site
 * cannot read it because it cannot read the page's DOM across origins.
 *
 * So the rule is: **a session proves who you are; the CSRF token proves
 * this request came from the page you are looking at.** A mutating call
 * with a session cookie and no CSRF token is refused — not because the
 * caller is unknown, but because the request's *origin* is unproven.
 *
 * ## The allow-list
 *
 * The ticket's proof is "a non-allow-listed login is rejected". The
 * allow-list is **injected** — pack `04` §2.4 says the allow-list is
 * definition-driven, so the API must not hard-code anyone's login
 * (HR-10). The list is checked for **every** authenticated call, whether
 * the credential was a session or a token.
 *
 * ## The token is stored hashed
 *
 * The plaintext `fac_…` exists exactly once, at minting. What is stored
 * and what the caller presents is the **hash**. So a stolen database does
 * not hand over working tokens, and the API compares hashes, never
 * plaintexts.
 */

import { toSha256Digest } from '@factory/core';

import type { CallerIdentity, CliToken, TokenStore } from './ports.js';
import { unauthenticated } from './problem.js';
import type { Refusal } from './problem.js';

/**
 * The name of the session cookie.
 */
export const SESSION_COOKIE_NAME = 'factory_session';

/**
 * The name of the CSRF header.
 */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * The prefix of a CLI bearer token.
 *
 * pack `04` §3: "bearer token `fac_…`". The prefix is not decoration:
 * a token that does not carry it is not a factory token, and saying so
 * early is clearer than a hash lookup that misses.
 */
export const CLI_TOKEN_PREFIX = 'fac_';

/**
 * Hash a token for storage and comparison.
 *
 * The digest is over the **plaintext** token, and it is what both sides
 * hold — the store holds the hash, and the caller presents the plaintext
 * which is hashed before the lookup. That is what "stored hashed" means.
 */
export const hashToken = (token: string): `sha256:${string}` =>
  toSha256Digest(token);

/**
 * Is this string shaped like a factory CLI token?
 */
export const isCliToken = (value: string): boolean =>
  value.startsWith(CLI_TOKEN_PREFIX) && value.length > CLI_TOKEN_PREFIX.length;

/**
 * The cookie or header a request carried, as the auth layer sees it.
 */
export interface Credentials {
  /** The session cookie's value. */
  readonly sessionId?: string;
  /** The CSRF token from the header. */
  readonly csrfToken?: string;
  /** The `Authorization` header's bearer token. */
  readonly bearerToken?: string;
}

/**
 * The auth result.
 *
 * A refusal is a **value**, not a throw (AGENTS.md §4) — a rejected
 * login is an expected outcome, and the caller must be told *why*.
 */
export type AuthResult =
  | { readonly ok: true; readonly identity: CallerIdentity; readonly token?: CliToken }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * The auth layer's dependencies.
 */
export interface AuthDeps {
  /** The clock. */
  readonly now: () => string;
  /** The browser sessions. */
  readonly sessions: {
    bySessionId(sessionId: string): Promise<
      | {
          readonly id: string;
          readonly login: string;
          readonly csrfToken: string;
          readonly expiresAt: string;
        }
      | undefined
    >;
  };
  /** The CLI tokens. */
  readonly tokens: TokenStore;
  /** The allow-list. */
  readonly allowList: { isAllowed(login: string): Promise<boolean> };
}

/**
 * Authenticate a request.
 *
 * @param credentials what the request carried
 * @param needsCsrf whether the call mutates — and so needs the CSRF token
 */
export const authenticate = async (
  deps: AuthDeps,
  credentials: Credentials,
  needsCsrf: boolean,
): Promise<AuthResult> => {
  // ---- the CLI bearer token ------------------------------------------
  //
  // Checked first because a bearer token is unambiguous: it names its
  // owner, and it carries its own scopes. A session cookie sent by a CLI
  // would be an accident, and treating it as one would let a browser
  // session borrow a CLI's authority.
  if (credentials.bearerToken !== undefined) {
    if (!isCliToken(credentials.bearerToken)) {
      return {
        ok: false,
        refusal: unauthenticated(
          'the bearer token is not a factory token — it must start with "fac_"',
        ),
      };
    }

    const token = await deps.tokens.byHash(hashToken(credentials.bearerToken));
    if (token === undefined) {
      return {
        ok: false,
        refusal: unauthenticated('the bearer token is not known'),
      };
    }
    if (token.revokedAt !== undefined) {
      return {
        ok: false,
        refusal: unauthenticated('the bearer token has been revoked'),
      };
    }
    if (token.expiresAt <= deps.now()) {
      return {
        ok: false,
        refusal: unauthenticated('the bearer token has expired'),
      };
    }
    if (!(await deps.allowList.isAllowed(token.login))) {
      return {
        ok: false,
        refusal: unauthenticated(
          `"${token.login}" is not on the factory's allow-list`,
        ),
      };
    }

    return {
      ok: true,
      identity: { login: token.login, via: 'token' },
      token,
    };
  }

  // ---- the browser session -------------------------------------------
  if (credentials.sessionId === undefined) {
    return {
      ok: false,
      refusal: unauthenticated(
        'the request carries neither a session cookie nor a bearer token',
      ),
    };
  }

  const session = await deps.sessions.bySessionId(credentials.sessionId);
  if (session === undefined) {
    return {
      ok: false,
      refusal: unauthenticated('the session is not known'),
    };
  }
  if (session.expiresAt <= deps.now()) {
    return {
      ok: false,
      refusal: unauthenticated('the session has expired'),
    };
  }
  if (!(await deps.allowList.isAllowed(session.login))) {
    return {
      ok: false,
      refusal: unauthenticated(
        `"${session.login}" is not on the factory's allow-list`,
      ),
    };
  }

  // The CSRF check. Only the mutating calls need it — a `GET` cannot
  // change anything, so it has nothing to forge.
  if (needsCsrf) {
    if (credentials.csrfToken === undefined) {
      return {
        ok: false,
        refusal: unauthenticated(
          `a mutating call needs the "${CSRF_HEADER_NAME}" header`,
        ),
      };
    }
    if (credentials.csrfToken !== session.csrfToken) {
      return {
        ok: false,
        refusal: unauthenticated('the CSRF token does not match the session'),
      };
    }
  }

  return { ok: true, identity: { login: session.login, via: 'session' } };
};

/**
 * Does this token carry the scope the route needs?
 *
 * pack `04` §3: a CLI token is "scoped". So a token minted for reading
 * cannot write — and a token minted for one access point cannot use
 * another.
 */
export const hasScope = (
  token: CliToken | undefined,
  scopes: readonly string[],
): boolean => {
  // A browser session is not scope-limited — it is the owner's own
  // authority, and the access point itself is the limit.
  if (token === undefined) {
    return true;
  }
  return scopes.every((scope) =>
    (token.scopes as readonly string[]).includes(scope),
  );
};
