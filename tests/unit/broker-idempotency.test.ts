/**
 * T-1.08 — the **idempotency keys** and the replay.
 *
 * blueprint 11 §6.4:
 *
 * * a tool call is keyed by `(taskId, nodeId, attempt, toolId, argsSha256)`;
 * * an external side effect is keyed by
 *   `(taskId, nodeId, attempt, externalOperation)`;
 * * **"a replayed key returns the recorded result."**
 *
 * ## The rule in three parts
 *
 * 1. **The key's shape.** Two shapes, for two kinds of call. The tool key
 *    includes the arguments' digest, so the same call with *different*
 *    arguments is a different call. The external key includes the
 *    operation's *identity*, so the same side effect however it is spelled
 *    is the *same* side effect.
 * 2. **The replay returns the recorded result** — not a re-execution.
 *    Re-executing would perform the side effect twice, which is the exact
 *    thing the key exists to prevent.
 * 3. **A failed attempt is not replayed.** Only a *succeeded* call has a
 *    result to return. A failure is evidence that the attempt happened, and
 *    a retry of the same attempt must be allowed to try again.
 *
 * ## Why the attempt is in the key
 *
 * A retry after a lease expiry is a *different* attempt, and it must be
 * allowed to perform the effect again — the first attempt's lease expired
 * without a committed result, so the effect may or may not have happened.
 */

import { describe, expect, it } from 'vitest';

import {
  argsDigest,
  externalIdempotencyKey,
  idempotencyKeyFor,
  toolIdempotencyKey,
  type InvocationRequest,
} from '../../packages/broker/src/index.ts';
import {
  aCapability,
  aContext,
  aGrant,
  anEntry,
  buildBroker,
} from '../helpers/broker.ts';

/**
 * A request.
 */
const aRequest = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: { a: 1 },
  context: aContext(),
  grant: aGrant(),
  ...overrides,
});

describe('T-1.08 — the idempotency keys', () => {
  describe('the tool key shape', () => {
    it('is (taskId, nodeId, attempt, toolId, argsSha256)', () => {
      const key = toolIdempotencyKey({
        taskId: 'task_1',
        nodeId: 'node_1',
        attempt: 2,
        capabilityId: 'test.capability',
        argsSha256: 'abc123',
      });

      expect(key).toBe('task_1:node_1:2:test.capability:abc123');
    });

    it('differs when the arguments differ', () => {
      const base = {
        taskId: 'task_1',
        nodeId: 'node_1',
        attempt: 1,
        capabilityId: 'test.capability',
      };

      expect(toolIdempotencyKey({ ...base, argsSha256: argsDigest({ a: 1 }) })).not.toBe(
        toolIdempotencyKey({ ...base, argsSha256: argsDigest({ a: 2 }) }),
      );
    });

    it('is the same when the arguments are the same', () => {
      const base = {
        taskId: 'task_1',
        nodeId: 'node_1',
        attempt: 1,
        capabilityId: 'test.capability',
      };

      expect(toolIdempotencyKey({ ...base, argsSha256: argsDigest({ a: 1 }) })).toBe(
        toolIdempotencyKey({ ...base, argsSha256: argsDigest({ a: 1 }) }),
      );
    });

    it('does not depend on the arguments’ key order', () => {
      // The digest is over the **canonical** JSON, so the same arguments
      // spelled two ways are the same call.
      expect(argsDigest({ a: 1, b: 2 })).toBe(argsDigest({ b: 2, a: 1 }));
    });
  });

  describe('the external key shape', () => {
    it('is (taskId, nodeId, attempt, externalOperation)', () => {
      const key = externalIdempotencyKey({
        taskId: 'task_1',
        nodeId: 'node_1',
        attempt: 2,
        externalOperation: 'push:refs/heads/factory/x',
      });

      expect(key).toBe('task_1:node_1:2:push:refs/heads/factory/x');
    });

    it('does NOT include the arguments’ digest', () => {
      // The operation's *identity* is the key, not its arguments' hash —
      // because an external side effect is the *same* side effect however
      // it is spelled, and re-keying it by its arguments would let a retry
      // with a changed body perform the effect twice.
      const base = {
        taskId: 'task_1',
        nodeId: 'node_1',
        attempt: 1,
        capabilityId: 'test.capability',
      };

      const first = idempotencyKeyFor({
        ...base,
        argsSha256: argsDigest({ body: 'one' }),
        externalOperation: 'push:refs/heads/factory/x',
      });
      const second = idempotencyKeyFor({
        ...base,
        argsSha256: argsDigest({ body: 'two' }),
        externalOperation: 'push:refs/heads/factory/x',
      });

      expect(first).toBe(second);
    });

    it('differs when the operation differs', () => {
      const base = {
        taskId: 'task_1',
        nodeId: 'node_1',
        attempt: 1,
        capabilityId: 'test.capability',
        argsSha256: argsDigest({ body: 'one' }),
      };

      expect(
        idempotencyKeyFor({ ...base, externalOperation: 'push:a' }),
      ).not.toBe(idempotencyKeyFor({ ...base, externalOperation: 'push:b' }));
    });
  });

  describe('the attempt', () => {
    it('differs between attempts', () => {
      // A retry after a lease expiry is a *different* attempt, and it must
      // be allowed to perform the effect again.
      const base = {
        taskId: 'task_1',
        nodeId: 'node_1',
        capabilityId: 'test.capability',
        argsSha256: argsDigest({ a: 1 }),
      };

      expect(idempotencyKeyFor({ ...base, attempt: 1 })).not.toBe(
        idempotencyKeyFor({ ...base, attempt: 2 }),
      );
    });
  });

  describe('the replay', () => {
    it('returns the RECORDED result, not a re-execution', async () => {
      let calls = 0;
      const { broker, invoked } = buildBroker({
        handler: () => {
          calls += 1;
          return { attempt: calls };
        },
      });

      const first = await broker.invoke(aRequest());
      const second = await broker.invoke(aRequest());

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      // The adapter ran **once**. A re-execution would perform the side
      // effect twice, which is the exact thing the key exists to prevent.
      expect(calls).toBe(1);
      expect(invoked).toHaveLength(1);

      // The replayed outcome carries the **recorded** value.
      expect(second.ok && second.value).toEqual({ attempt: 1 });
      expect(second.ok && second.replayed).toBe(true);
      expect(first.ok && first.replayed).toBe(false);
    });

    it('carries the recorded invocation id, not a new one', async () => {
      const { broker, store } = buildBroker();

      const first = await broker.invoke(aRequest());
      const second = await broker.invoke(aRequest());

      expect(first.ok && second.ok && first.invocationId).toBe(
        second.ok ? second.invocationId : undefined,
      );
      // The store holds **one** record: the replay did not write a second.
      expect(store.size()).toBe(1);
    });

    it('does not write a second invocation record on the replay', async () => {
      const { broker, store } = buildBroker();

      await broker.invoke(aRequest());
      await broker.invoke(aRequest());

      expect(store.size()).toBe(1);
      expect(store.events()).toHaveLength(1);
    });

    it('does not re-run the gates', async () => {
      const { broker } = buildBroker();

      await broker.invoke(aRequest());
      const second = await broker.invoke(aRequest());

      // Only step 1 ran: the replay short-circuits before any gate that
      // could perform a side effect.
      expect(second.ok && second.steps).toEqual(['validate-args']);
    });

    it('a different attempt is NOT a replay', async () => {
      let calls = 0;
      const { broker } = buildBroker({
        handler: () => {
          calls += 1;
          return { attempt: calls };
        },
      });

      await broker.invoke(aRequest());
      const second = await broker.invoke(
        aRequest({ context: aContext({ attempt: 2 }) }),
      );

      expect(calls).toBe(2);
      expect(second.ok && second.replayed).toBe(false);
    });

    it('different arguments are NOT a replay', async () => {
      let calls = 0;
      const { broker } = buildBroker({
        handler: () => {
          calls += 1;
          return { attempt: calls };
        },
      });

      await broker.invoke(aRequest({ args: { a: 1 } }));
      const second = await broker.invoke(aRequest({ args: { a: 2 } }));

      expect(calls).toBe(2);
      expect(second.ok && second.replayed).toBe(false);
    });

    it('a FAILED attempt is not replayed — the retry must try again', async () => {
      let calls = 0;
      const { broker } = buildBroker({
        handler: () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('the adapter exploded');
          }
          return { ok: true };
        },
      });

      const first = await broker.invoke(aRequest());
      const second = await broker.invoke(aRequest());

      expect(first.ok).toBe(false);
      expect(second.ok).toBe(true);
      expect(calls).toBe(2);
      expect(second.ok && second.replayed).toBe(false);
    });

    it('a usage error is not swallowed by the replay', async () => {
      // The replay check sits *after* the schema validation, so a call
      // whose arguments do not match is still a usage error.
      const { broker } = buildBroker({
        entries: [
          anEntry(
            aCapability(),
            {
              inputSchema: {
                type: 'object',
                properties: { repo: { type: 'string' } },
                required: ['repo'],
                additionalProperties: false,
              },
            },
          ),
        ],
      });

      const outcome = await broker.invoke(aRequest({ args: { wrong: 'shape' } }));

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.failedAt).toBe('validate-args');
      expect(outcome.ok === false && outcome.failureClass).toBe('workflow.composition');
    });
  });
});
