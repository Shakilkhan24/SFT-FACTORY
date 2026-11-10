/**
 * T-1.06 — the `factory definition` command line.
 *
 * pack 04 §9: "`factory definition validate|plan|apply --sha …`" (AP-6).
 *
 * These checks exercise the CLI **through its public entry point** — the
 * `run(argv, environment)` function — and assert the two things a script
 * depends on: the **lines** it prints and the **exit code** it returns.
 *
 * The exit codes carry meaning (pack 04 §9's convention, and the CLI's own
 * documentation): `0` success, `1` the factory said no, `2` you asked wrong.
 * A script branches on them, so they are part of the contract and are
 * asserted here.
 *
 * ## The exit-code distinction is the point
 *
 * `1` and `2` must not be the same code. If a caller cannot tell "the
 * definition is invalid" from "I passed the wrong flag", the CLI is
 * unusable in a pipeline. So each refusal here is checked for the *right*
 * code, not merely a non-zero one.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { run } from '../../../apps/cli/src/index.js';

/**
 * A minimal but *valid* definition tree.
 *
 * Written out rather than imported, so the checks do not depend on the
 * repository's own definition being in any particular state.
 */
const writeDefinition = async (root: string): Promise<void> => {
  await mkdir(join(root, 'workflows'), { recursive: true });

  await writeFile(
    join(root, 'factory.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: FactoryDefinition',
      'metadata: { name: factory }',
      'spec:',
      '  owner: { githubLogin: owner }',
      '  global: { maxConcurrentTasks: 2 }',
      '  defaults: { autonomyLevel: 1 }',
      '  repos: []',
      '  workflows: [alpha]',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(root, 'policy-bundle.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: PolicyBundle',
      'spec:',
      '  denyRules: []',
      '  protectedPaths: [".github/**"]',
      '  effectRules: { E0: allow, E1: allow, E2: allowIfResourceScoped, E3: requireApproval, E4: requireApproval }',
      '  tierRules: { R3: { approveActions: requireApproval-security } }',
      '  default: deny',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(root, 'workflows', 'alpha.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: WorkflowDefinition',
      'metadata: { name: alpha }',
      'spec:',
      '  autonomy: { level: 1, ceiling: 2 }',
      '  trigger: { kind: manual }',
      '  stages:',
      '    - { id: triage, kind: specify, role: triage, executor: deterministic }',
      '  completion: []',
      '',
    ].join('\n'),
    'utf8',
  );
};

/**
 * A definition tree with one document that does not validate.
 */
const writeInvalidDefinition = async (root: string): Promise<void> => {
  await writeDefinition(root);
  await writeFile(
    join(root, 'workflows', 'broken.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: WorkflowDefinition',
      'metadata: { name: broken }',
      'spec:',
      '  autonomy: { level: 1 }',
      '',
    ].join('\n'),
    'utf8',
  );
};

/**
 * The lines, joined, for a readable assertion.
 */
const text = (lines: readonly string[]): string => lines.join('\n');

describe('T-1.06 — factory definition validate', () => {
  it('T_1_06 validates a good definition and exits 0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    await writeDefinition(root);
    try {
      const result = await run(['definition', 'validate'], {
        FACTORY_DEFINITION_DIR: root,
      });

      expect(result.exitCode).toBe(0);
      expect(text(result.lines)).toContain('the definition is valid');
      expect(text(result.lines)).toContain('bundleSha256: sha256:');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 exits 1 and names the bad document when the definition is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    await writeInvalidDefinition(root);
    try {
      const result = await run(['definition', 'validate'], {
        FACTORY_DEFINITION_DIR: root,
      });

      expect(result.exitCode).toBe(1);
      expect(text(result.lines)).toContain('the definition is invalid');
      expect(text(result.lines)).toContain('broken.yaml');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — factory definition plan', () => {
  it('T_1_06 plans against nothing on a first apply and names the digest to approve', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    await writeDefinition(root);
    try {
      const result = await run(['definition', 'plan'], {
        FACTORY_DEFINITION_DIR: root,
      });

      expect(result.exitCode).toBe(0);
      expect(text(result.lines)).toContain('WorkflowDefinition/alpha');
      // The plan must name the digest an approval has to bind to, or the
      // operator cannot obtain one.
      expect(text(result.lines)).toContain('obtain a "definition" approval bound to sha256:');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — factory definition apply', () => {
  it('T_1_06 exits 2 when no SHA is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    await writeDefinition(root);
    try {
      const result = await run(['definition', 'apply'], {
        FACTORY_DEFINITION_DIR: root,
      });

      expect(result.exitCode).toBe(2);
      expect(text(result.lines)).toContain('requires --sha');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 refuses the apply and says the previous version is still active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-cli-'));
    await writeDefinition(root);
    try {
      const result = await run(['definition', 'apply', '--sha', 'abc123'], {
        FACTORY_DEFINITION_DIR: root,
      });

      // 1, not 2: the factory said no, rather than the caller asking wrong.
      expect(result.exitCode).toBe(1);
      expect(text(result.lines)).toContain('the apply was refused');
      expect(text(result.lines)).toContain('the previously applied version is still active');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — the definition command line rejects bad usage', () => {
  it('T_1_06 exits 2 for an unknown subcommand', async () => {
    const result = await run(['definition', 'frobnicate'], {});

    expect(result.exitCode).toBe(2);
    expect(text(result.lines)).toContain('unknown subcommand');
  });

  it('T_1_06 exits 2 when the definition group is named with no subcommand', async () => {
    const result = await run(['definition'], {});

    expect(result.exitCode).toBe(2);
    expect(text(result.lines)).toContain('usage: factory definition validate | plan | apply');
  });
});
