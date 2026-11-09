/**
 * T-1.05 — the definition loader.
 *
 * The policy bundle is a **definition document**: it is read from disk,
 * parsed as YAML, and validated against the `PolicyBundle` contract before
 * the engine ever sees it.
 *
 * Two things are proved here:
 *
 * 1. the shipped `definition/policy-bundle.yaml` is **pack 03 §4.7
 *    verbatim** — every deny rule, every protected path, every effect rule
 *    and every tier rule is the pack's, in the pack's order; and
 * 2. the loader **rejects** a bundle that is not valid, and rejects one
 *    whose `default` is not `deny` — because a bundle that allowed by
 *    default would silently invert the factory's security posture.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFINITION_ROOT,
  parsePolicyBundle,
  readPolicyBundle,
} from '../../packages/definition/src/index.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const bundlePath = resolve(repoRoot, 'definition', 'policy-bundle.yaml');

describe('T-1.05 · the definition loader', () => {
  it('A1.45 the shipped bundle parses and validates', async () => {
    const loaded = await readPolicyBundle();

    expect(loaded.bundle.apiVersion).toBe('factory/v1');
    expect(loaded.bundle.kind).toBe('PolicyBundle');
    expect(loaded.bundle.spec.default).toBe('deny');
    expect(loaded.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('A1.45 the shipped bundle is pack 03 §4.7 verbatim', async () => {
    const loaded = await readPolicyBundle();
    const spec = loaded.bundle.spec;

    // The five deny rules, with the pack's ids and conditions.
    expect(spec.denyRules.map((rule) => rule.id)).toEqual([
      'deny-factory-write',
      'deny-protected-merge',
      'deny-secret-read-agent',
      'deny-agent-protected-paths',
      'deny-egress-private',
    ]);

    expect(spec.denyRules[0]?.when).toEqual({ capability: 'factory.write' });
    expect(spec.denyRules[1]?.when).toEqual({
      capability: 'git.push.protected',
      autonomyBelow: 3,
    });
    expect(spec.denyRules[2]?.when).toEqual({
      capability: 'secret.read',
      actorKind: 'agent',
    });
    expect(spec.denyRules[3]?.when).toEqual({
      action: 'repo.write',
      actorKind: 'agent',
      pathsMatch: '@protectedPaths',
    });
    expect(spec.denyRules[4]?.when).toEqual({
      action: 'net.egress',
      hostClass: ['private', 'loopback', 'linkLocal', 'metadata'],
    });

    // The protected paths, in the pack's order.
    expect(spec.protectedPaths).toEqual([
      '.github/**',
      'CODEOWNERS',
      '.factory/**',
      'tests/acceptance/**',
      '**/migrations/**',
      'Dockerfile*',
      'docker-compose*.y*ml',
    ]);

    // The effect rules and the tier rules.
    expect(spec.effectRules).toEqual({
      E0: 'allow',
      E1: 'allow',
      E2: 'allowIfResourceScoped',
      E3: 'requireApproval',
      E4: 'requireApproval',
    });
    expect(spec.tierRules).toEqual({
      R3: { approveActions: 'requireApproval-security' },
      R4: { agentChange: 'deny' },
    });
  });

  it('A1.45 a bundle whose default is not `deny` is rejected', () => {
    const source = `
apiVersion: factory/v1
kind: PolicyBundle
spec:
  default: allow
`;
    expect(() => parsePolicyBundle(source)).toThrow();
  });

  it('A1.45 a bundle with an unknown field is rejected', () => {
    // `.strict()` on the schema means a typo in the definition is a
    // deployment error, not a silently-ignored key.
    const source = `
apiVersion: factory/v1
kind: PolicyBundle
spec:
  default: deny
  allowByDefault: true
`;
    expect(() => parsePolicyBundle(source)).toThrow();
  });

  it('A1.45 a bundle with an unknown deny-condition field is rejected', () => {
    const source = `
apiVersion: factory/v1
kind: PolicyBundle
spec:
  default: deny
  denyRules:
    - { id: deny-x, when: { capabilty: factory.write } }
`;
    expect(() => parsePolicyBundle(source)).toThrow();
  });

  it('A1.45 the digest tracks the rules, not the file\'s formatting', async () => {
    // Two YAML files that describe the same policy differ only in
    // whitespace. The digest is over the canonical JSON of the *rules*, so
    // the two agree — a reviewer reformatting the file does not invalidate
    // every decision that was made under the old digest.
    const raw = await readFile(bundlePath, 'utf8');
    const reformatted = raw.replace(/\n\s+/g, '\n  ');

    const first = parsePolicyBundle(raw);
    const second = parsePolicyBundle(reformatted);

    expect(second.sha256).toBe(first.sha256);
  });

  it('A1.45 a bundle with one different rule has a different digest', async () => {
    const raw = await readFile(bundlePath, 'utf8');
    const changed = raw.replace(
      'deny-factory-write',
      'deny-factory-write-renamed',
    );

    const first = parsePolicyBundle(raw);
    const second = parsePolicyBundle(changed);

    expect(second.sha256).not.toBe(first.sha256);
  });

  it('A1.45 the definition root points at the repository\'s definition directory', () => {
    expect(DEFINITION_ROOT.endsWith('definition')).toBe(true);
  });
});
