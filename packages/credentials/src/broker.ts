/**
 * `credentials` — the **credential broker**.
 *
 * blueprint 11 §7.2:
 *
 * ```
 * REQ["Broker request (capability, resource, task)"]
 *   → SCOPE["Compute effective scopes = capability.required ∩ grant ∩ resource"]
 *   → MINT["Mint / delegate short-lived credential"]
 *   → INJECT["Inject into adapter call only"]
 *   → REVOKE["Revoke at task end (reconciler)"]
 * ```
 *
 * ## The three properties this file exists to hold
 *
 * 1. **The material is never written.** The lease row carries the
 *    credential's **reference** — its id, its scope, its expiry — and
 *    never its secret. The `credential_leases` table says so in its own
 *    comment: `NEVER stores secret material`.
 * 2. **The material is injected only at the invocation boundary.** The
 *    broker hands it to the broker's step 7 and to nothing else. It is
 *    not in a prompt, not in a context, not in an argument, not in a
 *    result, not in an environment.
 * 3. **The credential dies with the task.** `revokeAll` runs in a
 *    `finally` at every terminal state, and a reaper handles the case
 *    where the process dies before the `finally` runs.
 *
 * ## The provider port
 *
 * The minting itself is behind a port (`CredentialMintProvider`), because
 * minting a GitHub installation token is a **wire** operation against
 * GitHub's API, and the wire facts are exactly what spike S-2 exists to
 * confirm. Everything that is *the factory's* logic — the scope
 * computation, the lease, the redaction, the revocation — is here and is
 * provable against the fake.
 *
 * The provider is given a **narrowed** request and returns the material.
 * It is never given the task's full scope, and it never decides what the
 * scope is.
 */

import type {
  CredentialScope,
  InvocationContext,
  ResolvedCredential,
  ToolCapability,
} from '@factory/contracts';
import { factoryError, type Clock, type FactoryError, type Result } from '@factory/core';

import {
  computeEffectiveScope,
  effectiveTtlSeconds,
  narrowPermissionsToGrant,
  toCredentialScope,
  type EffectiveScope,
  type PermissionLevel,
} from './scope.js';
import type { RedactionRegistry } from './redaction.js';

/**
 * The lease — the row in `credential_leases`.
 *
 * ## What it does **not** carry
 *
 * No secret material. The row is:
 *
 * | Column | Meaning |
 * |---|---|
 * | `id` | the credential's id — the reference |
 * | `task_id` | the task the credential was minted for |
 * | `provider` | which provider minted it |
 * | `scope` | the scope it was minted with — the **reference** to what it may do |
 * | `minted_at` | when |
 * | `expires_at` | when it dies |
 * | `revoked_at` | when it was revoked, if it has been |
 *
 * The material is not here, so a row can be read by anyone with the
 * `factory_readonly` role without leaking anything.
 */
export interface CredentialLease {
  readonly id: string;
  readonly taskId: string;
  readonly provider: string;
  readonly scope: {
    readonly scopes: readonly string[];
    readonly permissions: Readonly<Record<string, PermissionLevel>>;
    readonly repositories: readonly string[];
  };
  readonly mintedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

/**
 * The store for the leases.
 *
 * The port is narrow — record, list by task, list expired, mark revoked —
 * because the broker is the only thing that needs to talk to it, and a
 * wider port is a wider surface.
 */
export interface CredentialLeaseStore {
  /**
   * Record a minted lease.
   */
  record(lease: CredentialLease): Promise<void>;

  /**
   * The leases for a task.
   */
  listByTask(taskId: string): Promise<readonly CredentialLease[]>;

  /**
   * The leases that have expired and have not been revoked.
   *
   * The reaper's query. An expired lease is an **orphan** — the task
   * died before its `finally` ran, or the process died.
   */
  listExpired(referencedAt: string): Promise<readonly CredentialLease[]>;

  /**
   * Mark a lease revoked.
   */
  markRevoked(leaseId: string, revokedAt: string): Promise<void>;
}

/**
 * The minting request.
 *
 * The provider is told **exactly** what to mint and nothing more. It
 * does not see the task, the grant, the workflow, or the agent.
 */
export interface MintRequest {
  /** The credential's id. */
  readonly credId: string;
  /** The task the credential is for. */
  readonly taskId: string;
  /** The scope, already narrowed. */
  readonly scope: CredentialScope;
}

/**
 * The minting result.
 */
export interface MintResult {
  /** The material. */
  readonly secret: string;
  /** When the material dies at the provider. */
  readonly expiresAt: string;
}

/**
 * The port that actually mints.
 *
 * ## Why this is a port
 *
 * Minting a GitHub installation token means signing a JWT with the App's
 * private key and calling GitHub's API. The **wire facts** — the exact
 * request body, the exact revoke call — are tagged `[VERIFY]` in the
 * pack and are confirmed by spike **S-2**, which has not run: it needs a
 * real GitHub App, which is an owner action.
 *
 * So the port exists, the fake implements it, and the real implementation
 * is a thin adapter whose only job is to fill in the confirmed facts.
 * The factory's own logic — the scope, the lease, the redaction, the
 * revocation — does not wait for that.
 */
export interface CredentialMintProvider {
  /**
   * The provider's name — `github` today.
   */
  readonly name: string;

  /**
   * Mint a credential.
   */
  mint(request: MintRequest): Promise<MintResult>;

  /**
   * Revoke a credential at the provider.
   *
   * A provider that cannot revoke (or a revoke that fails) must still
   * let the lease be marked revoked — the lease's death is the factory's
   * own record, and it must not be held hostage by the provider being
   * unreachable.
   */
  revoke(lease: CredentialLease): Promise<void>;
}

/**
 * The broker's options.
 */
export interface CredentialBrokerOptions {
  /** The lease store. */
  readonly leases: CredentialLeaseStore;
  /** The minting provider. */
  readonly provider: CredentialMintProvider;
  /** The clock. */
  readonly clock: Clock;
  /**
   * The id source for credential ids.
   *
   * A function, so the broker does not depend on `core`'s ULID
   * machinery's entropy source — the caller injects whatever it uses.
   */
  readonly nextId: () => string;
  /**
   * The redaction registry for the task, if the caller has one.
   *
   * The broker adds every minted token to it. The registry is the
   * task's, not the broker's — the broker outlives no single task.
   */
  readonly redaction?: RedactionRegistry;
}

/**
 * A mint request, as the broker takes it.
 */
export interface MintTaskRequest {
  /** The task the credential is for. */
  readonly taskId: string;
  /** The scopes the capability needs. */
  readonly requiredScopes: readonly string[];
  /** The scopes the grant allows. */
  readonly allowedScopes: readonly string[];
  /** The scopes the grant denies. */
  readonly deniedScopes?: readonly string[];
  /** The repositories in scope. */
  readonly repositories: readonly string[];
  /**
   * The permission levels the grant allows, by GitHub permission name.
   *
   * The **second** narrowing — the scope computation narrows the scopes,
   * and this narrows the permissions the scopes imply.
   */
  readonly grantPermissions?: Readonly<Record<string, PermissionLevel>>;
  /** The requested TTL. Capped at one hour. */
  readonly ttlSeconds: number;
}

/**
 * What a mint produced.
 *
 * The material is here, and it is held for the duration of **one**
 * invocation. It is never written to a lease, an event or a log.
 */
export interface MintedCredential {
  /** The credential's id — the reference. */
  readonly credId: string;
  /** The material. */
  readonly secret: string;
  /** The scope it was minted with. */
  readonly scope: CredentialScope;
  /** The effective scope, in the factory's vocabulary. */
  readonly effective: EffectiveScope;
  /** When it expires. */
  readonly expiresAt: string;
}

/**
 * The credential broker.
 *
 * ## The `resolve` seam
 *
 * The contracts' `CredentialBroker` has `resolve(credId)` — resolve a
 * credential **by id**. The broker's step 7 has a `Capability` and an
 * `InvocationContext`, and needs a credential for *that* capability at
 * *that* task.
 *
 * The two are reconciled here: `resolve` takes the capability and the
 * context and returns the credential, minting one if the task does not
 * already hold one for that capability. That is the broker's
 * `CredentialProvider` port from `packages/broker`, so the two packages
 * meet without either depending on the other's internals.
 */
export class CredentialBroker {
  readonly #options: CredentialBrokerOptions;

  /**
   * The credentials this broker has minted, in memory, by capability.
   *
   * ## Why the material is held here
   *
 * The credential must be available to the invocation that asked for it,
   * and the material must not be re-minted per call — a GitHub token
   * mint is a round trip, and a task with many calls would mint many
   * tokens.
   *
   * So the material is held for the life of the **broker**, and the
   * broker's life is the task's. When the task ends, `revokeAll` drops
   * them.
   *
   * ## Why the map is keyed by capability
   *
 * Two capabilities with the same scope get the same credential; two
   * capabilities with different scopes get different ones. Keying by
   * capability *and* scope would be more precise, but the scope is
   * derived from the capability, so the capability is the key.
   */
  readonly #live = new Map<string, ResolvedCredential>();

  public constructor(options: CredentialBrokerOptions) {
    this.#options = options;
  }

  /**
   * The broker's task.
   *
   * The broker is per-task: the leases, the redaction set and the live
   * credentials all belong to one task.
   */
  public get taskId(): string | undefined {
    return this.#options.redaction?.taskId;
  }

  /**
   * The redaction registry, if there is one.
   */
  public get redaction(): RedactionRegistry | undefined {
    return this.#options.redaction;
  }

  /**
   * Mint a credential for a task.
   *
   * @returns the minted credential, or a `policy.denied` when the scope
   *   is empty.
   */
  public async mint(
    request: MintTaskRequest,
  ): Promise<Result<MintedCredential, FactoryError>> {
    // ---- The scope computation ------------------------------------------------
    const scoped = computeEffectiveScope({
      required: request.requiredScopes,
      allowed: request.allowedScopes,
      ...(request.deniedScopes === undefined
        ? {}
        : { denied: request.deniedScopes }),
      repositories: request.repositories,
    });

    if (!scoped.ok) {
      return scoped;
    }

    // ---- The permission narrowing --------------------------------------------
    // Two different things are being expressed here, and conflating them
    // would be a **widening** bug.
    //
    // * `grantPermissions` **absent** — the grant expresses its limits as
    //   scopes, and the intersection above has already applied them. There
    //   is no further permission-level restriction, so the computed
    //   permissions stand.
    // * `grantPermissions` **present** — the grant enumerates the
    //   permissions it allows, and a permission it does not mention has
    //   not been granted. `narrowPermissionsToGrant` removes it.
    //
    // The distinction matters: treating "absent" as "grants nothing" would
    // refuse every mint whose caller had not enumerated a permission
    // table, and treating "present" as "grants everything" would hand out
    // a permission the grant never said anything about.
    const grantPermissions = request.grantPermissions;
    const permissions =
      grantPermissions === undefined
        ? scoped.value.permissions
        : narrowPermissionsToGrant(scoped.value.permissions, grantPermissions);

    // A scope that survives but contributes **no** permission is not a
    // usable credential: the capability would receive a token that can
    // do nothing. Refusing here is better than minting a token that
    // fails at the provider.
    if (Object.keys(permissions).length === 0) {
      return {
        ok: false,
        error: factoryError(
          'policy.denied',
          'the credential scope is empty: the grant allows no permission the capability needs',
          false,
          {
            scopes: [...scoped.value.scopes],
            computed: { ...scoped.value.permissions },
            granted: { ...(grantPermissions ?? {}) },
          },
        ),
      };
    }

    const effective: EffectiveScope = {
      scopes: scoped.value.scopes,
      permissions,
      repositories: scoped.value.repositories,
    };

    const ttlSeconds = effectiveTtlSeconds(request.ttlSeconds);
    const scope = toCredentialScope(effective, ttlSeconds);
    const credId = this.#options.nextId();
    // The broker's own ceiling on the credential's life. The provider
    // may hand back a *shorter* expiry (it knows the token's real
    // lifetime) but never a longer one — a provider that ignored the
    // requested TTL would otherwise widen the credential's life, which
    // is the one thing ADR-0018 is explicit about.
    const ceiling = new Date(
      this.#options.clock.now().getTime() + ttlSeconds * 1000,
    ).toISOString();

    // ---- The mint ------------------------------------------------------------
    let minted: MintResult;
    try {
      minted = await this.#options.provider.mint({
        credId,
        taskId: request.taskId,
        scope,
      });
    } catch (error) {
      return {
        ok: false,
        error: factoryError(
          'tool.unavailable',
          `the credential could not be minted: ${error instanceof Error ? error.message : String(error)}`,
          true,
          { provider: this.#options.provider.name },
        ),
      };
    }

    // ---- The lease -----------------------------------------------------------
    // The row carries the **reference**, never the material.
    //
    // The expiry is the **earlier** of the provider's and the broker's
    // ceiling. A provider that returned a longer expiry is not trusted
    // to widen the credential's life.
    const expiresAt =
      Date.parse(minted.expiresAt) > Date.parse(ceiling)
        ? ceiling
        : minted.expiresAt;

    await this.#options.leases.record({
      id: credId,
      taskId: request.taskId,
      provider: this.#options.provider.name,
      scope: {
        scopes: effective.scopes,
        permissions: effective.permissions,
        repositories: effective.repositories,
      },
      mintedAt: this.#options.clock.nowIso(),
      expiresAt,
    });

    // ---- The redaction set ---------------------------------------------------
    // The minted token's material goes into the task's redaction set, so
    // that if it ever *does* reach an artefact, an event or a log, the
    // scrubber removes it.
    this.#options.redaction?.addMinted(minted.secret);

    return {
      ok: true,
      value: {
        credId,
        secret: minted.secret,
        scope,
        effective,
        expiresAt,
      },
    };
  }

  /**
   * Resolve the credential for a capability in a context — **broker step 7**.
   *
   * ## The two cases
   *
   * * **The capability needs no credential.** `credentials.provider` is
   *   the `none` sentinel, and the broker must not ask for one — asking
   *   would mint a credential for a capability that does not use it.
   * * **The capability needs one.** The credential is minted for the
   *   task and returned, or the existing one is returned.
   *
   * ## The scopes come from the capability
   *
   * The capability's `scope.required` and `credentials.permissions` say
   * what it needs. The **grant** says what is allowed — and the grant is
   * not reachable from here, because the broker's step 3 has already
   * checked it. This method receives the *effective* scopes the broker
   * already computed, so the credential's scope is **narrower than or
   * equal to** the grant's.
   */
  public async resolve(
    capability: ToolCapability,
    context: InvocationContext,
    effectiveScopes: readonly string[],
    repositories: readonly string[],
  ): Promise<Result<ResolvedCredential | undefined, FactoryError>> {
    // No credential needed.
    if (capability.credentials.provider === 'none') {
      return { ok: true, value: undefined };
    }

    const key = `${context.taskId}:${capability.id}`;

    const existing = this.#live.get(key);
    if (existing !== undefined) {
      return { ok: true, value: existing };
    }

    const requestedScopes = capability.scope.required;
    const ttlSeconds = effectiveTtlSeconds(
      capability.credentials.ttlSeconds > 0
        ? capability.credentials.ttlSeconds
        : 3600,
    );

    const minted = await this.mint({
      taskId: context.taskId,
      requiredScopes: requestedScopes,
      // The grant already narrowed the scopes; the credential is minted
      // for the **intersection** of what the capability needs and what
      // survived the grant.
      allowedScopes: effectiveScopes,
      repositories,
      ttlSeconds,
    });

    if (!minted.ok) {
      return minted;
    }

    const resolved: ResolvedCredential = {
      credId: minted.value.credId,
      provider: this.#options.provider.name,
      scope: { ...minted.value.effective.permissions },
      expiresAt: minted.value.expiresAt,
      secret: minted.value.secret,
    };

    this.#live.set(key, resolved);

    return { ok: true, value: resolved };
  }

  /**
   * Revoke every credential this task holds.
   *
   * ## Why this is `finally`-shaped
   *
   * pack 02 §4.6: *"`revoke(task)` runs in a `finally` at every terminal
   * state."* The point of the `finally` is that the revocation happens
   * **whether or not the task succeeded**.
   *
   * ## Why a provider failure does not stop the revocation
   *
   * A provider that is unreachable must not leave the lease alive — the
   * lease's death is the factory's own record, and the material's death
   * is the provider's. If the provider cannot be reached, the material
   * dies anyway when the token expires (≤ 1 h), but the **lease** must
   * be marked revoked now, because a lease that says "live" is what a
   * later audit would believe.
   *
   * So the provider's failure is collected and reported, and the lease
   * is marked revoked regardless.
   */
  public async revokeAll(taskId: string): Promise<readonly Error[]> {
    const failures: Error[] = [];
    const leases = await this.#options.leases.listByTask(taskId);

    for (const lease of leases) {
      if (lease.revokedAt !== undefined) {
        continue;
      }
      try {
        await this.#options.provider.revoke(lease);
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      await this.#options.leases.markRevoked(
        lease.id,
        this.#options.clock.nowIso(),
      );
    }

    // The material leaves this process too.
    for (const [key, credential] of [...this.#live]) {
      if (key.startsWith(`${taskId}:`)) {
        this.#live.delete(key);
      }
      // The reference to the credential is dropped with it; the material
      // goes with it.
      void credential;
    }

    return failures;
  }

  /**
   * The reaper — handle the leases whose task died.
   *
   * ## What an orphan is
   *
   * A lease that has **expired** and has not been revoked. Its task
   * either died before its `finally` ran, or the process died before it
   * could revoke.
   *
   * ## Why the reaper revokes by lease, not by task
   *
   * The task may be long dead — there may be nothing to call
   * `revokeAll` on. The lease is the durable record, and the reaper's
   * job is to make sure no lease stays live past its expiry.
   */
  public async reapExpired(
    referencedAt: string = this.#options.clock.nowIso(),
  ): Promise<{ readonly revoked: number; readonly failures: readonly Error[] }> {
    const failures: Error[] = [];
    const expired = await this.#options.leases.listExpired(referencedAt);

    for (const lease of expired) {
      try {
        await this.#options.provider.revoke(lease);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
      await this.#options.leases.markRevoked(
        lease.id,
        this.#options.clock.nowIso(),
      );
    }

    return { revoked: expired.length, failures };
  }
}
