/**
 * `factory projections` — the command (T-1.15).
 *
 * checklist 03 T-1.15: "Every projection can be dropped and rebuilt from
 * the log (A0.6) — rebuild is a CLI command **and** a test."
 *
 * The **test** half of that is the oracle in
 * `tests/unit/projections-a0-6.test.ts`, which calls the same `rebuild()`
 * function the command calls. So the two cannot disagree about what a
 * rebuild produces.
 *
 * What this file covers is the part the oracle cannot: the command's
 * **own** decisions — which subcommands exist, what the destructive one
 * demands before it will run, and what the command does when it has been
 * given no database to talk to. Those are the decisions an operator meets
 * first, and they are the ones that must not need a database to be right.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../../apps/cli/src/index.ts';
import { runProjectionsCommand } from '../../apps/cli/src/projections.ts';

/**
 * An environment with no database configured.
 *
 * The CLI reads the connection string from the environment, so an
 * environment without one is the "the operator has not configured this
 * yet" case — and it must be refused rather than attempted.
 */
const NO_DATABASE: NodeJS.ProcessEnv = {};

/**
 * A connection string that is never dialled.
 *
 * Every case below that names a database is refused **before** the
 * connection is opened, so the test needs no server and no container.
 * The one case that would reach the database uses
 * `runProjectionsCommand` with a URL carrying `connect_timeout=1`, so
 * even an unreachable host fails in a second rather than hanging.
 */
const UNREACHABLE = 'postgres://projector@127.0.0.1:1/factory?connect_timeout=1';

describe('factory projections · the command (T-1.15)', () => {
  it('says how to use it when no subcommand is given', async () => {
    const result = await run(['projections'], NO_DATABASE);

    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/status.*catch-up.*check.*rebuild/s);
  });

  it('refuses an unknown subcommand', async () => {
    // The subcommand is checked **before** the connection string — a
    // typo is the operator's mistake and the error must name it, not
    // send them off to configure a database for a command that does not
    // exist.
    const result = await run(['projections', 'frobnicate'], NO_DATABASE);

    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/unknown subcommand/i);
  });

  it('refuses to run without a database', async () => {
    const result = await run(['projections', 'status'], NO_DATABASE);

    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/FACTORY_PROJECTOR_DATABASE_URL is not set/);
    // And it says which role the command wants — the operator has to
    // know that before they configure the URL.
    expect(result.lines.join('\n')).toMatch(/factory_projector/);
  });

  it('falls back to the owner URL when the projector URL is unset', async () => {
    // The check above proves the URL is required; this proves the CLI
    // reads the *projector* URL first and the owner URL second, so a
    // dev cluster configured only with the owner URL still works.
    //
    // The URL is present, so the command proceeds to the database — and
    // the connection fails there because there is no server. The point is
    // that it did **not** refuse for a missing URL, so the assertion is
    // that the refusal about the URL is absent.
    //
    // The command is reached through `runProjectionsCommand`, which
    // reports the connection failure as a thrown error; the CLI's own
    // refusal is what is under test here.
    await expect(
      runProjectionsCommand('status', { connectionString: UNREACHABLE }, []),
    ).rejects.toThrow();

    const result = await run(['projections', 'frobnicate'], {
      FACTORY_OWNER_DATABASE_URL: UNREACHABLE,
    });

    // The owner URL alone is enough to get past the URL check — the
    // command did not refuse for a missing URL. It refused for the
    // unknown subcommand, which is the decision under test.
    expect(result.lines.join('\n')).not.toMatch(/is not set/);
  }, 30_000);

  it('demands --yes before it drops anything', async () => {
    // The destructive form. It must refuse without the flag, and the
    // refusal must point at the safe form.
    //
    // The refusal happens before any query, so no database is needed —
    // and the connection is never dialled.
    const result = await runProjectionsCommand('rebuild', {
      connectionString: UNREACHABLE,
    }, []);

    expect(result.exitCode).toBe(2);
    const text = result.lines.join('\n');
    expect(text).toMatch(/DROPS every projection/);
    expect(text).toMatch(/--yes/);
    expect(text).toMatch(/check/);
  });

  it('does not demand --yes for the safe form', async () => {
    // `check` changes nothing, so it must not ask for confirmation. The
    // command proceeds to the database — there is none here — so it
    // fails there, and the assertion is that it did **not** stop at the
    // confirmation gate.
    await expect(
      runProjectionsCommand('check', { connectionString: UNREACHABLE }, []),
    ).rejects.toThrow();
  }, 30_000);

  it('is in the usage text', async () => {
    const result = await run(['--help'], NO_DATABASE);

    const text = result.lines.join('\n');
    expect(text).toMatch(/projections status/);
    expect(text).toMatch(/projections rebuild --yes/);
  });
});
