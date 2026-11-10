/**
 * `credentials` — the **fake** credential provider.
 *
 * AGENTS.md §4: *"fakes live in `packages/{package}/fakes` and must pass
 * the same contract tests as the real thing (I-12)."*
 *
 * ## What the fake does
 *
 * It behaves like a provider that issues a real credential: it mints a
 * distinct, non-guessable material per request, it honours the TTL, and
 * it **refuses to serve a revoked credential**.
 *
 * That last part is the point. The acceptance criterion A3.4 — *"a
 * credential cannot be used after its task terminates"* — cannot be proved
 * with a fake that always succeeds. The fake must **enforce** the
 * revocation, so a use-after-revoke attempt is a real failure rather
 * than a simulated one.
 *
 * ## Why the material is deterministic
 *
 * The fake's material is derived from a counter and the credential's id,
 * so a test can assert that a secret is *absent* from an artefact by
 * name. It is **not** a real credential and never leaves the test.
 */

import type { Clock } from '@factory/core';

import type { MintRequest, MintResult, CredentialMintProvider, CredentialLease } from '../broker.js';

/**
 * The fake provider's options.
 */
export interface FakeCredentialProviderOptions {
  /**
   * The prefix of the minted material.
   *
   * `ghs_` by default — the shape of a real GitHub App installation
   * token, so that the redaction pattern rules are exercised against
   * the fake the same way they would be against the real thing.
   */
  readonly tokenPrefix?: string;
  /**
   * Whether minting should fail.
   *
   * Set to a message to make the next mint fail — the way an expired App
   * installation or a revoked permission does.
   */
  readonly failWith?: string;
  /**
   * Whether revoking should fail.
   */
  readonly failRevokeWith?: string;
  /**
   * The expiry the provider hands back, in seconds from now.
   *
   * When it is **longer** than the requested TTL, the provider is
   * pretending to be a provider that ignores the request — which is
   * exactly the case the broker's ceiling exists to bound (ADR-0018:
   * "TTL ≤ 1 h"). A provider that were trusted would otherwise widen the
   * credential's life.
   */
  readonly expirySeconds?: number;
  /**
   * The clock.
   *
   * The TTL is measured against it, so the fake's expiry is
   * deterministic under a fixed clock — as everything else in the
   * factory is (AGENTS.md §4: "Time via injected `Clock`").
   */
  readonly clock?: Clock;
}

/**
 * A provider that issues credentials without a network.
 */
export class FakeCredentialProvider implements CredentialMintProvider {
  public readonly name = 'github';

  /**
   * The credentials this provider has issued, by id.
   */
  readonly #issued = new Map<string, MintResult>();

  /**
   * The credentials this provider has revoked, by id.
   */
  readonly #revoked = new Set<string>();

  /**
   * The mint calls this provider received.
   */
  readonly mints: MintRequest[] = [];

  /**
   * The revoke calls this provider received.
   */
  readonly revocations: CredentialLease[] = [];

  readonly #options: FakeCredentialProviderOptions;

  /**
   * The clock.
   *
   * When none is given, the expiry is computed from the TTL alone and
   * the *duration* is what matters, so the fake still works — but a
   * test that asserts an exact expiry must inject a clock.
   */
  readonly #clock: Clock | undefined;

  #counter = 0;

  public constructor(options: FakeCredentialProviderOptions = {}) {
    this.#options = options;
    this.#clock = options.clock;
  }

  /**
   * Mint a credential.
   *
   * @throws when the provider was configured to fail.
   */
  public mint(request: MintRequest): Promise<MintResult> {
    // The failure is a **rejected promise**, not a synchronous throw:
    // the port is asynchronous, and a caller that awaits the port must
    // see a rejection rather than an exception at the call site.
    if (this.#options.failWith !== undefined) {
      return Promise.reject(new Error(this.#options.failWith));
    }

    this.mints.push(request);
    this.#counter += 1;

    const prefix = this.#options.tokenPrefix ?? 'ghs_';
    // The material is **distinct** per mint and carries the id, so a
    // test can name the secret it expects to be absent.
    const secret = `${prefix}fake${String(this.#counter).padStart(4, '0')}${request.credId.replace(/[^A-Za-z0-9]/g, '')}`;

    const result: MintResult = {
      secret,
      expiresAt: this.#expiresAt(
        this.#options.expirySeconds ?? request.scope.ttlSeconds,
      ),
    };

    this.#issued.set(request.credId, result);
    return Promise.resolve(result);
  }

  /**
   * Revoke a credential.
   *
   * @throws when the provider was configured to fail.
   */
  public revoke(lease: CredentialLease): Promise<void> {
    if (this.#options.failRevokeWith !== undefined) {
      return Promise.reject(new Error(this.#options.failRevokeWith));
    }
    this.revocations.push(lease);
    this.#revoked.add(lease.id);
    return Promise.resolve(undefined);
  }

  /**
   * The expiry an issued credential carries.
   */
  #expiresAt(ttlSeconds: number): string {
    if (this.#clock === undefined) {
      // No clock: the expiry is a **duration** from now, expressed with
      // the epoch. A test that asserts an exact expiry injects a clock;
      // a test that asserts a duration does not need one.
      return new Date(Date.now() + ttlSeconds * 1000).toISOString();
    }
    return new Date(
      this.#clock.now().getTime() + ttlSeconds * 1000,
    ).toISOString();
  }

  /**
   * Whether a credential has been revoked.
   */
  public isRevoked(credId: string): boolean {
    return this.#revoked.has(credId);
  }

  /**
   * **Use** a credential — the provider's own check that the credential
   * is still alive.
   *
   * This is what makes A3.4 provable. The acceptance criterion is *"a
   * credential **cannot be used** after its task terminates"* — so the
   * fake must refuse a use of a revoked credential, exactly as GitHub
   * refuses an installation token whose installation was removed.
   *
   * @throws when the credential was revoked, or was never issued.
   */
  public use(credId: string): string {
    if (this.#revoked.has(credId)) {
      throw new Error(
        `the credential ${credId} has been revoked and cannot be used`,
      );
    }
    const issued = this.#issued.get(credId);
    if (issued === undefined) {
      throw new Error(`the credential ${credId} was never issued`);
    }
    return issued.secret;
  }

  /**
   * The material of a credential, if it was issued.
   */
  public materialOf(credId: string): string | undefined {
    return this.#issued.get(credId)?.secret;
  }

  /**
   * The number of credentials issued.
   */
  public get issuedCount(): number {
    return this.#issued.size;
  }
}
