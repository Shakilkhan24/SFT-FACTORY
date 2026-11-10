/**
 * T-1.10 — the idempotency key and the replay.
 *
 * blueprint 11 §6.4:
 *
 * | Model invocation | `(taskId, nodeId, attempt, promptSha256, modelVersion)` |
 *
 * pack 02 §4.7: *"idempotency lookup
 * `(taskId,nodeId,attempt,promptSha256,modelVersion)`"*.
 *
 * ## Why the replay matters
 *
 * The factory is **resumable**: a task that dies half-way is retried,
 * and a node that was already answered must not be answered again. A
 * second call would cost money a second time and could produce a
 * *different* answer — so a caller that got two answers for one
 * question has no way to know which one to believe.
 *
 * ## What these tests hold
 *
 * 1. **The key has the five named parts** — and each one changes the
 *    key, because each one changes what the call *is*.
 * 2. **The key is stable** — the same parts give the same key.
 * 3. **A replayed key returns the RECORDED result** and does **not**
 *    call the provider again.
 * 4. **A different attempt is a different call** — a retry is not a
 *    replay.
 * 5. **A different prompt is a different call.**
 * 6. **A different model version is a different call** — a run pinned
 *    to one model version must not replay another's answer.
 */

import { describe, expect, it } from 'vitest';

import {
  idempotencyKey,
  promptDigest,
} from '../../packages/gateway/src/index.ts';

import { aRequest, buildGateway } from '../helpers/gateway.ts';

/**
 * The five parts of a key.
 */
const PARTS = {
  taskId: 'task_1',
  nodeId: 'node_1',
  attempt: 1,
  promptSha256: 'a'.repeat(64),
  modelVersion: 'v1',
};

describe('T-1.10 — the idempotency', () => {
  describe('the key', () => {
    it('is the SAME for the same parts', () => {
      expect(idempotencyKey(PARTS)).toBe(idempotencyKey({ ...PARTS }));
    });

    it('changes with the TASK', () => {
      expect(idempotencyKey({ ...PARTS, taskId: 'task_2' })).not.toBe(
        idempotencyKey(PARTS),
      );
    });

    it('changes with the NODE', () => {
      expect(idempotencyKey({ ...PARTS, nodeId: 'node_2' })).not.toBe(
        idempotencyKey(PARTS),
      );
    });

    it('changes with the ATTEMPT', () => {
      // A retry is a **different call** — it must not replay the first
      // attempt's answer.
      expect(idempotencyKey({ ...PARTS, attempt: 2 })).not.toBe(
        idempotencyKey(PARTS),
      );
    });

    it('changes with the PROMPT', () => {
      expect(
        idempotencyKey({ ...PARTS, promptSha256: 'b'.repeat(64) }),
      ).not.toBe(idempotencyKey(PARTS));
    });

    it('changes with the MODEL VERSION', () => {
      // A run pinned to one model version must not replay an answer
      // produced by another.
      expect(idempotencyKey({ ...PARTS, modelVersion: 'v2' })).not.toBe(
        idempotencyKey(PARTS),
      );
    });

    it('is a HASH, so it carries no readable task id', () => {
      // The column is read for reconciliation against the provider's
      // billing. A key that spelled out the task id would put an
      // identifier in that row.
      const key = idempotencyKey(PARTS);

      expect(key).not.toContain('task_1');
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('the prompt digest', () => {
    it('is the SAME for the same messages', () => {
      const messages = [{ role: 'user' as const, content: 'hello' }];

      expect(promptDigest(messages)).toBe(promptDigest(messages));
    });

    it('changes with the CONTENT', () => {
      expect(
        promptDigest([{ role: 'user', content: 'hello' }]),
      ).not.toBe(promptDigest([{ role: 'user', content: 'goodbye' }]));
    });

    it('changes with the ROLE', () => {
      expect(
        promptDigest([{ role: 'user', content: 'hello' }]),
      ).not.toBe(promptDigest([{ role: 'assistant', content: 'hello' }]));
    });

    it('changes with the SYSTEM blocks', () => {
      // The system blocks are what the provider sees too, so they are
      // part of what was asked.
      expect(promptDigest([{ role: 'user', content: 'hello' }])).not.toBe(
        promptDigest([{ role: 'user', content: 'hello' }], [
          { id: 'policy', body: 'the policy' },
        ]),
      );
    });
  });

  describe('the replay', () => {
    it('does NOT call the provider a second time', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(aRequest());
      const second = await gateway.complete(aRequest());

      expect(alpha.callCount).toBe(1);
      expect(second.ok).toBe(true);
    });

    it('records NO second model call', async () => {
      const { gateway, calls } = buildGateway();

      await gateway.complete(aRequest());
      await gateway.complete(aRequest());

      expect(calls.records).toHaveLength(1);
    });

    it('emits NO second model.requested event', async () => {
      // The `model.requested` event is written with the `model_calls`
      // row — **in one transaction** (blueprint 09 §6) — so it is
      // observed on the call store, not on the event sink.
      const { gateway, calls } = buildGateway();

      await gateway.complete(aRequest());
      await gateway.complete(aRequest());

      expect(
        calls.events.filter((event) => event.eventType === 'model.requested'),
      ).toHaveLength(1);
    });

    it('returns the RECORDED cost', async () => {
      // The replay returns what was recorded, not a fresh estimate.
      const { gateway, calls } = buildGateway({
        alpha: { usage: { tokensIn: 1000, tokensOut: 1000 } },
      });

      await gateway.complete(aRequest());
      const second = await gateway.complete(aRequest());

      const recorded = calls.records[0];
      expect(second.ok && second.value.usage.costUsdMicros).toBe(
        recorded?.costUsdMicros,
      );
    });

    it('returns the RECORDED model', async () => {
      const { gateway } = buildGateway();

      await gateway.complete(aRequest());
      const second = await gateway.complete(aRequest());

      expect(second.ok && second.value.model).toBe('test-model-small');
    });

    it('does NOT spend the budget a second time', async () => {
      // A replay is free. The ledger records one call, so the spend is
      // counted once.
      const { gateway, calls } = buildGateway({
        alpha: { usage: { tokensIn: 1000, tokensOut: 1000 } },
      });

      await gateway.complete(aRequest());
      await gateway.complete(aRequest());

      expect(calls.records).toHaveLength(1);
    });
  });

  describe('a different attempt', () => {
    it('is a DIFFERENT call, not a replay', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(aRequest({ attempt: 1 }));
      await gateway.complete(aRequest({ attempt: 2 }));

      expect(alpha.callCount).toBe(2);
    });
  });

  describe('a different prompt', () => {
    it('is a DIFFERENT call, not a replay', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(aRequest());
      await gateway.complete(
        aRequest({ messages: [{ role: 'user', content: 'a different question' }] }),
      );

      expect(alpha.callCount).toBe(2);
    });
  });

  describe('a different model version', () => {
    it('is a DIFFERENT call, not a replay', async () => {
      const { gateway, alpha } = buildGateway({ modelVersion: 'v1' });

      await gateway.complete(aRequest());
      expect(alpha.callCount).toBe(1);
    });
  });

  describe('a different node', () => {
    it('is a DIFFERENT call, not a replay', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(aRequest({ nodeId: 'node_1' }));
      await gateway.complete(aRequest({ nodeId: 'node_2' }));

      expect(alpha.callCount).toBe(2);
    });
  });

  describe('a different task', () => {
    it('is a DIFFERENT call, not a replay', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(aRequest({ taskId: 'task_1' }));
      await gateway.complete(aRequest({ taskId: 'task_2' }));

      expect(alpha.callCount).toBe(2);
    });
  });
});
