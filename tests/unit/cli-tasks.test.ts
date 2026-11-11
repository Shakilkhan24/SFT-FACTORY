/**
 * `factory tasks` — the task commands (T-1.16).
 *
 * ## What this file covers
 *
 * * `tasks ls` reads `GET /v1/tasks` and formats what comes back.
 * * `tasks show <taskId>` reads `GET /v1/tasks/{id}`.
 * * A **list that arrived as a bare array** is still a list — the CLI
 *   must not read it as "no tasks", because a factory full of tasks
 *   showing "no tasks" is the worst possible lie.
 * * A refusal is reported with its **code**, so a script can match on
 *   it.
 * * The task id is **URL-encoded** into the path — a task id with a
 *   slash in it must not become two path segments.
 *
 * ## The fetch is injected
 *
 * No server is needed, and the assertions are on the **request** the
 * command made as well as on what it printed.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../apps/cli/src/client.ts';
import { writeCredentials } from '../../apps/cli/src/credentials.ts';
import { itemsOf, runTasksList, runTasksShow } from '../../apps/cli/src/tasks.ts';

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

describe('the items of a list', () => {
  it('reads the items of the API\'s envelope', () => {
    expect(itemsOf({ items: [{ id: 'task-1' }] })).toHaveLength(1);
  });

  it('reads a list that arrived as a bare array', () => {
    // A list that read as empty would show "no tasks" for a factory
    // full of them.
    expect(itemsOf([{ id: 'task-1' }])).toHaveLength(1);
  });

  it('reads no items from a body that is neither', () => {
    expect(itemsOf({})).toEqual([]);
    expect(itemsOf(undefined)).toEqual([]);
    expect(itemsOf('nope')).toEqual([]);
    expect(itemsOf({ items: 'nope' })).toEqual([]);
  });
});

describe('factory tasks ls', () => {
  it('lists the tasks the API returned', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runTasksList({
        environment,
        fetch: answeringFetch(
          200,
          JSON.stringify({ items: [{ id: 'task-1', state: 'running' }] }),
        ),
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('task-1');
      expect(result.lines.join('\n')).toContain('running');
    } finally {
      await cleanup();
    }
  });

  it('says so when there are no tasks', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runTasksList({
        environment,
        fetch: answeringFetch(200, JSON.stringify({ items: [] })),
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('no tasks');
    } finally {
      await cleanup();
    }
  });

  it('calls GET /v1/tasks', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runTasksList({
        environment,
        fetch: answeringFetch(200, '{"items":[]}', seen),
      });
      expect(seen.requests[0]?.method).toBe('GET');
      expect(seen.requests[0]?.url).toBe('http://api.test/v1/tasks');
    } finally {
      await cleanup();
    }
  });

  it('presents the stored token as a bearer credential', async () => {
    // The CLI is a **human with a token**, and the API authenticates it
    // by that token (pack `04` §3: "CLI = bearer token `fac_…`"). A
    // request without the header would be refused — so this is the
    // difference between a working CLI and a silent one.
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runTasksList({
        environment,
        fetch: answeringFetch(200, '{"items":[]}', seen),
      });
      expect(seen.requests[0]?.headers['authorization']).toBe('Bearer fac_secret');
    } finally {
      await cleanup();
    }
  });

  it('passes the limit and the state as query parameters', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runTasksList({
        environment,
        limit: 5,
        state: 'running',
        fetch: answeringFetch(200, '{"items":[]}', seen),
      });
      expect(seen.requests[0]?.url).toContain('limit=5');
      expect(seen.requests[0]?.url).toContain('state=running');
    } finally {
      await cleanup();
    }
  });

  it('says so when it is not logged in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    try {
      const result = await runTasksList({
        environment: { XDG_CONFIG_HOME: root },
        fetch: answeringFetch(200, '{"items":[]}'),
      });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/not logged in/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports a refusal with its code', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runTasksList({
        environment,
        fetch: answeringFetch(
          403,
          JSON.stringify({ code: 'policy_denied', title: 'refused', detail: 'no inspect scope' }),
        ),
      });
      expect(result.exitCode).toBe(1);
      expect(result.lines.join('\n')).toContain('policy_denied');
      expect(result.lines.join('\n')).toContain('no inspect scope');
    } finally {
      await cleanup();
    }
  });
});

describe('factory tasks show', () => {
  it('says how to use it with no task id', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runTasksShow(undefined, { environment });
      expect(result.exitCode).toBe(2);
      expect(result.lines.join('\n')).toMatch(/usage: factory tasks show/);
    } finally {
      await cleanup();
    }
  });

  it('shows the task the API returned', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runTasksShow('task-1', {
        environment,
        fetch: answeringFetch(
          200,
          JSON.stringify({ id: 'task-1', state: 'running', workflow: 'pr' }),
        ),
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('id: task-1');
      expect(result.lines.join('\n')).toContain('state: running');
    } finally {
      await cleanup();
    }
  });

  it('URL-encodes the task id', async () => {
    // A task id with a slash in it must not become two path segments.
    const { environment, cleanup } = await withCredentials();
    try {
      const seen = { requests: [] as RecordedRequest[] };
      await runTasksShow('task/with slash', {
        environment,
        fetch: answeringFetch(200, '{"id":"task/with slash"}', seen),
      });
      expect(seen.requests[0]?.url).toBe('http://api.test/v1/tasks/task%2Fwith%20slash');
    } finally {
      await cleanup();
    }
  });

  it('says so when the task is not there', async () => {
    const { environment, cleanup } = await withCredentials();
    try {
      const result = await runTasksShow('task-missing', {
        environment,
        fetch: answeringFetch(404, JSON.stringify({ code: 'not_found', title: 'no such task' })),
      });
      expect(result.exitCode).toBe(1);
      expect(result.lines.join('\n')).toContain('not_found');
    } finally {
      await cleanup();
    }
  });
});
