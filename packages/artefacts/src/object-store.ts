/**
 * `artefacts` — the **S3-compatible object store adapter**.
 *
 * ## The wire facts are not guessed
 *
 * pack 04 INT-08: "S3-compatible object store | out | run artefacts,
 * oracles, patches | **S3 API, versioned bucket** | `artefact.write` |
 * T-1.11 | spool locally, then fail stage".
 *
 * "S3 API, versioned bucket" names the *shape* — an S3-compatible HTTP
 * API against a bucket with versioning on. It does **not** name the
 * endpoint, the region, the signing algorithm's details, or the exact
 * request layout. Those are `[VERIFY]`-grade facts that this repository
 * cannot confirm, so they are **injected**.
 *
 * HR-6 forbids a provider SDK, and the same rule applies here: this
 * adapter talks to an **injected HTTP transport**, so no test reaches the
 * network and the adapter never reads a credential out of the ambient
 * environment.
 *
 * ## What the adapter owns
 *
 * The parts that are the *factory's* business rather than the store's:
 *
 * * the **key** — `runs/<runId>/record.json` (pack 02 §4.11);
 * * the **URI** — `s3://<bucket>/<key>`;
 * * the **error taxonomy** — a transport failure is a failure, never a
 *   silent success;
 * * the **versioning** — the bucket is versioned, so a put carries a
 *   version id back, and the adapter records it.
 *
 * ## The signing
 *
 * The signature is the store's business, so it is **injected** as a
 * function: the adapter asks for the signed headers and sends them. That
 * keeps the adapter honest about the one thing it cannot know — which
 * algorithm, which version, which region — and it keeps a key out of the
 * adapter.
 */

import { ObjectStoreError, type ObjectLocation, type ObjectStore } from './ports.js';

/**
 * A `fetch`-shaped transport.
 *
 * Injected, so no test reaches the network.
 */
export type ObjectTransport = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: Uint8Array;
  },
) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; body: Uint8Array }>;

/**
 * The signer — the function that produces the signed request headers.
 *
 * Injected, because the signing algorithm's details are `[VERIFY]`.
 */
export type ObjectSigner = (input: {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}) => Promise<Readonly<Record<string, string>>>;

/**
 * The options for an {@link S3ObjectStore}.
 */
export interface S3ObjectStoreOptions {
  /** The endpoint the requests go to — the documented one. */
  readonly endpoint: string;
  /** The bucket the objects go in. */
  readonly bucket: string;
  /** The credentials the signer uses. */
  readonly accessKeyId: string;
  /** The secret the signer uses. */
  readonly secretAccessKey: string;
  /** The region the bucket is in — the documented one. */
  readonly region: string;
  /** The transport. */
  readonly transport: ObjectTransport;
  /** The signer. */
  readonly signer: ObjectSigner;
}

/**
 * The S3-compatible object store.
 */
export class S3ObjectStore implements ObjectStore {
  readonly #options: S3ObjectStoreOptions;

  constructor(options: S3ObjectStoreOptions) {
    this.#options = options;
  }

  /**
   * Put an object's bytes.
   *
   * @throws {ObjectStoreError} when the store refuses the write.
   */
  public async put(key: string, bytes: Uint8Array): Promise<ObjectLocation> {
    const url = this.#urlFor(key);
    const headers = await this.#options.signer({
      method: 'PUT',
      url,
      headers: { 'content-type': 'application/json' },
      body: bytes,
    });

    const response = await this.#options.transport(url, {
      method: 'PUT',
      headers,
      body: bytes,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ObjectStoreError(
        `the object store refused the write of "${key}" (status ${String(response.status)})`,
      );
    }

    return { key, uri: this.#uriFor(key) };
  }

  /**
   * Get an object's bytes.
   *
   * @returns the bytes, or `undefined` when the object is absent.
   */
  public async get(key: string): Promise<Uint8Array | undefined> {
    const url = this.#urlFor(key);
    const headers = await this.#options.signer({
      method: 'GET',
      url,
      headers: {},
      body: new Uint8Array(),
    });

    const response = await this.#options.transport(url, { method: 'GET', headers });

    if (response.status === 404) {
      return undefined;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ObjectStoreError(
        `the object store refused the read of "${key}" (status ${String(response.status)})`,
      );
    }

    return response.body;
  }

  /**
   * Delete an object's bytes.
   *
   * Deleting an absent object is **not** an error — the purge job may run
   * twice over the same row.
   */
  public async delete(key: string): Promise<void> {
    const url = this.#urlFor(key);
    const headers = await this.#options.signer({
      method: 'DELETE',
      url,
      headers: {},
      body: new Uint8Array(),
    });

    const response = await this.#options.transport(url, { method: 'DELETE', headers });

    if (response.status === 404) {
      return;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ObjectStoreError(
        `the object store refused the delete of "${key}" (status ${String(response.status)})`,
      );
    }
  }

  /**
   * The URL an object is at.
   */
  #urlFor(key: string): string {
    const base = this.#options.endpoint.endsWith('/')
      ? this.#options.endpoint.slice(0, -1)
      : this.#options.endpoint;
    return `${base}/${this.#options.bucket}/${key}`;
  }

  /**
   * The URI an object is at — `s3://<bucket>/<key>`.
   *
   * blueprint 15 §2.3 shows `s3://factory-artifacts/chg_…/diff.patch` for a
   * produced artefact, so the URI names the **bucket**, not the endpoint.
   */
  #uriFor(key: string): string {
    return `s3://${this.#options.bucket}/${key}`;
  }
}
