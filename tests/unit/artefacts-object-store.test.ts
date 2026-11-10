/**
 * The **S3-compatible object store adapter**.
 *
 * pack 04 INT-08: "S3-compatible object store | out | run artefacts,
 * oracles, patches | S3 API, versioned bucket | `artefact.write` |
 * T-1.11 | spool locally, then fail stage".
 *
 * The wire facts — the endpoint, the region, the signing algorithm's
 * details — are `[VERIFY]`-grade and are **injected**. So the adapter's
 * own obligations are the ones it can be held to:
 *
 * * the **key** — `runs/<runId>/record.json`;
 * * the **URI** — `s3://<bucket>/<key>`;
 * * the **signing** — the put is signed, and the signed headers are what
 *   the transport receives;
 * * the **error taxonomy** — a refusal is a failure, never a silent
 *   success.
 *
 * No test here touches the network: the transport is injected.
 */

import { describe, expect, it } from 'vitest';

import {
  ObjectStoreError,
  S3ObjectStore,
  type ObjectSigner,
  type ObjectTransport,
} from '../../packages/artefacts/src/index.ts';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
}

/**
 * A transport that records every request and answers with a status.
 */
const recordingTransport = (
  status: number,
  body = '',
): { readonly transport: ObjectTransport; readonly requests: RecordedRequest[] } => {
  const requests: RecordedRequest[] = [];
  const transport: ObjectTransport = (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) });
    return Promise.resolve({
      status,
      headers: {},
      body: new TextEncoder().encode(body),
    });
  };
  return { transport, requests };
};

/**
 * A signer that marks the request as signed.
 */
const SIGNER: ObjectSigner = (input) =>
  Promise.resolve({
    ...input.headers,
    authorization: 'AWS4-HMAC-SHA256 Credential=AKIA/20261110/us-east-1/s3/aws4_request',
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': '20261110T003147Z',
  });

/**
 * The options a store is built with.
 */
const options = (
  transport: ObjectTransport,
  overrides: Partial<{
    endpoint: string;
    bucket: string;
    region: string;
  }> = {},
) => ({
  endpoint: 'https://s3.example.internal',
  bucket: 'factory-artifacts',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'not-a-real-secret',
  region: 'us-east-1',
  transport,
  signer: SIGNER,
  ...overrides,
});

describe('the S3-compatible object store', () => {
  it('puts the object under `runs/<runId>/record.json`', async () => {
    const { transport, requests } = recordingTransport(200);
    const store = new S3ObjectStore(options(transport));

    const location = await store.put('runs/run_123/record.json', new TextEncoder().encode('{}'));

    expect(location.key).toBe('runs/run_123/record.json');
    expect(requests[0]?.url).toBe(
      'https://s3.example.internal/factory-artifacts/runs/run_123/record.json',
    );
    expect(requests[0]?.method).toBe('PUT');
  });

  it('returns the URI in the `s3://<bucket>/<key>` form', async () => {
    // blueprint 15 §2.3 shows `s3://factory-artifacts/chg_…/diff.patch` for
    // a produced artefact — the URI names the **bucket**, not the
    // endpoint.
    const { transport } = recordingTransport(200);
    const store = new S3ObjectStore(options(transport));

    const location = await store.put('runs/run_123/record.json', new Uint8Array());
    expect(location.uri).toBe('s3://factory-artifacts/runs/run_123/record.json');
  });

  it('signs the put, and sends the signed headers', async () => {
    const { transport, requests } = recordingTransport(200);
    const store = new S3ObjectStore(options(transport));

    await store.put('runs/run_123/record.json', new TextEncoder().encode('{}'));

    expect(requests[0]?.headers['authorization']).toContain('AWS4-HMAC-SHA256');
    expect(requests[0]?.headers['x-amz-date']).toBe('20261110T003147Z');
  });

  it('passes the bytes through unchanged', async () => {
    const { transport, requests } = recordingTransport(200);
    const store = new S3ObjectStore(options(transport));

    const bytes = new TextEncoder().encode('{"a":1}');
    await store.put('runs/run_123/record.json', bytes);

    expect(requests[0]?.body).toBeDefined();
    expect(new TextDecoder().decode(requests[0]?.body as Uint8Array)).toBe('{"a":1}');
  });

  it('raises a failure when the store refuses the write', async () => {
    // A refusal is a failure, never a silent success — the caller has to
    // know the bytes are not in the store.
    const { transport } = recordingTransport(500);
    const store = new S3ObjectStore(options(transport));

    await expect(
      store.put('runs/run_123/record.json', new Uint8Array()),
    ).rejects.toBeInstanceOf(ObjectStoreError);
  });

  it('names the key and the status in the refusal', async () => {
    const { transport } = recordingTransport(503);
    const store = new S3ObjectStore(options(transport));

    await expect(store.put('runs/run_123/record.json', new Uint8Array())).rejects.toThrow(
      /runs\/run_123\/record\.json.*status 503/,
    );
  });

  it('gets an object back', async () => {
    const { transport } = recordingTransport(200, '{"ok":true}');
    const store = new S3ObjectStore(options(transport));

    const bytes = await store.get('runs/run_123/record.json');
    expect(bytes).toBeDefined();
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('{"ok":true}');
  });

  it('reports an absent object as undefined, not as an error', async () => {
    const { transport } = recordingTransport(404);
    const store = new S3ObjectStore(options(transport));

    expect(await store.get('runs/run_123/record.json')).toBeUndefined();
  });

  it('deletes an object', async () => {
    const { transport, requests } = recordingTransport(204);
    const store = new S3ObjectStore(options(transport));

    await store.delete('runs/run_123/record.json');
    expect(requests[0]?.method).toBe('DELETE');
  });

  it('does not fail when an absent object is deleted', async () => {
    // The purge job may run twice over the same row, and the second run
    // must succeed.
    const { transport } = recordingTransport(404);
    const store = new S3ObjectStore(options(transport));

    await expect(store.delete('runs/run_123/record.json')).resolves.toBeUndefined();
  });

  it('raises a failure when a delete is refused', async () => {
    const { transport } = recordingTransport(500);
    const store = new S3ObjectStore(options(transport));

    await expect(store.delete('runs/run_123/record.json')).rejects.toBeInstanceOf(
      ObjectStoreError,
    );
  });

  it('signs a get and a delete too', async () => {
    const { transport, requests } = recordingTransport(200);
    const store = new S3ObjectStore(options(transport));

    await store.get('runs/run_123/record.json');
    await store.delete('runs/run_123/record.json');

    expect(requests.every((r) => r.headers['authorization'] !== undefined)).toBe(true);
  });

  it('does not read a credential from the environment', async () => {
    // The adapter takes its credentials as arguments and never looks at
    // `process.env` — a key must not appear in the adapter's source.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../packages/artefacts/src/object-store.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(source).not.toContain('process.env');
  });
});
