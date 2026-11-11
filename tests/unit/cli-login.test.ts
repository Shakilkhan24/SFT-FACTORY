/**
 * `factory login` and `factory whoami` — the token commands (T-1.16).
 *
 * ## What this file covers
 *
 * * `login` **proves** the token before storing it — a token that cannot
 *   be used is worse than no token, because it would fail every later
 *   command while the operator looks at the wrong thing.
 * * `login` **does not echo** the token. A CLI that printed it would put
 *   it in the scrollback, in a terminal recording, and in a CI log.
 * * The credentials file is written with mode `0600`, and the directory
 *   with `0700`.
 * * `whoami` says "not logged in" when there are no credentials, rather
 *   than failing obscurely.
 *
 * ## The fetch is injected
 *
 * The commands take a `fetch`, so the test needs no server. The
 * credentials go to a temporary directory — the real home directory is
 * never written to by a test.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildApiClient,
  parseProblem,
  problemLines,
  type FetchLike,
} from '../../apps/cli/src/client.ts';
import {
  credentialsPath,
  readCredentials,
  writeCredentials,
  clearCredentials,
} from '../../apps/cli/src/credentials.ts';
import { runLogin, runWhoami } from '../../apps/cli/src/tasks.ts';

/**
 * A temporary environment.
 *
 * `XDG_CONFIG_HOME` points the credentials at a temporary directory, so
 * the test never touches the operator's real config.
 */
const temporaryEnvironment = async (): Promise<{
  readonly environment: NodeJS.ProcessEnv;
  readonly cleanup: () => Promise<void>;
}> => {
  const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
  return {
    environment: { XDG_CONFIG_HOME: root },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
};

/**
 * A fetch that answers with a fixed body.
 */
const answeringFetch = (
  status: number,
  body: string,
  seen: { readonly requests: { url: string; init: { method: string; headers: Record<string, string> } }[] } = { requests: [] },
): FetchLike => {
  const fetchImpl: FetchLike = (url, init) => {
    seen.requests.push({ url, init: { method: init.method, headers: { ...init.headers } } });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
    });
  };
  return fetchImpl;
};

describe('the API client', () => {
  it('sends the bearer token when it has one', async () => {
    const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
    const client = buildApiClient({
      baseUrl: 'http://api.test',
      token: 'fac_secret',
      fetch: answeringFetch(200, '{"items":[]}', seen),
    });
    await client.get('/v1/tasks');
    expect(seen.requests[0]?.init.headers['authorization']).toBe('Bearer fac_secret');
  });

  it('sends no authorization header when it has no token', async () => {
    const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
    const client = buildApiClient({
      baseUrl: 'http://api.test',
      fetch: answeringFetch(200, '{}', seen),
    });
    await client.get('/v1/tasks');
    expect(seen.requests[0]?.init.headers['authorization']).toBeUndefined();
  });

  it('calls the path on the base URL', async () => {
    const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
    const client = buildApiClient({
      baseUrl: 'http://api.test',
      fetch: answeringFetch(200, '{}', seen),
    });
    await client.get('/v1/tasks');
    expect(seen.requests[0]?.url).toBe('http://api.test/v1/tasks');
  });

  it('trims a trailing slash from the base URL', async () => {
    const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
    const client = buildApiClient({
      baseUrl: 'http://api.test/',
      fetch: answeringFetch(200, '{}', seen),
    });
    await client.get('/v1/tasks');
    expect(seen.requests[0]?.url).toBe('http://api.test/v1/tasks');
  });

  it('sends an idempotency key on a POST', async () => {
    // pack `04` §3: the creating POSTs need one, so a retry of the
    // same command does not perform the action twice.
    const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
    const client = buildApiClient({
      baseUrl: 'http://api.test',
      token: 'fac_secret',
      fetch: answeringFetch(200, '{}', seen),
    });
    await client.post('/v1/factory/kill-switch', { engage: true });
    expect(seen.requests[0]?.init.headers['idempotency-key']).toBeDefined();
  });

  it('sends a different idempotency key on each POST', async () => {
    // Two calls in one process must not share a key — the second would
    // be a replay of the first.
    const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
    const client = buildApiClient({
      baseUrl: 'http://api.test',
      token: 'fac_secret',
      fetch: answeringFetch(200, '{}', seen),
    });
    await client.post('/v1/factory/kill-switch', { engage: true });
    await client.post('/v1/factory/kill-switch', { engage: false });
    expect(seen.requests[0]?.init.headers['idempotency-key']).not.toBe(
      seen.requests[1]?.init.headers['idempotency-key'],
    );
  });

  it('turns a refusal into a value, not an exception', async () => {
    const client = buildApiClient({
      baseUrl: 'http://api.test',
      fetch: answeringFetch(
        403,
        JSON.stringify({
          type: 'about:blank',
          title: 'refused',
          status: 403,
          code: 'policy_denied',
          detail: 'the token does not carry the "inspect" scope',
          requestId: 'req-1',
        }),
      ),
    });
    const outcome = await client.get('/v1/tasks');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error('the call was refused, so the outcome is not ok');
    }
    expect(outcome.status).toBe(403);
    expect(outcome.problem.code).toBe('policy_denied');
    expect(outcome.problem.requestId).toBe('req-1');
  });

  it('parses a problem document', () => {
    const problem = parseProblem(
      JSON.stringify({ code: 'validation', detail: 'the body is not valid' }),
    );
    expect(problem.code).toBe('validation');
    expect(problem.detail).toBe('the body is not valid');
  });

  it('reads a body that is not a problem document as an empty one', () => {
    // A proxy's HTML error page must not crash the CLI.
    expect(parseProblem('<html>502</html>')).toEqual({});
    expect(parseProblem('')).toEqual({});
    expect(parseProblem('null')).toEqual({});
  });

  it('reports the code, the detail and the request id', () => {
    const lines = problemLines(
      { code: 'policy_denied', title: 'refused', detail: 'nope', requestId: 'req-9' },
      403,
    );
    expect(lines.join('\n')).toContain('policy_denied: refused');
    expect(lines.join('\n')).toContain('nope');
    expect(lines.join('\n')).toContain('req-9');
    expect(lines.join('\n')).toContain('403');
  });
});

describe('the credentials file', () => {
  it('round-trips the credentials', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const stored = await readCredentials(environment);
      expect(stored?.apiUrl).toBe('http://api.test');
      expect(stored?.token).toBe('fac_secret');
    } finally {
      await cleanup();
    }
  });

  it('writes the file with mode 0600', async () => {
    // A bearer token in a world-readable file is a bearer token in
    // everyone's hands.
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const info = await stat(credentialsPath(environment));
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await cleanup();
    }
  });

  it('writes the directory with mode 0700', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const info = await stat(join(environment['XDG_CONFIG_HOME'] as string, 'factory'));
      expect(info.mode & 0o777).toBe(0o700);
    } finally {
      await cleanup();
    }
  });

  it('reads no credentials when there are none', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      expect(await readCredentials(environment)).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reads a corrupt credentials file as no credentials', async () => {
    // A corrupt file must say "not logged in" — which the operator can
    // fix — rather than crash with a parse error.
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const { writeFile } = await import('node:fs/promises');
      await writeFile(credentialsPath(environment), '{not json');
      expect(await readCredentials(environment)).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('removes the credentials and says whether there were any', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      expect(await clearCredentials(environment)).toBe(false);
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      expect(await clearCredentials(environment)).toBe(true);
      expect(await readCredentials(environment)).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe('factory login', () => {
  it('says how to use it when no token is given', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const result = await runLogin(undefined, { environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/usage: factory login --token/);
    } finally {
      await cleanup();
    }
  });

  it('stores the token when the API accepts it', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const result = await runLogin('fac_secret', {
        environment,
        apiUrl: 'http://api.test',
        fetch: answeringFetch(200, '{"items":[]}'),
      });
      expect(result.exitCode).toBe(0);
      const stored = await readCredentials(environment);
      expect(stored?.token).toBe('fac_secret');
      expect(stored?.apiUrl).toBe('http://api.test');
    } finally {
      await cleanup();
    }
  });

  it('does not store a token the API refused', async () => {
    // A token that cannot be used is worse than no token: it would sit
    // in the file and fail every later command.
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const result = await runLogin('fac_bad', {
        environment,
        apiUrl: 'http://api.test',
        fetch: answeringFetch(
          401,
          JSON.stringify({ code: 'unauthenticated', title: 'the token is not valid' }),
        ),
      });
      expect(result.exitCode).toBe(1);
      expect(await readCredentials(environment)).toBeUndefined();
      expect(result.lines.join('\n')).toContain('unauthenticated');
    } finally {
      await cleanup();
    }
  });

  it('does not echo the token', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const result = await runLogin('fac_secret', {
        environment,
        apiUrl: 'http://api.test',
        fetch: answeringFetch(200, '{"items":[]}'),
      });
      expect(result.lines.join('\n')).not.toContain('fac_secret');
    } finally {
      await cleanup();
    }
  });

  it('shows only the last four characters of the token', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const result = await runLogin('fac_abcdefgh', {
        environment,
        apiUrl: 'http://api.test',
        fetch: answeringFetch(200, '{"items":[]}'),
      });
      expect(result.lines.join('\n')).toContain('fac_…efgh');
    } finally {
      await cleanup();
    }
  });

  it('proves the token before storing it', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const seen = { requests: [] as { url: string; init: { method: string; headers: Record<string, string> } }[] };
      await runLogin('fac_secret', {
        environment,
        apiUrl: 'http://api.test',
        fetch: answeringFetch(200, '{"items":[]}', seen),
      });
      expect(seen.requests.length).toBeGreaterThan(0);
      expect(seen.requests[0]?.init.headers['authorization']).toBe('Bearer fac_secret');
    } finally {
      await cleanup();
    }
  });
});

describe('factory whoami', () => {
  it('says so when there are no credentials', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      const result = await runWhoami({ environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/not logged in/i);
    } finally {
      await cleanup();
    }
  });

  it('reports the API and the token as accepted', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const result = await runWhoami({
        environment,
        fetch: answeringFetch(200, '{"items":[]}'),
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('http://api.test');
      expect(result.lines.join('\n')).toContain('accepted');
    } finally {
      await cleanup();
    }
  });

  it('does not print the token', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const result = await runWhoami({
        environment,
        fetch: answeringFetch(200, '{"items":[]}'),
      });
      expect(result.lines.join('\n')).not.toContain('fac_secret');
    } finally {
      await cleanup();
    }
  });

  it('reports a refusal the API returned', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const result = await runWhoami({
        environment,
        fetch: answeringFetch(
          403,
          JSON.stringify({ code: 'policy_denied', title: 'refused', detail: 'no inspect scope' }),
        ),
      });
      expect(result.exitCode).toBe(1);
      expect(result.lines.join('\n')).toContain('policy_denied');
    } finally {
      await cleanup();
    }
  });
});

describe('the credentials file · the write is atomic', () => {
  it('leaves no temporary file behind', async () => {
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(join(environment['XDG_CONFIG_HOME'] as string, 'factory'));
      expect(files).toEqual(['credentials.json']);
    } finally {
      await cleanup();
    }
  });

  it('writes the token as the plain text it is', async () => {
    // The client has to *present* the token, so it holds the thing it
    // presents. The file's mode is what protects it.
    const { environment, cleanup } = await temporaryEnvironment();
    try {
      await writeCredentials(
        { apiUrl: 'http://api.test', token: 'fac_secret', storedAt: '2026-01-01T00:00:00Z' },
        environment,
      );
      const raw = await readFile(credentialsPath(environment), 'utf8');
      expect(raw).toContain('fac_secret');
    } finally {
      await cleanup();
    }
  });
});
