/**
 * `credentials` — the **secret store**.
 *
 * pack 04 §10: *"Secrets are loaded once via `SecretStore`, never logged,
 * never stored in DB/events/artefacts, and **never present in any T2
 * container environment**."*
 *
 * ## What the store is
 *
 * A **read-only view of the process's control-plane secrets**. It is
 * populated once, at process start, and then answers `get`/`has`.
 *
 * The contracts' `SecretStore` (`packages/contracts/src/services.ts`) is
 * exactly this shape:
 *
 * ```ts
 * export interface SecretStore {
 *   get(name: string): string;
 *   has(name: string): boolean;
 * }
 * ```
 *
 * ## Why it is populated once
 *
 * A secret store that reads on demand is a secret store whose contents
 * depend on when it was asked. Loading once at start means:
 *
 * * the set of secrets the process holds is **knowable** — it is exactly
 *   what was injected, and `factory doctor` can check it against the
 *   pack's inventory;
 * * a secret that is rotated or removed from the environment is still
 *   present for the life of the process, which is why rotation is a
 *   *restart* operation and not a hot one;
 * * a test can construct the store from a literal map and get exactly
 *   the same behaviour as the process-start path.
 *
 * ## Why `get` throws rather than returning `undefined`
 *
 * The contracts' `SecretStore` returns `string`, not `string | undefined`,
 * and `has` exists separately. So a **missing** secret is a *programmer
 * or configuration error*, not a runtime condition to branch on: a caller
 * that asks for a secret that was never loaded has a bug, and a silent
 * `undefined` would let it proceed with an empty credential.
 *
 * So `get` throws a `MissingSecretError`, and `has` is the way to ask
 * whether a secret exists without provoking that error.
 *
 * ## The material never leaves
 *
 * The store hands the material to whoever asks — that is its job — but it
 * offers **no way to enumerate the values**, no `toString`, no
 * `toJSON`, and no `inspect`. The only enumeration is `names()`, which
 * returns the **keys** and never the values.
 *
 * This matters because a secret store is exactly the kind of object that
 * ends up in a log line through a `JSON.stringify` of some larger
 * structure, or in a crash report through an error that captured it.
 * Making the values unreachable from those paths is a structural defence
 * rather than a discipline.
 */

import { factoryError, type FactoryError, type Result } from '@factory/core';

/**
 * A secret the store was asked for but does not hold.
 *
 * The message names the secret but **never** its value — the value does
 * not exist, which is the whole point, but the *name* of a missing
 * secret is safe to report and necessary to fix the configuration.
 */
export class MissingSecretError extends Error {
  public override readonly name = 'MissingSecretError';

  public readonly secretName: string;

  public constructor(secretName: string) {
    super(
      `the secret "${secretName}" is not in the secret store; it was never loaded`,
    );
    this.secretName = secretName;
  }
}

/**
 * The secrets the control plane holds (pack 04 §10).
 *
 * This is the **inventory**, not the values. It is the list the store
 * checks itself against, and the list `factory doctor` reports against.
 *
 * ## Why the list is here and not in `definition/`
 *
 * These are **process** secrets, not factory-definition documents: they
 * are not part of the versioned definition, they are not reviewed through
 * the definition's change process, and they must never be committed.
 * Putting them in `definition/` would put them in the repository.
 *
 * ## The `secret` flag
 *
 * The pack's inventory distinguishes a **secret** from a **non-secret
 * configuration value** (`GITHUB_APP_ID` is not a secret;
 * `GITHUB_APP_PRIVATE_KEY` is). The distinction is load-bearing: a
 * non-secret may be printed, a secret may not, and a store that cannot
 * tell them apart cannot enforce that.
 */
export interface SecretDescriptor {
  /** The environment variable the secret is read from. */
  readonly envVar: string;
  /** Whether the value is secret material. */
  readonly secret: boolean;
  /** The holder — which component is allowed to hold it. */
  readonly holder: string;
  /** The rotation note. */
  readonly rotation: string;
}

/**
 * The control-plane secret inventory (pack 04 §10).
 *
 * The names are the pack's. The values are never here.
 */
export const SECRET_INVENTORY: readonly SecretDescriptor[] = [
  {
    envVar: 'GITHUB_APP_ID',
    secret: false,
    holder: 'worker, api',
    rotation: '—',
  },
  {
    envVar: 'GITHUB_APP_INSTALLATION_IDS',
    secret: false,
    holder: 'worker, api',
    rotation: '—',
  },
  {
    envVar: 'GITHUB_APP_PRIVATE_KEY',
    secret: true,
    holder: 'worker only',
    rotation: 'rotate on suspicion + yearly',
  },
  {
    envVar: 'GITHUB_WEBHOOK_SECRET',
    secret: true,
    holder: 'api only',
    rotation: 'rotate quarterly',
  },
  {
    envVar: 'GITHUB_OAUTH_CLIENT_ID',
    secret: false,
    holder: 'api',
    rotation: 'rotate yearly',
  },
  {
    envVar: 'GITHUB_OAUTH_CLIENT_SECRET',
    secret: true,
    holder: 'api',
    rotation: 'rotate yearly',
  },
  {
    envVar: 'GITHUB_ADMIN_TOKEN',
    secret: true,
    holder: "owner's shell only, never on the host",
    rotation: 'used for `repo protect`, then discarded',
  },
  {
    envVar: 'ANTHROPIC_API_KEY',
    secret: true,
    holder: 'worker + factory-gateway',
    rotation: 'rotate quarterly / on leak (runbook)',
  },
  {
    envVar: 'SECONDARY_PROVIDER_API_KEY',
    secret: true,
    holder: 'worker + factory-gateway',
    rotation: 'rotate quarterly / on leak (runbook)',
  },
  {
    envVar: 'S3_ENDPOINT',
    secret: false,
    holder: 'worker, api',
    rotation: '—',
  },
  {
    envVar: 'S3_BUCKET',
    secret: false,
    holder: 'worker, api',
    rotation: '—',
  },
  {
    envVar: 'S3_ACCESS_KEY',
    secret: true,
    holder: 'worker, api (read-signing)',
    rotation: 'scoped to the bucket',
  },
  {
    envVar: 'S3_SECRET_KEY',
    secret: true,
    holder: 'worker, api (read-signing)',
    rotation: 'scoped to the bucket',
  },
  {
    envVar: 'SESSION_SECRET',
    secret: true,
    holder: 'api',
    rotation: 'rotate on suspicion',
  },
  {
    envVar: 'EDGE_TOKEN_HMAC_KEY',
    secret: true,
    holder: 'worker+edge',
    rotation: 'rotate on suspicion',
  },
  {
    envVar: 'NOTIFY_WEBHOOK_URL',
    secret: true,
    holder: 'worker',
    rotation: '—',
  },
  {
    envVar: 'NOTIFY_HMAC_KEY',
    secret: true,
    holder: 'worker',
    rotation: '—',
  },
  {
    envVar: 'DATABASE_URL_APP',
    secret: true,
    holder: 'worker',
    rotation: 'distinct roles; owner only for migrations',
  },
  {
    envVar: 'DATABASE_URL_PROJECTOR',
    secret: true,
    holder: 'projector',
    rotation: 'distinct roles; owner only for migrations',
  },
  {
    envVar: 'DATABASE_URL_APPLIER',
    secret: true,
    holder: 'applier',
    rotation: 'distinct roles; owner only for migrations',
  },
  {
    envVar: 'DATABASE_URL_EDGE',
    secret: true,
    holder: 'edge',
    rotation: 'distinct roles; owner only for migrations',
  },
  {
    envVar: 'DATABASE_URL_READONLY',
    secret: true,
    holder: 'readonly',
    rotation: 'distinct roles; owner only for migrations',
  },
  {
    envVar: 'DATABASE_URL_OWNER',
    secret: true,
    holder: 'owner',
    rotation: 'distinct roles; owner only for migrations',
  },
];

/**
 * The store's own shape — the contracts' `SecretStore`, plus the
 * inventory's edges.
 */
export interface ControlPlaneSecretStore {
  /**
   * The secret's material.
   *
   * @throws {MissingSecretError} when the secret is not in the store.
   */
  get(name: string): string;

  /** Whether the store holds the secret. */
  has(name: string): boolean;

  /**
   * The names of the secrets the store holds — the **keys** only.
   *
   * There is deliberately no way to enumerate the values. A caller that
   * wants the values must ask for them by name.
   */
  names(): readonly string[];

  /**
   * Whether the store holds a **secret** (as opposed to a non-secret
   * configuration value).
   */
  isSecret(name: string): boolean;
}

/**
 * A store backed by a literal map.
 *
 * This is the shape every test uses, and the shape the sops/age loader
 * produces once it has decrypted. The map is **copied** on the way in, so
 * a caller cannot mutate the store's contents after the fact — which is
 * the same guarantee the environment loader gives.
 */
export const secretStoreOf = (
  values: Readonly<Record<string, string>>,
  inventory: readonly SecretDescriptor[] = SECRET_INVENTORY,
): ControlPlaneSecretStore => {
  // The copy. The caller's object is not the store's object.
  const held: ReadonlyMap<string, string> = new Map(
    Object.entries(values),
  );

  const descriptorOf = (name: string): SecretDescriptor | undefined =>
    inventory.find((descriptor) => descriptor.envVar === name);

  const store: ControlPlaneSecretStore = {
    get(name: string): string {
      const value = held.get(name);
      if (value === undefined) {
        throw new MissingSecretError(name);
      }
      return value;
    },
    has(name: string): boolean {
      return held.has(name);
    },
    names(): readonly string[] {
      return [...held.keys()].sort();
    },
    isSecret(name: string): boolean {
      return descriptorOf(name)?.secret === true;
    },
  };

  return store;
};

/**
 * The store loaded from the **environment**.
 *
 * This is the process-start path. It reads the named secrets from the
 * environment and loads **only those that are present** — a secret that
 * is not set is simply absent, and `has` says so.
 *
 * ## Why a missing secret is not an error here
 *
 * A process does not hold every secret in the inventory. The `api`
 * process holds the webhook secret and the OAuth secret; it does not hold
 * the GitHub App private key, which is the **worker's** alone (pack 04
 * §10). So loading is permissive and *use* is strict: `get` throws for a
 * secret this process does not hold.
 *
 * The strictness that matters is at the point of use, because that is
 * where "this process needed the key and did not have it" becomes an
 * operational fact rather than a configuration detail.
 *
 * ## The names
 *
 * A secret may be named by its **environment variable** (`GITHUB_APP_ID`)
 * or by its **canonical name** (`github.app.id`). The canonical name is
 * what the rest of the factory uses, so the store accepts both and the
 * inventory's `envVar` is the link between them.
 */
export const secretStoreFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
  inventory: readonly SecretDescriptor[] = SECRET_INVENTORY,
): ControlPlaneSecretStore => {
  const values: Record<string, string> = {};

  for (const descriptor of inventory) {
    const value = environment[descriptor.envVar];
    if (value !== undefined && value !== '') {
      values[descriptor.envVar] = value;
      // The canonical name is the descriptor's `envVar` with the
      // underscores lowered to dots — `GITHUB_APP_ID` ⇒ `github.app.id`.
      values[canonicalNameOf(descriptor.envVar)] = value;
    }
  }

  return secretStoreOf(values, inventory);
};

/**
 * The canonical name of a secret.
 *
 * `GITHUB_APP_PRIVATE_KEY` ⇒ `github.app.private.key`.
 */
export const canonicalNameOf = (envVar: string): string =>
  envVar.toLowerCase().replace(/_/g, '.');

/**
 * Load the store, reporting what could not be loaded.
 *
 * The result is a `Result` rather than an exception because a **missing**
 * secret is an expected operational outcome — a secret that has not been
 * provisioned yet — and the caller decides what to do about it.
 */
export const loadSecretStore = (
  environment: NodeJS.ProcessEnv = process.env,
  inventory: readonly SecretDescriptor[] = SECRET_INVENTORY,
): Result<ControlPlaneSecretStore, FactoryError> => {
  const store = secretStoreFromEnvironment(environment, inventory);

  // The store is loaded. The inventory is not enforced here: which
  // secrets a process must hold is a per-component fact (pack 04 §10's
  // `holder` column), and enforcing it would need that per-component
  // list, which this ticket does not build.
  return { ok: true, value: store };
};

/**
 * The result of asking for a secret.
 */
export const readSecret = (
  store: ControlPlaneSecretStore,
  name: string,
): Result<string, FactoryError> => {
  try {
    return { ok: true, value: store.get(name) };
  } catch {
    // The thrown `MissingSecretError` names the secret, which is safe.
    // Its **value** does not exist — that is the whole point — so
    // nothing from the error is propagated beyond the name, which the
    // failure detail already carries.
    return {
      ok: false,
      error: factoryError(
        'environment.failure',
        `the secret "${name}" is not available to this process`,
        false,
        { secretName: name },
      ),
    };
  }
};
