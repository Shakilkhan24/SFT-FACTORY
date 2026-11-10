/**
 * T-1.07 — the scheduler's pure helpers.
 *
 * These are the functions the definition feeds the scheduler: the caps, the
 * idempotency key, the heartbeat interval. They are pure, so they are
 * checked directly rather than through the queue.
 *
 * ## What each one is worth
 *
 * * `capsFromDefinition` — pack 02 §4.8: "Concurrency caps come from the
 *   definition per workflow and globally." A cap that is *absent* must stay
 *   absent, not become zero.
 * * `capBlocks` — the advisory check that says *why* a claim would be
 *   refused. The global cap is the broader constraint, so it is reported
 *   first.
 * * `nodeIdempotencyKey` — pack 02 §4.8: "Node handlers are idempotent by
 *   `(taskId,nodeId,attempt)`."
 * * `heartbeatIntervalMs` — pack 02 §4.8: "heartbeat every `lease/3`".
 */

import { describe, expect, it } from 'vitest';

import {
  capBlocks,
  capsFromDefinition,
  heartbeatIntervalMs,
  nodeIdempotencyKey,
} from '../../packages/orchestrator/src/index.js';

describe('T-1.07 · the scheduler\'s pure helpers', () => {
  describe('capsFromDefinition', () => {
    it('reads the global cap and the per-workflow caps', () => {
      const caps = capsFromDefinition({
        globalMaxConcurrentTasks: 4,
        workflows: [
          { name: 'alpha', maxConcurrent: 2 },
          { name: 'beta', maxConcurrent: 1 },
        ],
      });

      expect(caps.global).toBe(4);
      expect(caps.perWorkflow).toEqual({ alpha: 2, beta: 1 });
    });

    it('leaves an absent global cap absent — not zero', () => {
      const caps = capsFromDefinition({
        workflows: [{ name: 'alpha', maxConcurrent: 2 }],
      });

      expect(caps.global).toBeUndefined();
      expect('global' in caps).toBe(false);
    });

    it('leaves an absent per-workflow cap absent', () => {
      const caps = capsFromDefinition({
        globalMaxConcurrentTasks: 2,
        workflows: [{ name: 'alpha' }],
      });

      expect(caps.perWorkflow).toBeUndefined();
      expect('perWorkflow' in caps).toBe(false);
    });

    it('omits a workflow with no cap from the map', () => {
      const caps = capsFromDefinition({
        workflows: [{ name: 'alpha', maxConcurrent: 2 }, { name: 'beta' }],
      });

      expect(caps.perWorkflow).toEqual({ alpha: 2 });
      expect(caps.perWorkflow?.['beta']).toBeUndefined();
    });
  });

  describe('capBlocks', () => {
    it('blocks when the global cap is reached', () => {
      const blocked = capBlocks(
        { global: 2 },
        { global: 2, perWorkflow: {} },
        undefined,
      );

      expect(blocked).toEqual({ kind: 'cap-reached' });
    });

    it('does not block when the global cap has headroom', () => {
      const blocked = capBlocks(
        { global: 2 },
        { global: 1, perWorkflow: {} },
        undefined,
      );

      expect(blocked).toBeUndefined();
    });

    it('blocks when the named workflow is at its cap', () => {
      const blocked = capBlocks(
        { perWorkflow: { alpha: 1 } },
        { global: 1, perWorkflow: { alpha: 1 } },
        'alpha',
      );

      expect(blocked).toEqual({ kind: 'cap-reached', workflow: 'alpha' });
    });

    it('does not block a workflow with no cap', () => {
      const blocked = capBlocks(
        { perWorkflow: { alpha: 1 } },
        { global: 5, perWorkflow: { alpha: 1 } },
        'beta',
      );

      expect(blocked).toBeUndefined();
    });

    it('reports the global cap first — it is the broader constraint', () => {
      const blocked = capBlocks(
        { global: 1, perWorkflow: { alpha: 1 } },
        { global: 1, perWorkflow: { alpha: 1 } },
        'alpha',
      );

      // The global cap is reported, so the operator learns that adding
      // workflow-specific headroom would not help.
      expect(blocked).toEqual({ kind: 'cap-reached' });
    });
  });

  describe('nodeIdempotencyKey', () => {
    it('is (taskId, nodeId, attempt)', () => {
      expect(nodeIdempotencyKey('task-1', 'node-1', 1)).toBe('task-1:node-1:1');
      expect(nodeIdempotencyKey('task-1', 'node-1', 2)).toBe('task-1:node-1:2');
    });

    it('differs by attempt — a re-queued job is a new attempt', () => {
      expect(nodeIdempotencyKey('t', 'n', 1)).not.toBe(nodeIdempotencyKey('t', 'n', 2));
    });

    it('differs by node', () => {
      expect(nodeIdempotencyKey('t', 'n-1', 1)).not.toBe(nodeIdempotencyKey('t', 'n-2', 1));
    });
  });

  describe('heartbeatIntervalMs', () => {
    it('is lease/3', () => {
      expect(heartbeatIntervalMs(3000)).toBe(1000);
      expect(heartbeatIntervalMs(30000)).toBe(10000);
    });

    it('never returns zero — a zero interval would spin', () => {
      expect(heartbeatIntervalMs(1)).toBe(1);
      expect(heartbeatIntervalMs(2)).toBe(1);
    });
  });
});
