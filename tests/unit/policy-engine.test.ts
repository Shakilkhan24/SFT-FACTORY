/**
 * T-1.05 — the policy engine's property tests.
 *
 * checklist 02 T-1.05: "**T-1.05's oracle is the security core of the whole
 * system.** The property tests are what make 'deny by default' a fact rather
 * than an intention. Write them first."
 *
 * The exit criteria the ticket names, and where each is proved:
 *
 * | Exit criterion | Test |
 * |---|---|
 * | unknown action ⇒ DENY | `A1.33` |
 * | deny dominates allow (generated cases) | `A1.34` |
 * | an engine exception ⇒ DENY | `A1.35` |
 * | autonomy above level ⇒ DENY | `A1.36` |
 * | E3/E4 ⇒ REQUIRE_APPROVAL | `A1.37` |
 * | identical input+bundle ⇒ identical decision (property) | `A1.38` |
 * | the package has no I/O imports | `A1.39` |
 *
 * Plus the AT-14 equivalent-effect check (`A1.40`), the deny-rule matcher
 * against the pack's own five rules (`A1.41`), the glob matcher (`A1.42`), and
 * the tier rule (`A1.43`).
 *
 * **The generated cases matter more than the examples.** An example proves
 * one path; a generated case proves the *rule*. "Deny dominates" is a claim
 * about the relationship between two rule sets, and the only way to test a
 * relationship is to generate both sides of it.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PolicyInput, type Decision, type PolicyBundle } from '../../packages/contracts/src/index.ts';
import {
  DefaultPolicyEngine,
  evaluate,
  loadPolicyBundle,
  matchesGlob,
  type EffectiveGrant,
  type PolicyEvaluationContext,
} from '../../packages/policy/src/index.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A grant that allows the ordinary v1 capabilities.
 *
 * The `allow` list holds **scopes**, not capability ids (pack 04 §5): the
 * capability `git.patch.apply` requires the scope `repo:write:path:src/**`,
 * and it is the scope the grant is compared against.
 */
const GRANT: EffectiveGrant = {
  allow: [
    'repo:read',
    'repo:write:path:src/**',
    'git.write.branch',
    'git.write.commit',
    'git.write.pr',
    'shell.sandboxed',
    'net.fetch',
    'net.egress:example.com',
  ],
  deny: ['git.forcePush', 'secret.read', 'prod.*'],
  repo: 'org/repo',
  writeGlobs: ['src/**'],
};

/**
 * The scope the ordinary capability requires (pack 04 §5: `git.patch.apply`
 * requires `repo:write:path:<glob>`).
 */
const REQUIRED_SCOPE = 'repo:write:path:src/index.ts';

/**
 * A minimal valid input. Tests override the fields they are about.
 */
const baseInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'repo.write',
  capabilityId: 'git.patch.apply',
  effectClass: 'E1',
  actor: { kind: 'agent', id: 'agent_1' },
  taskId: 'tsk_1',
  workflow: 'wf_bugfix',
  autonomy: 2,
  resource: { kind: 'repo', ref: 'org/repo', paths: ['src/index.ts'] },
  ...overrides,
});

/**
 * The context that makes the ordinary path allowed.
 */
const baseContext = (overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext => ({
  workflowGrant: GRANT,
  requiredAutonomy: 1,
  requiredScope: REQUIRED_SCOPE,
  ...overrides,
});

/**
 * The pack 03 §4.7 bundle, built in TypeScript.
 *
 * The shipped YAML is parsed separately in `tests/unit/policy-bundle.test.ts`
 * and compared against this, so the two cannot drift.
 */
const PACK_BUNDLE: PolicyBundle = {
  apiVersion: 'factory/v1',
  kind: 'PolicyBundle',
  spec: {
    denyRules: [
      { id: 'deny-factory-write', when: { capability: 'factory.write' } },
      {
        id: 'deny-protected-merge',
        when: { capability: 'git.push.protected', autonomyBelow: 3 },
      },
      { id: 'deny-secret-read-agent', when: { capability: 'secret.read', actorKind: 'agent' } },
      {
        id: 'deny-agent-protected-paths',
        when: { action: 'repo.write', actorKind: 'agent', pathsMatch: '@protectedPaths' },
      },
      {
        id: 'deny-egress-private',
        when: {
          action: 'net.egress',
          hostClass: ['private', 'loopback', 'linkLocal', 'metadata'],
        },
      },
    ],
    protectedPaths: [
      '.github/**',
      'CODEOWNERS',
      '.factory/**',
      'tests/acceptance/**',
      '**/migrations/**',
      'Dockerfile*',
      'docker-compose*.y*ml',
    ],
    effectRules: {
      E0: 'allow',
      E1: 'allow',
      E2: 'allowIfResourceScoped',
      E3: 'requireApproval',
      E4: 'requireApproval',
    },
    tierRules: {
      R3: { approveActions: 'requireApproval-security' },
      R4: { agentChange: 'deny' },
    },
    default: 'deny',
  },
};

/**
 * The ids of the rules that produced a decision.
 */
const ruleIds = (decision: Decision): string[] => decision.ruleIds;

/* -------------------------------------------------------------------------- */
/* A1.33 — an unknown action is denied                                          */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the policy engine', () => {
  it('A1.33 an action whose capability no grant covers is DENIED', () => {
    // blueprint 13 §2.3: "An action not enumerated in the workflow's
    // granted capability set → **Denied.** The task fails to a human."
    //
    // The action string is free-form; what makes an action *known* is the
    // capability it invokes and the grant that covers it. So the ordinary
    // action with a capability no grant covers is the unknown action.
    const decision = evaluate(
      PolicyInput.parse(baseInput({ action: 'something.nobody.allowed' })),
      PACK_BUNDLE,
      baseContext({
        requiredScope: 'repo:write:path:src/**',
        workflowGrant: { ...GRANT, allow: ['repo:read'] },
      }),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toContain('policy.engine/no-grant');
  });

  it('A1.33 an action with no effect class is DENIED with reason `default`', () => {
    // With no effect class, no effect rule applies, so the algorithm falls
    // through to its default branch — which denies.
    const input = baseInput();
    delete input.effectClass;

    const decision = evaluate(PolicyInput.parse(input), PACK_BUNDLE, baseContext());

    expect(decision.outcome).toBe('DENY');
    expect(decision.reason).toContain('denied by default');
    expect(ruleIds(decision)).toContain('policy.engine/default');
  });

  it('A1.33 an invalid input is DENIED with reason `invalid_input`', () => {
    // The input is cast past the schema: the engine validates, so the
    // validation has to be exercised with something the schema would
    // reject. `autonomy: 9` is not one of L0–L4.
    const decision = evaluate(
      { ...baseInput(), autonomy: 9 } as never,
      PACK_BUNDLE,
      baseContext(),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toEqual(['policy.engine/invalid-input']);
    expect(decision.reason).toContain('did not conform to the schema');
  });

  it('A1.33 a GENERATED unknown action is always denied', () => {
    // The claim is about *every* unknown action, not one. An action is
    // unknown when the capability it invokes is outside the grant — so the
    // generator produces an action *and* a scope no grant covers.
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (action, scope) => {
          const decision = evaluate(
            PolicyInput.parse(baseInput({ action })),
            PACK_BUNDLE,
            baseContext({
              requiredScope: scope,
              workflowGrant: { ...GRANT, allow: ['repo:read'] },
            }),
          );
          expect(decision.outcome).toBe('DENY');
          expect(decision.outcome).not.toBe('ALLOW');
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* A1.34 — deny dominates allow                                                */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · deny dominates', () => {
  it('A1.34 a matching deny rule overrides an otherwise-allowed action', () => {
    // `factory.write` is denied unconditionally, and nothing grants it —
    // so this alone would not prove dominance. The point is that the
    // grant *would* allow it.
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          action: 'repo.write',
          capabilityId: 'factory.write',
          effectClass: 'E1',
        }),
      ),
      PACK_BUNDLE,
      baseContext({
        workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'factory.write'] },
        requiredScope: 'factory.write',
      }),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toContain('deny-factory-write');
    expect(decision.reason).toContain('deny-factory-write');
  });

  it('A1.34 a deny rule lists EVERY matched rule id, not just the first', () => {
    // Two rules match: `deny-secret-read-agent` (capability + actor) and
    // `deny-agent-protected-paths` (action + actor + a protected path).
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          action: 'repo.write',
          capabilityId: 'secret.read',
          actor: { kind: 'agent', id: 'agent_1' },
          resource: { kind: 'repo', ref: 'org/repo', paths: ['CODEOWNERS'] },
        }),
      ),
      PACK_BUNDLE,
      baseContext({
        workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'secret.read'] },
        requiredScope: 'secret.read',
        paths: ['CODEOWNERS'],
      }),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toContain('deny-secret-read-agent');
    expect(ruleIds(decision)).toContain('deny-agent-protected-paths');
    expect(ruleIds(decision).length).toBeGreaterThanOrEqual(2);
  });

  it('A1.34 GENERATED: a deny rule beats an allow rule, for every pairing', () => {
    // The generated claim: for *any* capability that some deny rule names
    // and *any* grant that allows it, the decision is DENY.
    //
    // The deny rules are generated by choosing which of the pack's rules
    // fires, and the grant is generated by allowing everything the rule
    // names. If dominance ever failed, the outcome would be ALLOW.
    const denyRules = PACK_BUNDLE.spec.denyRules;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: denyRules.length - 1 }),
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 0, maxLength: 6 }),
        (ruleIndex, extraAllows) => {
          const rule = denyRules[ruleIndex] as (typeof denyRules)[number];
          const when = rule.when;

          // Build an input that the chosen rule matches.
          const overrides: Record<string, unknown> = {};
          if (typeof when.capability === 'string') {
            overrides.capabilityId = when.capability;
          }
          if (typeof when.action === 'string') {
            overrides.action = when.action;
          }
          if (typeof when.actorKind === 'string') {
            overrides.actor = { kind: when.actorKind, id: 'actor_1' };
          }
          if (typeof when.autonomyBelow === 'number') {
            overrides.autonomy = when.autonomyBelow - 1;
          }
          if (when.pathsMatch !== undefined) {
            const path = when.pathsMatch === '@protectedPaths' ? 'CODEOWNERS' : 'src/index.ts';
            overrides.resource = { kind: 'repo', ref: 'org/repo', paths: [path] };
          }
          if (when.hostClass !== undefined) {
            overrides.action = 'net.egress';
          }

          const input = PolicyInput.parse(baseInput(overrides));

          // The grant allows everything, so an allow path exists. The
          // required scope is the capability the rule names, so the grant
          // check would pass — the deny rule is what must stop it.
          const requiredScope =
            typeof when.capability === 'string' ? when.capability : 'repo:write:path:src/**';
          const allowAll: EffectiveGrant = {
            allow: [
              ...GRANT.allow,
              ...extraAllows,
              requiredScope,
            ],
            deny: [],
            repo: 'org/repo',
            writeGlobs: ['**'],
          };

          const decision = evaluate(
            input,
            PACK_BUNDLE,
            baseContext({
              workflowGrant: allowAll,
              requiredScope,
              paths: input.resource?.paths ?? [],
              ...(when.hostClass !== undefined ? { hostClass: 'private' } : {}),
            }),
          );

          expect(decision.outcome).toBe('DENY');
          expect(ruleIds(decision)).toContain(rule.id);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('A1.34 a deny rule is checked BEFORE the grant, so a missing grant does not mask it', () => {
    // Order matters: with no grant at all, the naive order would report
    // `no_grant`. The deny rule must be reported instead, because that is
    // the more specific and more actionable reason.
    const decision = evaluate(
      PolicyInput.parse(baseInput({ capabilityId: 'factory.write' })),
      PACK_BUNDLE,
      { requiredAutonomy: 1 },
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toEqual(['deny-factory-write']);
  });
});

/* -------------------------------------------------------------------------- */
/* A1.35 — an engine exception is a denial                                      */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the engine fails closed', () => {
  it('A1.35 a thrown error inside the engine becomes DENY(engine_error)', () => {
    // A bundle whose `denyRules` getter throws. The engine must catch it
    // and deny, not propagate it — a policy engine that throws is a policy
    // engine that can be crashed.
    const exploding = {
      apiVersion: 'factory/v1',
      kind: 'PolicyBundle',
      get spec(): never {
        throw new Error('boom');
      },
    } as unknown as PolicyBundle;

    const decision = evaluate(
      PolicyInput.parse(baseInput()),
      exploding,
      baseContext(),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toEqual(['policy.engine/error']);
    expect(decision.reason).toContain('the policy engine failed and denied');
  });

  it('A1.35 a non-Error thrown inside the engine is also DENY(engine_error)', () => {
    // A getter that throws a bare string. The engine must survive a throw
    // that is not an `Error` — a thrown value's type is not guaranteed by
    // JavaScript, and the engine's catch has to handle whatever arrives.
    //
    // The throw is behind a helper so the lint rule about throwing
    // non-Errors reads as what it is: a deliberate test fixture.
    const throwNonError = (): never => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a string, not an Error';
    };

    const exploding = {
      apiVersion: 'factory/v1',
      kind: 'PolicyBundle',
      get spec(): never {
        return throwNonError();
      },
    } as unknown as PolicyBundle;

    const decision = evaluate(
      PolicyInput.parse(baseInput()),
      exploding,
      baseContext(),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toEqual(['policy.engine/error']);
  });

  it('A1.35 GENERATED: the engine returns a decision for every input, and never throws', () => {
    // Totality: for any input at all — valid or not — the engine returns a
    // Decision. There is no input that escapes as an exception.
    fc.assert(
      fc.property(
        fc.anything(),
        (anything: unknown) => {
          const decision = evaluate(anything as never, PACK_BUNDLE, baseContext());
          expect(decision.outcome).toBeDefined();
          expect(['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'ESCALATE']).toContain(decision.outcome);
          expect(decision.reason.length).toBeGreaterThan(0);
          expect(decision.bundleSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* A1.36 — the autonomy check                                                  */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the autonomy ladder', () => {
  it('A1.36 an action requiring a higher level than the workflow has is DENY(autonomy)', () => {
    const decision = evaluate(
      PolicyInput.parse(baseInput({ autonomy: 1 })),
      PACK_BUNDLE,
      baseContext({ requiredAutonomy: 3 }),
    );

    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toEqual(['policy.engine/autonomy']);
    expect(decision.reason).toContain('requires autonomy L3');
  });

  it('A1.36 the autonomy check is exactly "required > workflow"', () => {
    // Equal is allowed; one above is denied. The boundary is the point.
    for (const [workflow, required] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [3, 2],
      [4, 1],
    ] as const) {
      const decision = evaluate(
        PolicyInput.parse(baseInput({ autonomy: workflow })),
        PACK_BUNDLE,
        baseContext({ requiredAutonomy: required }),
      );
      expect(
        decision.outcome === 'DENY' && ruleIds(decision).includes('policy.engine/autonomy'),
        `workflow L${workflow} / required L${required}`,
      ).toBe(required > workflow);
    }
  });

  it('A1.36 GENERATED: required > workflow is always DENY(autonomy)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (workflow, required) => {
          const decision = evaluate(
            PolicyInput.parse(baseInput({ autonomy: workflow })),
            PACK_BUNDLE,
            baseContext({ requiredAutonomy: required }),
          );
          if (required > workflow) {
            expect(decision.outcome).toBe('DENY');
            expect(ruleIds(decision)).toContain('policy.engine/autonomy');
          } else {
            expect(decision.outcome).not.toBe('DENY');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* A1.37 — the effect class                                                     */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · effect classes', () => {
  it('A1.37 E3 and E4 are REQUIRE_APPROVAL with a security scope', () => {
    for (const effectClass of ['E3', 'E4'] as const) {
      const decision = evaluate(
        PolicyInput.parse(baseInput({ effectClass })),
        PACK_BUNDLE,
        baseContext(),
      );

      expect(decision.outcome).toBe('REQUIRE_APPROVAL');
      expect(ruleIds(decision)).toContain('policy.engine/effect-class');
      expect(decision.requiredApproval?.scope).toBe('security');
      expect(decision.requiredApproval?.type).toBeDefined();
    }
  });

  it('A1.37 E2 is allowed only when the resource scope matches', () => {
    const scoped = evaluate(
      PolicyInput.parse(baseInput({ effectClass: 'E2' })),
      PACK_BUNDLE,
      baseContext(),
    );
    expect(scoped.outcome).not.toBe('DENY');

    const unscoped = evaluate(
      PolicyInput.parse(
        baseInput({
          effectClass: 'E2',
          resource: { kind: 'repo', ref: 'org/repo' },
        }),
      ),
      PACK_BUNDLE,
      baseContext(),
    );
    expect(unscoped.outcome).toBe('DENY');
    expect(ruleIds(unscoped)).toContain('policy.engine/effect-class');
  });

  it('A1.37 GENERATED: every effect class resolves by the pack\'s table', () => {
    const expected: Record<string, 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'> = {
      E0: 'ALLOW',
      E1: 'ALLOW',
      E2: 'ALLOW',
      E3: 'REQUIRE_APPROVAL',
      E4: 'REQUIRE_APPROVAL',
    };

    fc.assert(
      fc.property(fc.constantFrom('E0', 'E1', 'E2', 'E3', 'E4'), (effectClass) => {
        const decision = evaluate(
          PolicyInput.parse(baseInput({ effectClass })),
          PACK_BUNDLE,
          baseContext(),
        );
        expect(decision.outcome).toBe(expected[effectClass]);
      }),
      { numRuns: 20 },
    );
  });

});

/* -------------------------------------------------------------------------- */
/* A1.38 — determinism                                                         */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the engine is deterministic', () => {
  it('A1.38 identical input and bundle produce an identical decision', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('E0', 'E1', 'E2', 'E3', 'E4'),
        fc.integer({ min: 0, max: 4 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (action, effectClass, autonomy, capabilityId) => {
          const input = PolicyInput.parse(
            baseInput({ action, effectClass, autonomy, capabilityId }),
          );
          const first = evaluate(input, PACK_BUNDLE, baseContext());
          const second = evaluate(input, PACK_BUNDLE, baseContext());
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('A1.38 the decision carries the bundle digest', () => {
    const decision = evaluate(
      PolicyInput.parse(baseInput()),
      PACK_BUNDLE,
      baseContext(),
    );
    expect(decision.bundleSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('A1.38 two different bundles produce different digests', () => {
    const other = loadPolicyBundle({
      ...PACK_BUNDLE,
      spec: { ...PACK_BUNDLE.spec, denyRules: [] },
    });

    const first = evaluate(PolicyInput.parse(baseInput()), PACK_BUNDLE, baseContext());
    const second = evaluate(PolicyInput.parse(baseInput()), other.bundle, baseContext());

    expect(first.bundleSha256).not.toBe(second.bundleSha256);
  });
});

/* -------------------------------------------------------------------------- */
/* A1.39 — the package has no I/O imports                                       */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the package is pure', () => {
  it('A1.39 no module in packages/policy imports an I/O module', async () => {
    const { readdir } = await import('node:fs/promises');
    const dir = resolve(repoRoot, 'packages', 'policy', 'src');
    const files = (await readdir(dir)).filter((name) => name.endsWith('.ts'));

    expect(files.length).toBeGreaterThan(0);

    const forbidden = [
      'node:fs',
      'node:net',
      'node:child_process',
      'node:http',
      'node:https',
      'node:dgram',
      'node:tls',
      'node:dns',
      'node:zlib',
      'node:worker_threads',
      'node:os',
      'node:path',
      'pg',
      'kysely',
      'axios',
      'undici',
    ];

    for (const file of files) {
      const source = await readFile(resolve(dir, file), 'utf8');
      for (const module of forbidden) {
        expect(
          source.includes(`'${module}'`) || source.includes(`"${module}"`),
          `${file} must not import ${module}`,
        ).toBe(false);
      }
      // And no dynamic import of one either.
      expect(source.includes('await import('), `${file} must not use a dynamic import`).toBe(false);
    }
  });

  it('A1.39 the engine class satisfies the PolicyEngine contract', () => {
    const engine = new DefaultPolicyEngine(baseContext());
    const decision = engine.evaluate(PolicyInput.parse(baseInput()), PACK_BUNDLE);
    expect(decision.outcome).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* A1.40 — the AT-14 equivalent-effect check                                   */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · AT-14, the equivalent-effect check', () => {
  it('A1.40 the same effect on the same resource via a different capability ESCALATES', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          capabilityId: 'git.patch.apply',
          effectClass: 'E2',
          resource: { kind: 'repo', ref: 'org/repo', paths: ['src/index.ts'] },
          priorDenials: [
            {
              effectClass: 'E2',
              resourceKey: 'repo:org/repo:src/index.ts',
              capabilityId: 'shell.sandboxed',
            },
          ],
        }),
      ),
      PACK_BUNDLE,
      baseContext(),
    );

    expect(decision.outcome).toBe('ESCALATE');
    expect(ruleIds(decision)).toContain('policy.engine/equivalent-effect');
    expect(decision.reason).toContain('not executed');
  });

  it('A1.40 the same capability retrying is NOT an escalation', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          capabilityId: 'git.patch.apply',
          effectClass: 'E2',
          resource: { kind: 'repo', ref: 'org/repo', paths: ['src/index.ts'] },
          priorDenials: [
            {
              effectClass: 'E2',
              resourceKey: 'repo:org/repo:src/index.ts',
              capabilityId: 'git.patch.apply',
            },
          ],
        }),
      ),
      PACK_BUNDLE,
      baseContext(),
    );

    expect(decision.outcome).not.toBe('ESCALATE');
  });

  it('A1.40 a different resource is not an equivalent effect', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          capabilityId: 'git.patch.apply',
          effectClass: 'E2',
          resource: { kind: 'repo', ref: 'org/repo', paths: ['src/other.ts'] },
          priorDenials: [
            {
              effectClass: 'E2',
              resourceKey: 'repo:org/repo:src/index.ts',
              capabilityId: 'shell.sandboxed',
            },
          ],
        }),
      ),
      PACK_BUNDLE,
      baseContext(),
    );

    expect(decision.outcome).not.toBe('ESCALATE');
  });

  it('A1.40 a different effect class is not an equivalent effect', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          capabilityId: 'git.patch.apply',
          effectClass: 'E1',
          resource: { kind: 'repo', ref: 'org/repo', paths: ['src/index.ts'] },
          priorDenials: [
            {
              effectClass: 'E2',
              resourceKey: 'repo:org/repo:src/index.ts',
              capabilityId: 'shell.sandboxed',
            },
          ],
        }),
      ),
      PACK_BUNDLE,
      baseContext(),
    );

    expect(decision.outcome).not.toBe('ESCALATE');
  });
});

/* -------------------------------------------------------------------------- */
/* A1.41 — the pack's own deny rules                                           */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the pack 03 §4.7 deny rules', () => {
  it('A1.41 deny-factory-write refuses any factory.write', () => {
    const decision = evaluate(
      PolicyInput.parse(baseInput({ capabilityId: 'factory.write' })),
      PACK_BUNDLE,
      baseContext({ requiredScope: 'factory.write' }),
    );
    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toContain('deny-factory-write');
  });

  it('A1.41 deny-protected-merge refuses a protected push below L3', () => {
    const below = evaluate(
      PolicyInput.parse(
        baseInput({ capabilityId: 'git.push.protected', autonomy: 2, effectClass: 'E1' }),
      ),
      PACK_BUNDLE,
      baseContext({
        requiredScope: 'git.push.protected',
        workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'git.push.protected'] },
      }),
    );
    expect(below.outcome).toBe('DENY');
    expect(ruleIds(below)).toContain('deny-protected-merge');

    // At L3 the rule does not fire — the rule is about the level.
    const at3 = evaluate(
      PolicyInput.parse(
        baseInput({ capabilityId: 'git.push.protected', autonomy: 3, effectClass: 'E1' }),
      ),
      PACK_BUNDLE,
      baseContext({
        requiredScope: 'git.push.protected',
        workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'git.push.protected'] },
      }),
    );
    expect(ruleIds(at3)).not.toContain('deny-protected-merge');
  });

  it('A1.41 deny-secret-read-agent refuses an agent reading a secret', () => {
    const agent = evaluate(
      PolicyInput.parse(
        baseInput({ capabilityId: 'secret.read', actor: { kind: 'agent', id: 'a' } }),
      ),
      PACK_BUNDLE,
      baseContext({ requiredScope: 'secret.read' }),
    );
    expect(agent.outcome).toBe('DENY');
    expect(ruleIds(agent)).toContain('deny-secret-read-agent');

    // A human is not covered by this rule — but `secret.read` is still
    // denied by the grant's own deny list.
    const human = evaluate(
      PolicyInput.parse(
        baseInput({ capabilityId: 'secret.read', actor: { kind: 'human', id: 'h' } }),
      ),
      PACK_BUNDLE,
      baseContext({
        requiredScope: 'secret.read',
        workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'secret.read'] },
      }),
    );
    expect(ruleIds(human)).not.toContain('deny-secret-read-agent');
    expect(human.outcome).toBe('DENY');
    expect(ruleIds(human)).toContain('policy.engine/no-grant');
  });

  it('A1.41 deny-agent-protected-paths refuses an agent writing a protected path', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          action: 'repo.write',
          resource: { kind: 'repo', ref: 'org/repo', paths: ['.github/workflows/ci.yml'] },
        }),
      ),
      PACK_BUNDLE,
      baseContext({ paths: ['.github/workflows/ci.yml'] }),
    );
    expect(decision.outcome).toBe('DENY');
    expect(ruleIds(decision)).toContain('deny-agent-protected-paths');
  });

  it('A1.41 a human writing a protected path is not caught by the agent rule', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          action: 'repo.write',
          actor: { kind: 'human', id: 'h' },
          resource: { kind: 'repo', ref: 'org/repo', paths: ['.github/workflows/ci.yml'] },
        }),
      ),
      PACK_BUNDLE,
      baseContext({ paths: ['.github/workflows/ci.yml'] }),
    );
    expect(ruleIds(decision)).not.toContain('deny-agent-protected-paths');
  });

  it('A1.41 deny-egress-private refuses egress to a private host', () => {
    for (const hostClass of ['private', 'loopback', 'linkLocal', 'metadata']) {
      const decision = evaluate(
        PolicyInput.parse(
          baseInput({
            action: 'net.egress',
            capabilityId: 'net.egress',
            effectClass: 'E2',
            resource: { kind: 'host', ref: 'internal.svc', host: 'internal.svc' },
          }),
        ),
        PACK_BUNDLE,
        baseContext({
          hostClass,
          requiredScope: 'net.egress:internal.svc',
          workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'net.egress:internal.svc'] },
        }),
      );
      expect(decision.outcome, hostClass).toBe('DENY');
      expect(ruleIds(decision)).toContain('deny-egress-private');
    }
  });

  it('A1.41 egress to a public host is not caught by the private-egress rule', () => {
    const decision = evaluate(
      PolicyInput.parse(
        baseInput({
          action: 'net.egress',
          capabilityId: 'net.egress',
          effectClass: 'E2',
          resource: { kind: 'host', ref: 'example.com', host: 'example.com' },
        }),
      ),
      PACK_BUNDLE,
      baseContext({
        hostClass: 'public',
        requiredScope: 'net.egress:example.com',
        workflowGrant: { ...GRANT, allow: [...GRANT.allow, 'net.egress:example.com'] },
      }),
    );
    expect(ruleIds(decision)).not.toContain('deny-egress-private');
  });
});

/* -------------------------------------------------------------------------- */
/* A1.42 — the glob matcher                                                    */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the protected-path matcher', () => {
  it('A1.42 matches the pack\'s protected paths', () => {
    const protectedPaths = PACK_BUNDLE.spec.protectedPaths;

    const shouldMatch = [
      '.github/workflows/ci.yml',
      '.github/CODEOWNERS',
      'CODEOWNERS',
      '.factory/policy-bundle.yaml',
      'tests/acceptance/health/health.test.ts',
      'db/migrations/0001_core.sql',
      'packages/db/migrations/0001_core.sql',
      'Dockerfile',
      'Dockerfile.dev',
      'docker-compose.yml',
      'docker-compose.yaml',
      'docker-compose.prod.yml',
    ];

    for (const path of shouldMatch) {
      expect(
        protectedPaths.some((pattern) => matchesGlob(pattern, path)),
        `${path} should be protected`,
      ).toBe(true);
    }

    const shouldNotMatch = [
      'src/index.ts',
      'packages/core/src/hash.ts',
      'docs/readme.md',
      'tests/unit/policy-engine.test.ts',
      'src/Dockerfile.ts',
    ];

    for (const path of shouldNotMatch) {
      expect(
        protectedPaths.some((pattern) => matchesGlob(pattern, path)),
        `${path} should not be protected`,
      ).toBe(false);
    }
  });

  it('A1.42 a path is normalised before matching', () => {
    expect(matchesGlob('src/**', './src/index.ts')).toBe(true);
    expect(matchesGlob('src/**', 'src\\index.ts')).toBe(true);
  });

  it('A1.42 `*` does not cross a path segment but `**` does', () => {
    expect(matchesGlob('src/*', 'src/index.ts')).toBe(true);
    expect(matchesGlob('src/*', 'src/a/index.ts')).toBe(false);
    expect(matchesGlob('src/**', 'src/a/index.ts')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* A1.43 — the tier rule                                                       */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the tier rule', () => {
  it('A1.43 tier R3 on an approve action requires a security-scoped approval', () => {
    const decision = evaluate(
      PolicyInput.parse(baseInput({ action: 'approve', tier: 'R3' })),
      PACK_BUNDLE,
      baseContext(),
    );

    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    expect(ruleIds(decision)).toContain('policy.engine/tier-rule');
    expect(decision.requiredApproval?.scope).toBe('security');
  });

  it('A1.43 tier R3 on a non-approve action does not fire the tier rule', () => {
    const decision = evaluate(
      PolicyInput.parse(baseInput({ action: 'repo.write', tier: 'R3' })),
      PACK_BUNDLE,
      baseContext(),
    );
    expect(ruleIds(decision)).not.toContain('policy.engine/tier-rule');
  });

  it('A1.43 tier R4 forbids an agent-initiated change', () => {
    const agent = evaluate(
      PolicyInput.parse(baseInput({ action: 'repo.write', tier: 'R4' })),
      PACK_BUNDLE,
      baseContext(),
    );
    expect(agent.outcome).toBe('DENY');
    expect(ruleIds(agent)).toContain('policy.engine/tier-rule');

    const human = evaluate(
      PolicyInput.parse(
        baseInput({ action: 'repo.write', tier: 'R4', actor: { kind: 'human', id: 'h' } }),
      ),
      PACK_BUNDLE,
      baseContext(),
    );
    expect(ruleIds(human)).not.toContain('policy.engine/tier-rule');
  });
});

/* -------------------------------------------------------------------------- */
/* The shipped bundle                                                          */
/* -------------------------------------------------------------------------- */

describe('T-1.05 · the shipped bundle', () => {
  it('A1.44 definition/policy-bundle.yaml parses and validates', async () => {
    const { default: yaml } = await import('js-yaml');
    const raw = await readFile(
      resolve(repoRoot, 'definition', 'policy-bundle.yaml'),
      'utf8',
    );
    const loaded = loadPolicyBundle(yaml.load(raw));

    expect(loaded.bundle.spec.default).toBe('deny');
    expect(loaded.bundle.spec.denyRules).toHaveLength(5);
    expect(loaded.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('A1.44 the shipped bundle is the same as the one the tests use', async () => {
    const { default: yaml } = await import('js-yaml');
    const raw = await readFile(
      resolve(repoRoot, 'definition', 'policy-bundle.yaml'),
      'utf8',
    );
    const loaded = loadPolicyBundle(yaml.load(raw));

    expect(loaded.bundle).toEqual(PACK_BUNDLE);
  });
});
