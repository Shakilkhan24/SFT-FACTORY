/**
 * `factory kill-switch` — the kill-switch command (T-1.16).
 *
 * ## What this file covers
 *
 * * `on` and `off` are the words the pack uses.
 * * The **reason is required**. A switch engaged without a reason cannot
 *   be released by whoever finds it, because they do not know what it
 *   was for — so the CLI refuses before it calls the API.
 * * The command goes through **the API**, not the database. pack `04` §3
 *   says every access-point call emits an event with
 *   `actor=human:<login>` and `authority.basis='human-access-point'`; a
 *   command that wrote to the database directly would change the
 *   factory without leaving a trace of who changed it — and for the kill
 *   switch that is exactly the trace an operator most needs.
 * * The body is exactly what the API's schema expects:
 *   `{engage: boolean, reason: string}`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../apps/cli/src/client.ts';
import { writeCredentials } from '../../apps/cli/src/credentials.ts';
import { KILL_SWITCH_PATH, runKillSwitch } from '../../apps/cli/src/kill-switch.ts';

/**
 * A temporary environment with credentials already in it.
 */
const withCredentials = async (): Promise<{
  readonly environment: NodeJS.ProcessEnv;
  readonly cleanup: () => Promise<void>;
}> => {
  const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
  const environment: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: root };
  await writeCredentials(
    { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
    environment,
  );
  return {
    environment,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
};

/**
 * A recorded request.
 */
interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/**
 * A fetch that answers with a fixed body and records the requests.
 */
const answeringFetch = (
  status: number,
  body: string,
  seen: { readonly requests: RecordedRequest[] } = { requests: [] },
): FetchLike => {
  const fetchImpl: FetchLike = (url, init) => {
    seen.requests.push({
      url,
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
    });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return fetchImpl;
};

describe('factory kill-switch', () => {
  it('says how to use it with no state', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runKillSwitch(undefined, 'because', { environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/usage: factory kill-switch on\|off/);
    } finally {
      await cleanup();
    }
  });

  it('refuses a state that is not on or off', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runKillSwitch('engage', 'because', { environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/usage: factory kill-switch on\|off/);
    } finally {
      await cleanup();
    }
  });

  it('refuses to engage the switch without a reason', async () => {
    // A switch engaged without a reason cannot be released by whoever
    // finds it, because they do not know what it was for.
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runKillSwitch('on', undefined, { environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/needs a --reason/);
    } finally {
      await cleanup();
    }
  });

  it('refuses to engage the switch with a blank reason', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runKillSwitch('on', '   ', { environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/needs a --reason/);
    } finally {
      await cleanup();
    }
  });

  it('does not call the API when the reason is missing', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runKillSwitch('on', undefined, {
        environment,
        fetch: answeringFetch(200, '{}', seen),
      });
      expect(seen.requests).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('engages the switch through the API', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      const result = await runKillSwitch('on', 'the gateway is misbehaving', {
        environment,
        fetch: answeringFetch(200, '{"engaged":true}', seen),
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('engaged');
      expect(seen.requests[0]?.method).toBe('POST');
      expect(seen.requests[0]?.url).toBe(`http://api.test${KILL_SWITCH_PATH}`);
    } finally {
      await cleanup();
    }
  });

  it('sends the body the API\'s schema expects', async () => {
    // `{engage: boolean, reason: string}` — pack `04` §3's shape.
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runKillSwitch('on', 'the gateway is misbehaving', {
        environment,
        fetch: answeringFetch(200, '{}', seen),
      });
      expect(JSON.parse(seen.requests[0]?.body ?? '{}')).toEqual({
        engage: true,
        reason: 'the gateway is misbehaving',
      });
    } finally {
      await cleanup();
    }
  });

  it('releases the switch with engage false', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      const result = await runKillSwitch('off', 'the gateway is fixed', {
        environment,
        fetch: answeringFetch(200, '{"engaged":false}', seen),
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('released');
      expect(JSON.parse(seen.requests[0]?.body ?? '{}')).toEqual({
        engage: false,
        reason: 'the gateway is fixed',
      });
    } finally {
      await cleanup();
    }
  });

  it('sends the bearer token', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runKillSwitch('on', 'because', {
        environment,
        fetch: answeringFetch(200, '{}', seen),
      });
      expect(seen.requests[0]?.headers['authorization']).toBe('Bearer fac_secret');
    } finally {
      await cleanup();
    }
  });

  it('sends an idempotency key', async () => {
    // pack `04` §3: the creating POSTs need one, so a retry of the same
    // command does not perform the action twice.
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runKillSwitch('on', 'because', {
        environment,
        fetch: answeringFetch(200, '{}', seen),
      });
      expect(seen.requests[0]?.headers['idempotency-key']).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it('reports a refusal with its code', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runKillSwitch('on', 'because', {
        environment,
        fetch: answeringFetch(
          403,
          JSON.stringify({
            code: 'policy_denied',
            title: 'refused',
            detail: 'the token does not carry the "intervene" scope',
          }),
        ),
      });
      expect(result.exitCode).toBe(1);
      expect(result.lines.join('\n')).toContain('policy_denied');
      expect(result.lines.join('\n')).toContain('intervene');
    } finally {
      await cleanup();
    }
  });

  it('says so when it is not logged in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    try {
      const result = await runKillSwitch('on', 'because', {
        environment: { XDG_CONFIG_HOME: root },
        fetch: answeringFetch(200, '{}'),
      });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/not logged in/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
