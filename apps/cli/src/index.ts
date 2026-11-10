/**
 * `cli` — the factory's command line (pack 04 §"Command catalogue").
 *
 * This ticket delivers the `factory db` command group (checklist 02, T-1.02).
 * The rest of the catalogue arrives with the tickets that own the commands;
 * each is added here as a new subcommand, and the table stays the single
 * place that says what exists.
 *
 * The CLI never imports another app (pack 02 §3) — it wires packages together.
 */

import { runDbCommand } from './db.js';
import { defaultMigrationsDir } from './db.js';
import { runDefinitionCommand } from './definition.js';
import {
  buildDefinitionStore,
  parseArgs,
  refusingScmCheck,
  resolveApproval,
} from './definition-wiring.js';
import { runEventsCommand } from './events.js';
import { resolveDefinitionDirectory } from './paths.js';

const USAGE = `usage: factory <command> [options]

commands:
  db migrate             apply every pending migration
  db status              show which migrations are applied
  db partitions [--ensure [months]]
                         list the event-log partitions; --ensure creates the
                         monthly partitions ahead of time

  events list [count] [aggregateId]
                         show the most recent events
  events show <aggregateId>
                         show one aggregate's chain and its chain verdict
  events health          report seq gaps and aggregate-version gaps

  definition validate    check every definition document against its contract
  definition plan        show the structured diff against the applied version
  definition apply --sha <sha> [--approval <id>]
                         apply a definition SHA (needs a bound approval)

environment:
  FACTORY_OWNER_DATABASE_URL   connection string for the factory_owner role
  FACTORY_PROJECTOR_DATABASE_URL
                               connection string for the factory_projector role
  FACTORY_APPLIER_DATABASE_URL
                               connection string for the factory_applier role
  FACTORY_MIGRATIONS_DIR       override the migrations directory
  FACTORY_DEFINITION_DIR       override the definition directory
`;

export interface CliResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * The connection string the CLI uses for owner-role work.
 *
 * Only the owner role is read here. The runtime roles have their own
 * environment variables (`FACTORY_APP_DATABASE_URL` and friends) and are used
 * by the components that need them — not by the CLI's migration path.
 */
const ownerConnectionString = (
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => environment['FACTORY_OWNER_DATABASE_URL'];

/**
 * How the owner role is assumed.
 *
 * `FACTORY_DB_ROLE_MODE=assume` makes the CLI log in with the given
 * connection string and then `SET ROLE factory_owner`. The dev cluster uses
 * this: its `factory_owner` is a NOLOGIN group role, and the migration tables
 * must be owned by it. Production connects as the role directly and does not
 * set the variable.
 */
const ownerRoleMode = (
  environment: NodeJS.ProcessEnv = process.env,
): 'direct' | 'assume' =>
  environment['FACTORY_DB_ROLE_MODE'] === 'assume' ? 'assume' : 'direct';

/**
 * Run the CLI with an argument vector (without `node` and the script path).
 */
export const run = async (
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CliResult> => {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return { lines: USAGE.trimEnd().split('\n'), exitCode: command === undefined ? 2 : 0 };
  }

  if (command === 'db') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory db migrate | status | partitions'],
        exitCode: 2,
      };
    }
    const connectionString = ownerConnectionString(environment);
    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_OWNER_DATABASE_URL is not set.',
          'The db commands run as the owner role (it owns the schema and may create partitions).',
        ],
        exitCode: 2,
      };
    }
    return runDbCommand(
      subcommand,
      {
        connectionString,
        migrationsDir: defaultMigrationsDir(environment),
        mode: ownerRoleMode(environment),
      },
      subArgs,
    );
  }

  if (command === 'events') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory events list | show | health'],
        exitCode: 2,
      };
    }
    // The event log is read through the **projector** role: it may read the
    // log and may not write it. Using it here means the CLI exercises the
    // same privilege boundary the running system does.
    const connectionString =
      environment['FACTORY_PROJECTOR_DATABASE_URL'] ??
      environment['FACTORY_OWNER_DATABASE_URL'];
    if (connectionString === undefined) {
      return {
        lines: [
          'FACTORY_PROJECTOR_DATABASE_URL is not set.',
          'The events commands read the log through the factory_projector role.',
        ],
        exitCode: 2,
      };
    }
    return runEventsCommand(
      subcommand,
      {
        connectionString,
        mode: ownerRoleMode(environment),
        role: 'factory_projector',
      },
      subArgs,
    );
  }

  if (command === 'definition') {
    const [subcommand, ...subArgs] = rest;
    if (subcommand === undefined) {
      return {
        lines: ['usage: factory definition validate | plan | apply'],
        exitCode: 2,
      };
    }

    const parsed = parseArgs(subArgs);
    const sha = typeof parsed.flags['sha'] === 'string' ? parsed.flags['sha'] : undefined;
    const approvalId =
      typeof parsed.flags['approval'] === 'string' ? parsed.flags['approval'] : undefined;

    // The applier needs the **applier** role, so the connection string is
    // the applier's. The owner role is accepted as a fallback for the dev
    // cluster, where the roles are group roles assumed over one connection.
    const connectionString =
      environment['FACTORY_APPLIER_DATABASE_URL'] ??
      environment['FACTORY_OWNER_DATABASE_URL'];

    const definitionRoot = resolveDefinitionDirectory(environment);

    const { store, approvals, destroy } = buildDefinitionStore({
      definitionRoot,
      connectionString,
      mode: ownerRoleMode(environment),
      appliedBy: environment['FACTORY_OWNER_LOGIN'],
      approvalId,
      sha,
    });

    try {
      return await runDefinitionCommand(
        subcommand,
        {
          definitionRoot,
          scm: refusingScmCheck(),
          store,
          approval: await resolveApproval(approvalId, approvals),
          appliedBy: environment['FACTORY_OWNER_LOGIN'] ?? 'unknown',
          sha,
        },
      );
    } finally {
      await destroy();
    }
  }

  return {
    lines: [`unknown command \`factory ${command}\``, '', USAGE.trimEnd()],
    exitCode: 2,
  };
};

/**
 * The process entry point.
 */
export const main = async (): Promise<void> => {
  const result = await run(process.argv.slice(2));
  for (const line of result.lines) {
    console.log(line);
  }
  process.exitCode = result.exitCode;
};
