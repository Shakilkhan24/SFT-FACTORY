/**
 * The failure classification and the retry policy (T-1.13).
 *
 * blueprint `08` §4.3 gives ten classes and a default response for each;
 * pack `02` §4.9 restates them as a retry policy. The tests here prove the
 * two statements are the *same* rule, and that the `unknown →
 * workflow.composition` default holds.
 */

import { describe, expect, it } from 'vitest';

import { FAILURE_CLASSES } from '@factory/contracts';

import {
  backoffMs,
  classifyFailure,
  DEFAULT_BACKOFF_BASE_MS,
  ESCALATION_TRIGGER_BY_CLASS,
  RAW_FAILURE_CLASSES,
  RETRY_POLICY_BY_CLASS,
  shouldRetry,
} from '@factory/orchestrator';

describe('the failure taxonomy', () => {
  it('there are ten classes', () => {
    expect(FAILURE_CLASSES).toHaveLength(10);
  });

  it('the raw list is the contracts own list', () => {
    expect([...RAW_FAILURE_CLASSES]).toEqual([...FAILURE_CLASSES]);
  });

  it('every class has a retry policy', () => {
    for (const cls of FAILURE_CLASSES) {
      expect(RETRY_POLICY_BY_CLASS[cls]).toBeDefined();
    }
  });

  it('the policy names the ten classes the blueprint names', () => {
    expect([...Object.keys(RETRY_POLICY_BY_CLASS)].sort()).toEqual(
      [
        'budget.exhausted',
        'context.insufficient',
        'environment.failure',
        'model.capability',
        'model.reasoning',
        'policy.denied',
        'tool.unavailable',
        'unknown',
        'verification.failure',
        'workflow.composition',
      ].sort(),
    );
  });
});

describe('the retry counts', () => {
  it('a model-reasoning failure is retried at most twice', () => {
    expect(RETRY_POLICY_BY_CLASS['model.reasoning'].maxRetries).toBe(2);
  });

  it('a verification failure is retried at most twice', () => {
    expect(RETRY_POLICY_BY_CLASS['verification.failure'].maxRetries).toBe(2);
  });

  it('a policy denial is never retried', () => {
    // pack 02 §4.9: "0 for `policy.denied`". blueprint 13 §2.3: "Let the
    // orchestrator try and see is not available anywhere in the system."
    expect(RETRY_POLICY_BY_CLASS['policy.denied'].maxRetries).toBe(0);
  });

  it('a tool outage is retried three times', () => {
    expect(RETRY_POLICY_BY_CLASS['tool.unavailable'].maxRetries).toBe(3);
  });

  it('a tool outage backs off', () => {
    expect(RETRY_POLICY_BY_CLASS['tool.unavailable'].backoff).toBe(true);
  });

  it('a model-reasoning failure does not back off', () => {
    // A re-prompt is not a load on a shared resource.
    expect(RETRY_POLICY_BY_CLASS['model.reasoning'].backoff).toBe(false);
  });

  it('a budget exhaustion is never retried', () => {
    // A budget that is spent stays spent; the documented response is
    // "return partial artefacts labelled incomplete to a human".
    expect(RETRY_POLICY_BY_CLASS['budget.exhausted'].maxRetries).toBe(0);
  });

  it('an unknown failure is never retried', () => {
    expect(RETRY_POLICY_BY_CLASS.unknown.maxRetries).toBe(0);
  });
});

describe('shouldRetry', () => {
  it('the first failure of a model-reasoning stage is retried', () => {
    expect(shouldRetry('model.reasoning', 1)).toBe(true);
  });

  it('the second failure of a model-reasoning stage is retried', () => {
    expect(shouldRetry('model.reasoning', 2)).toBe(true);
  });

  it('the third failure of a model-reasoning stage is not retried', () => {
    expect(shouldRetry('model.reasoning', 3)).toBe(false);
  });

  it('a policy denial is never retried, however many attempts were made', () => {
    expect(shouldRetry('policy.denied', 1)).toBe(false);
    expect(shouldRetry('policy.denied', 5)).toBe(false);
  });

  it('a tool outage is retried three times and then not', () => {
    expect(shouldRetry('tool.unavailable', 1)).toBe(true);
    expect(shouldRetry('tool.unavailable', 2)).toBe(true);
    expect(shouldRetry('tool.unavailable', 3)).toBe(true);
    expect(shouldRetry('tool.unavailable', 4)).toBe(false);
  });

  it('an unknown failure is not retried', () => {
    expect(shouldRetry('unknown', 1)).toBe(false);
  });
});

describe('the unknown to workflow.composition default', () => {
  it('an unknown failure is treated as a workflow composition failure', () => {
    const classification = classifyFailure('unknown');
    expect(classification.effective).toBe('workflow.composition');
  });

  it('the raw class is preserved', () => {
    // The raw class is what the run record keeps. Losing it would destroy
    // the signal the rule exists to preserve.
    const classification = classifyFailure('unknown');
    expect(classification.raw).toBe('unknown');
  });

  it('every other class is treated as itself', () => {
    for (const cls of FAILURE_CLASSES) {
      if (cls === 'unknown') {
        continue;
      }
      expect(classifyFailure(cls).effective).toBe(cls);
    }
  });

  it('a workflow-composition failure is not retried', () => {
    // "Fix the workflow, not the agent."
    expect(classifyFailure('workflow.composition').policy.maxRetries).toBe(0);
  });
});

describe('the escalation', () => {
  it('a policy denial escalates', () => {
    // blueprint 08 §4.3: "Not retried by the agent. Route to a human with
    // the policy reason."
    expect(classifyFailure('policy.denied').escalate).toBe(true);
  });

  it('no other class escalates', () => {
    for (const cls of FAILURE_CLASSES) {
      if (cls === 'policy.denied') {
        continue;
      }
      expect(classifyFailure(cls).escalate).toBe(false);
    }
  });

  it('a policy denial escalates under the policy-escalation trigger', () => {
    expect(ESCALATION_TRIGGER_BY_CLASS['policy.denied']).toBe('policy-escalation');
  });
});

describe('the backoff', () => {
  it('the first retry has no delay', () => {
    expect(backoffMs(1)).toBe(0);
  });

  it('the delay doubles with each attempt', () => {
    expect(backoffMs(2)).toBe(DEFAULT_BACKOFF_BASE_MS);
    expect(backoffMs(3)).toBe(DEFAULT_BACKOFF_BASE_MS * 2);
    expect(backoffMs(4)).toBe(DEFAULT_BACKOFF_BASE_MS * 4);
  });

  it('the base is injectable so the tests are deterministic', () => {
    expect(backoffMs(2, 50)).toBe(50);
    expect(backoffMs(3, 50)).toBe(100);
  });

  it('the delay is bounded so it cannot overflow', () => {
    expect(backoffMs(1000)).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});

describe('the classification is total', () => {
  it('every class classifies without throwing', () => {
    for (const cls of FAILURE_CLASSES) {
      const classification = classifyFailure(cls);
      expect(classification.policy).toBeDefined();
      expect(classification.effective).toBeDefined();
    }
  });
});
