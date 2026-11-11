/**
 * `factory` — the command dispatcher (T-1.16).
 *
 * ## What this file covers
 *
 * The dispatcher's own decisions — which commands exist, what each
 * group's usage is, and what an unknown command says. The commands'
 * own behaviour is in `cli-login.test.ts`, `cli-tasks.test.ts`,
 * `cli-kill-switch.test.ts` and `cli-audit-chain.test.ts`.
 *
 * ## The catalogue is the pack's
 *
 * pack `04` §9 names the CLI's commands. This file asserts that the
 * dispatcher knows each of them, so a command cannot quietly disappear
 * from the surface — the usage text and the dispatcher would then
 * disagree, and the operator would be the one to find out.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../../apps/cli/src/index.ts';

/**
 * An environment with no database and no API configured.
 */
const NOTHING: NodeJS.ProcessEnv = {};

describe('the factory command dispatcher', () => {
  it('prints the usage when no command is given', async () => {
    const result = await run([], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/usage: factory/);
  });

  it('prints the usage for --help and exits 0', async () => {
    for (const flag of ['--help', '-h', 'help']) {
      const result = await run([flag], NOTHING);
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toMatch(/usage: factory/);
    }
  });

  it('names an unknown command', async () => {
    const result = await run(['frobnicate'], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/unknown command `factory frobnicate`/);
  });

  it('shows the usage after an unknown command', async () => {
    // The operator needs to see what the CLI *does* do, not only that
    // their command is wrong.
    const result = await run(['frobnicate'], NOTHING);
    expect(result.lines.join('\n')).toMatch(/usage: factory/);
  });

  it('knows every command in the pack\'s catalogue', async () => {
    // pack `04` §9: login, whoami, tasks, kill-switch, projections
    // rebuild — and the ops groups this repo already had.
    const usage = (await run(['--help'], NOTHING)).lines.join('\n');
    for (const command of [
      'db migrate',
      'events list',
      'projections rebuild',
      'definition validate',
      'login --token',
      'whoami',
      'tasks ls',
      'kill-switch on|off',
    ]) {
      expect(usage).toContain(command);
    }
  });

  it('says how to use the tasks group', async () => {
    const result = await run(['tasks'], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/usage: factory tasks ls \| show/);
  });

  it('says how to use the audit group', async () => {
    const result = await run(['audit'], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/usage: factory audit chain/);
  });

  it('refuses an unknown audit subcommand', async () => {
    const result = await run(['audit', 'frobnicate'], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/unknown subcommand/);
  });

  it('refuses the audit chain command without a database', async () => {
    // The command verifies the event log, so it needs one — and it
    // says which role it wants, so the operator knows what to
    // configure.
    const result = await run(['audit', 'chain', 'task-1'], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/FACTORY_PROJECTOR_DATABASE_URL is not set/);
    expect(result.lines.join('\n')).toMatch(/factory_projector/);
  });

  it('refuses an unknown tasks subcommand', async () => {
    const result = await run(['tasks', 'frobnicate'], NOTHING);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/unknown subcommand/);
  });

  it('names the environment variables the commands read', async () => {
    const usage = (await run(['--help'], NOTHING)).lines.join('\n');
    expect(usage).toContain('FACTORY_API_URL');
    expect(usage).toContain('XDG_CONFIG_HOME');
  });
});
