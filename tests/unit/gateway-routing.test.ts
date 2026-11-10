/**
 * T-1.10 — the routing decision.
 *
 * blueprint 11 §9.3: *"Routing is a **declarative policy** in the factory
 * definition, evaluated per request."*
 *
 * ## What these tests hold
 *
 * 1. **A role routes to its class.** The rule's `match` names the
 *    role; the rule's `use` names the class; the class names the
 *    primary and the fallbacks.
 * 2. **The first matching rule wins.** The rules are ordered, and the
 *    order is the operator's.
 * 3. **A role no rule matches is a refusal.** The gateway does not
 *    fall back to a default model — the operator decides which model
 *    answers which role.
 * 4. **A class that names an undeclared provider is a refusal.**
 * 5. **A fallback to the same provider is rejected** — blueprint 11
 *    §9.3, NFR-09: *"A fallback to the same provider under the same
 *    failure mode is not a fallback. The policy validation rejects a
 *    fallback whose provider and trigger match the primary's."*
 */

import { describe, expect, it } from 'vitest';

import {
  resolveRoute,
  validateRoutingPolicy,
} from '../../packages/gateway/src/index.ts';

import { THE_POLICY } from '../helpers/gateway.ts';

describe('T-1.10 — the routing decision', () => {
  describe('resolving a route', () => {
    it('routes a role to its class', () => {
      const resolved = resolveRoute(THE_POLICY, { role: 'worker' });

      expect(resolved.ok).toBe(true);
      expect(resolved.ok && resolved.route.className).toBe('cheap');
      expect(resolved.ok && resolved.route.rule).toBe('cheap');
    });

    it('names the primary FIRST and the fallbacks after', () => {
      const resolved = resolveRoute(THE_POLICY, { role: 'worker' });

      expect(resolved.ok).toBe(true);
      expect(resolved.ok && resolved.route.candidates).toEqual([
        { provider: 'alpha', model: 'test-model-small', kind: 'primary' },
        { provider: 'beta', model: 'test-model-small', kind: 'fallback' },
      ]);
    });

    it('routes a DIFFERENT role to a DIFFERENT class', () => {
      const resolved = resolveRoute(THE_POLICY, { role: 'planner' });

      expect(resolved.ok).toBe(true);
      expect(resolved.ok && resolved.route.candidates[0]?.model).toBe(
        'test-model-large',
      );
    });

    it('matches a rule that names a LIST of roles', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          rules: [
            { match: { role: ['worker', 'sweep', 'ci-repair'] }, use: 'cheap' },
          ],
        },
      };

      expect(resolveRoute(policy, { role: 'sweep' }).ok).toBe(true);
      expect(resolveRoute(policy, { role: 'ci-repair' }).ok).toBe(true);
      expect(resolveRoute(policy, { role: 'planner' }).ok).toBe(false);
    });

    it('takes the FIRST matching rule, not the best', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          rules: [
            { match: { role: 'worker' }, use: 'cheap' },
            { match: { role: 'worker' }, use: 'strong' },
          ],
        },
      };

      const resolved = resolveRoute(policy, { role: 'worker' });

      expect(resolved.ok && resolved.route.className).toBe('cheap');
    });

    it('REFUSES a role no rule matches', () => {
      const resolved = resolveRoute(THE_POLICY, { role: 'nobody-routed' });

      expect(resolved.ok).toBe(false);
      expect(
        resolved.ok === false && resolved.reason.includes('no routing rule matched'),
      ).toBe(true);
    });

    it('does NOT fall back to a default model when no rule matches', () => {
      // The refusal must not name a model. A default would be a model
      // the operator never chose.
      const resolved = resolveRoute(THE_POLICY, { role: 'nobody-routed' });

      expect(resolved.ok === false && resolved.reason).not.toContain(
        'test-model',
      );
    });

    it('REFUSES a class the policy does not define', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          rules: [{ match: { role: 'worker' }, use: 'undefined-class' }],
        },
      };

      const resolved = resolveRoute(policy, { role: 'worker' });

      expect(resolved.ok).toBe(false);
      expect(
        resolved.ok === false && resolved.reason.includes('does not define'),
      ).toBe(true);
    });

    it('REFUSES a class that names an undeclared provider', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          classes: {
            cheap: {
              primary: { provider: 'nowhere', model: 'test-model-small' },
              fallbacks: [],
            },
          },
        },
      };

      const resolved = resolveRoute(policy, { role: 'worker' });

      expect(resolved.ok).toBe(false);
      expect(
        resolved.ok === false && resolved.reason.includes('does not declare'),
      ).toBe(true);
    });

    it('REFUSES a class whose FALLBACK names an undeclared provider', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          classes: {
            cheap: {
              primary: { provider: 'alpha', model: 'test-model-small' },
              fallbacks: [{ provider: 'nowhere', model: 'test-model-small' }],
            },
          },
        },
      };

      const resolved = resolveRoute(policy, { role: 'worker' });

      expect(resolved.ok).toBe(false);
      expect(
        resolved.ok === false && resolved.reason.includes('does not declare'),
      ).toBe(true);
    });

    it('matches on a stage when the rule names one', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          rules: [{ match: { role: 'worker', stage: 'build' }, use: 'cheap' }],
        },
      };

      expect(resolveRoute(policy, { role: 'worker', stage: 'build' }).ok).toBe(
        true,
      );
      // A rule that names a stage does NOT match a request without one.
      expect(resolveRoute(policy, { role: 'worker' }).ok).toBe(false);
      expect(
        resolveRoute(policy, { role: 'worker', stage: 'test' }).ok,
      ).toBe(false);
    });
  });

  describe('validating the policy', () => {
    it('accepts the test policy', () => {
      expect(validateRoutingPolicy(THE_POLICY)).toEqual([]);
    });

    it('REJECTS a fallback to the SAME provider as the primary', () => {
      // blueprint 11 §9.3, NFR-09: "A fallback to the same provider
      // under the same failure mode is not a fallback."
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          classes: {
            cheap: {
              primary: { provider: 'alpha', model: 'test-model-small' },
              fallbacks: [{ provider: 'alpha', model: 'test-model-large' }],
            },
            strong: {
              primary: { provider: 'alpha', model: 'test-model-large' },
              fallbacks: [{ provider: 'beta', model: 'test-model-large' }],
            },
          },
        },
      };

      const problems = validateRoutingPolicy(policy);

      expect(problems).toHaveLength(1);
      expect(problems[0]?.reason).toContain('is not a fallback');
      expect(problems[0]?.className).toBe('cheap');
    });

    it('REJECTS a rule that selects an undefined class', () => {
      const policy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          rules: [{ match: { role: 'worker' }, use: 'nowhere' }],
        },
      };

      const problems = validateRoutingPolicy(policy);

      expect(problems).toHaveLength(1);
      expect(problems[0]?.reason).toContain('does not define');
    });
  });
});
