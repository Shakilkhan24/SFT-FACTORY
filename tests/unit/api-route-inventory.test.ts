/**
 * `api-route-inventory` — **the ticket's third proof** (T-1.14).
 *
 * ## What the ticket requires
 *
 * "a **route-inventory test proves no endpoint accepts free-form agent
 * instructions**".
 *
 * blueprint `13` §3.1: "**Deliberately excluded:** a generic 'chat with
 * the agent' access point." ADR-0002's rejected alternative: "Humans
 * operating agents directly (bypassing access points) … the 'chat with
 * the agent' pattern. It makes governance unenforceable and leaves no
 * durable record of authority."
 *
 * HR-13: "no chat-with-agent endpoint, no free-form instruction channel,
 * no auto-apply of proposals — ever."
 *
 * ## Why the proof is structural
 *
 * The test walks the **route inventory** (`apps/api/src/routes.ts`), and
 * the app registers its routes **from** that inventory. So the inventory
 * is the complete list of routes the app serves — there is no second
 * table to drift.
 *
 * That matters: a test that asserted against a hand-written list of
 * endpoints would pass while a new endpoint was added. This one cannot.
 *
 * ## What is checked
 *
 * 1. **No body schema declares a free-form instruction field.** The
 *    field names are the shapes a chat endpoint would have to take.
 * 2. **Every body schema is strict.** A non-strict schema would let an
 *    unknown field through — and `instructions` is an unknown field to a
 *    strict schema.
 * 3. **The app serves exactly the inventory.** The app's route table and
 *    the inventory are the same set — no route exists only in the app,
 *    and none exists only in the inventory.
 * 4. **No route is a chat.** No path carries a chat-shaped name, and no
 *    route accepts a body that is a bare instruction.
 */

import { describe, expect, it } from 'vitest';

import { buildHarness } from '../../apps/api/src/harness.js';
import { bind } from '../../apps/api/src/handlers/index.js';
import { handled } from '../../apps/api/src/ports.js';
import type { RegisteredRoute } from '../../apps/api/src/app.js';
import { FREE_FORM_FIELD_NAMES, ROUTES } from '../../apps/api/src/routes.js';
import type { RouteSpec } from '../../apps/api/src/routes.js';

/**
 * The field names a body schema declares, at any depth.
 *
 * The walk is recursive because a nested object is just as capable of
 * carrying an instruction as a top-level one — a `source: { instructions }`
 * would be just as much an instruction channel.
 */
const fieldNamesOf = (schema: unknown, seen = new Set<unknown>()): string[] => {
  if (schema === null || typeof schema !== 'object') {
    return [];
  }
  if (seen.has(schema)) {
    return [];
  }
  seen.add(schema);

  const record = schema as Record<string, unknown>;
  const names: string[] = [];

  // A Zod object holds its shape under `_def.shape()` (a getter) or
  // `shape` (a plain property, which is what `.strict()` produces).
  const shape = readShape(record);
  if (shape !== undefined) {
    for (const key of Object.keys(shape)) {
      names.push(key);
      names.push(...fieldNamesOf(shape[key], seen));
    }
  }

  // A discriminated union holds its options under `_def.options()`.
  const options = readOptions(record);
  for (const option of options) {
    names.push(...fieldNamesOf(option, seen));
  }

  return names;
};

/**
 * The shape of a Zod object schema, or `undefined`.
 */
const readShape = (
  record: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const def = record['_def'] as Record<string, unknown> | undefined;
  if (def === undefined) {
    return undefined;
  }
  const shapeGetter = def['shape'];
  if (typeof shapeGetter === 'function') {
    const shape = (shapeGetter as () => unknown).call(def);
    return typeof shape === 'object' && shape !== null
      ? (shape as Record<string, unknown>)
      : undefined;
  }
  const shape = def['shape'];
  return typeof shape === 'object' && shape !== null
    ? (shape as Record<string, unknown>)
    : undefined;
};

/**
 * The options of a Zod union schema.
 */
const readOptions = (record: Record<string, unknown>): unknown[] => {
  const def = record['_def'] as Record<string, unknown> | undefined;
  if (def === undefined) {
    return [];
  }
  const optionsGetter = def['options'];
  if (typeof optionsGetter === 'function') {
    const options = (optionsGetter as () => unknown).call(def);
    return Array.isArray(options) ? options : [];
  }
  const options = def['options'];
  return Array.isArray(options) ? options : [];
};

/**
 * Is this schema strict?
 *
 * A Zod object carries `unknownKeys` in its `_def`; `"strict"` is the
 * value that rejects unknown keys.
 */
const isStrict = (schema: unknown): boolean => {
  if (schema === null || typeof schema !== 'object') {
    return false;
  }
  const def = (schema as Record<string, unknown>)['_def'] as
    | Record<string, unknown>
    | undefined;
  if (def === undefined) {
    return false;
  }
  return def['unknownKeys'] === 'strict';
};

/**
 * The routes that carry a body.
 */
const routesWithBodies = (): readonly RouteSpec[] =>
  ROUTES.filter((route) => route.body !== undefined);

describe('the route inventory', () => {
  it('no body schema declares a free-form instruction field', () => {
    const offenders: string[] = [];

    for (const route of routesWithBodies()) {
      const names = fieldNamesOf(route.body);
      for (const name of names) {
        if (FREE_FORM_FIELD_NAMES.includes(name)) {
          offenders.push(`${route.method} ${route.path} declares "${name}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every body schema is strict, so an unknown field is rejected', () => {
    const loose: string[] = [];

    for (const route of routesWithBodies()) {
      if (!isStrict(route.body)) {
        loose.push(`${route.method} ${route.path}`);
      }
    }

    expect(loose).toEqual([]);
  });

  it('a handler bound to a route the inventory does not have is a hard error', () => {
    // The binding names its route by path, so a typo is caught at
    // registration rather than shipping as a route that answers `404`
    // for an access point the pack says exists — the worst kind of bug,
    // because a client that believes the access point exists silently
    // gets nothing.
    //
    // So the guard has to **throw**. If it merely returned, the handler
    // would be dead code and the route it was meant to serve would have
    // none — and nothing would say so.
    const handlers = new Map<string, RegisteredRoute['handler']>();

    expect(() =>
      bind(handlers, 'POST', '/v1/not-a-real-route', () =>
        Promise.resolve(handled({ ok: true })),
      ),
    ).toThrow(/not in the inventory/);
  });

  it('a body with an instruction field is rejected at the boundary', async () => {
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        cookie: `factory_session=${harness.sessionId}`,
        'x-csrf-token': harness.csrfToken,
        'idempotency-key': 'key-instructions',
        'content-type': 'application/json',
      },
      payload: {
        repo: 'owner/repo',
        source: { kind: 'manual', title: 'a title', body: 'a body' },
        instructions: 'please refactor everything you can find',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const body = response.json<{ code: string }>();
    expect(body.code).toBe('validation');

    await harness.close();
  });

  it('no route path names a chat with an agent', () => {
    // The check is on the path's **segments**, and it matches whole
    // segments — a substring match would flag `/v1/tasks` on the "ask"
    // inside "task", which is not a chat endpoint.
    const chatShapes = new Set([
      'chat',
      'chats',
      'message',
      'messages',
      'prompt',
      'prompts',
      'conversation',
      'conversations',
      'ask',
      'query',
      'queries',
      'instruct',
      'instructions',
    ]);

    const offenders: string[] = [];
    for (const route of ROUTES) {
      for (const segment of route.path.split('/')) {
        if (chatShapes.has(segment.toLowerCase())) {
          offenders.push(`${route.method} ${route.path}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the app serves exactly the routes in the inventory', async () => {
    const harness = await buildHarness();

    // What the app **registered**, from Fastify's own `onRoute` hook —
    // not what the inventory says. Fastify adds the `HEAD` method
    // alongside every `GET`, so the comparison drops it.
    //
    // The router's path uses `:id`; the inventory's uses `{id}` (pack
    // `04` §3's notation). The comparison translates the router's path
    // back, so the two are compared in the inventory's notation.
    const registered = harness.registeredRoutes
      .map((route) => `${route.method} ${route.url.replace(/:([^/]+)/g, '{$1}')}`)
      .filter((line) => !line.startsWith('HEAD '))
      .sort();

    const inventory = ROUTES.map(
      (route) => `${route.method} ${route.path}`,
    ).sort();

    expect(registered).toEqual(inventory);
    await harness.close();
  });

  it('the inventory covers the six access points of blueprint 13', () => {
    const accessPoints = new Set(ROUTES.map((route) => route.accessPoint));

    expect([...accessPoints].sort()).toEqual([
      'amend-factory',
      'approve',
      'define-intent',
      'inspect',
      'intervene',
      'review',
    ]);
  });

  it('every mutating route needs an idempotency key', async () => {
    const harness = await buildHarness();

    const mutating = ROUTES.filter(
      (route) => route.mutating && route.auth !== 'public',
    );

    for (const route of mutating) {
      const path = route.path.replace('{id}', 'task-1').replace(
        '{taskId}',
        'task-1',
      );
      const response = await harness.app.inject({
        method: route.method,
        url: path,
        headers: {
          cookie: `factory_session=${harness.sessionId}`,
          'x-csrf-token': harness.csrfToken,
          'content-type': 'application/json',
        },
        payload: {},
      });

      // The refusal is about the missing key — so the status is 400 and
      // the code is `validation`. A different status would mean the call
      // failed earlier for an unrelated reason.
      expect(
        response.statusCode,
        `${route.method} ${route.path} did not refuse the missing key`,
      ).toBe(400);
      const body = response.json<{ code: string; detail: string }>();
      expect(body.code).toBe('validation');
      expect(body.detail).toContain('idempotency-key');
    }

    await harness.close();
  });

  it('the idempotency key is refused before the body is validated', async () => {
    // The order matters: a caller that omitted the key should be told
    // about the key, not about their body. And a malformed body must
    // not consume the key — so the caller can fix the body and retry
    // with the same key.
    const harness = await buildHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: {
        cookie: `factory_session=${harness.sessionId}`,
        'x-csrf-token': harness.csrfToken,
        'content-type': 'application/json',
      },
      payload: { repo: 'owner/repo' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ detail: string }>();
    expect(body.detail).toContain('idempotency-key');

    // Nothing was recorded — the key check came first, and the body was
    // never parsed.
    expect(harness.intents.recorded).toHaveLength(0);
    await harness.close();
  });
});
