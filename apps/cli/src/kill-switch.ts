/**
 * `cli` — `factory kill-switch on|off`.
 *
 * ## The switch goes through the API
 *
 * pack `04` §9 lists `factory kill-switch on|off --reason …` as **AP-5**,
 * and pack `04` §3 says every access-point call emits an event with
 * `actor=human:<login>` and `authority.basis='human-access-point'`.
 *
 * So the CLI calls `POST /v1/factory/kill-switch`. It does **not** write
 * to a table. A switch flipped by writing to the database directly would
 * change the factory's behaviour while leaving no trace of who changed
 * it — and the switch is exactly the thing an operator most needs to be
 * able to explain afterwards.
 *
 * ## The reason is required
 *
 * The API's body schema requires a non-empty `reason`. The CLI does not
 * supply a default, because a kill switch engaged "for no reason" is a
 * switch that nobody will release. The refusal is the API's, and it is
 * the right one — so the CLI checks locally first and saves a round trip.
 *
 * ## `off` is the release, and it is named as the pack names it
 *
 * `on` and `off`, not `engage`/`release`. The pack's own words are what
 * an operator types.
 */

import { clientFor, loadCredentials, report, type AccessPointOptions, type CommandResult } from './tasks.js';

/**
 * The path of the kill-switch route.
 */
export const KILL_SWITCH_PATH = '/v1/factory/kill-switch';

/**
 * Run `factory kill-switch on|off --reason …`.
 *
 * @param state `on` or `off`
 * @param reason why the switch is being flipped
 * @param options the command's options
 */
export const runKillSwitch = async (
  state: string | undefined,
  reason: string | undefined,
  options: AccessPointOptions = {},
): Promise<CommandResult> => {
  if (state !== 'on' && state !== 'off') {
    return {
      lines: [
        'usage: factory kill-switch on|off --reason <why>',
        '',
        '  on   engage the switch: the factory takes no new work',
        '  off  release the switch: the factory takes work again',
      ],
      exitCode: 2,
    };
  }

  if (reason === undefined || reason.trim() === '') {
    // The reason is not optional. A switch engaged without one cannot
    // be released by whoever finds it, because they do not know what
    // it was for.
    return {
      lines: [
        'the kill switch needs a --reason.',
        'A switch engaged without a reason cannot be released by whoever',
        'finds it, because they do not know what it was for.',
      ],
      exitCode: 2,
    };
  }

  const loaded = await loadCredentials(options);
  if (!loaded.ok) {
    return { lines: [loaded.reason], exitCode: 2 };
  }
  const client = clientFor(loaded.credentials, options);

  const engage = state === 'on';
  const outcome = await client.post(KILL_SWITCH_PATH, { engage, reason });

  return report(outcome, [
    engage ? 'kill switch: engaged' : 'kill switch: released',
    `  reason: ${reason}`,
  ]);
};
