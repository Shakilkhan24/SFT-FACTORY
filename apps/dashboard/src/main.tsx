/**
 * `dashboard/main` — the browser entry point (T-1.16).
 *
 * ## The clock is injected
 *
 * AGENTS.md §4: "Time via an injected `Clock`." The browser has no
 * injected clock, so the entry point builds one — and the *view* takes
 * it as a prop, which is what makes the view testable under Vitest
 * with a pinned time.
 *
 * The clock ticks every ten seconds, so an age in the view stays
 * honest without a full re-render storm. The stream drives the
 * *content* updates; the tick drives the *ages*.
 *
 * ## The client is built here, and nowhere else
 *
 * The React layer takes the client as a prop, so a test can hand it one
 * of its own. This file is the only place the browser's `fetch` is
 * reached for.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { buildApiClient } from './api.js';
import { Dashboard } from './views.js';
import './styles.css';

/**
 * How often the clock ticks, in milliseconds.
 */
const TICK_INTERVAL_MS = 10_000;

/**
 * The name of the meta tag the CSRF token is served in.
 *
 * pack `04` §3: the browser is authenticated with a **session cookie**,
 * so a mutating call carries the **CSRF token** as well. The token
 * belongs to the session, so the server renders it into the page — and
 * a meta tag is where it goes: it is not a cookie (a cookie would be
 * sent automatically, and the token is there precisely to be *not*
 * automatic), and it is not in the HTML body (where a scraper would
 * find it).
 */
const CSRF_META_NAME = 'factory-csrf-token';

/**
 * Read the CSRF token from the page.
 *
 * Absent is **absent**, not an error — a read-only page has no mutating
 * call to make, and the dashboard's other five regions work without it.
 */
const readCsrfToken = (): string | undefined => {
  const element = document.querySelector(`meta[name="${CSRF_META_NAME}"]`);
  const content = element?.getAttribute('content');
  return content === null || content === undefined || content === ''
    ? undefined
    : content;
};

/**
 * The root component.
 */
const Root = (): React.JSX.Element => {
  const [now, setNow] = useState(() => new Date());
  const [client] = useState(() => buildApiClient({ csrfToken: readCsrfToken() }));

  useEffect(() => {
    const handle = setInterval(() => {
      setNow(new Date());
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(handle);
    };
  }, []);

  /**
   * Engage or release the kill switch.
   *
   * The dashboard is **read-and-request** (ADR-0001, blueprint `15`
   * §6.3): it cannot write to the definition. But the kill switch is
   * not the definition — it is the factory's own state, and the API
   * owns it. So the dashboard POSTs to the access point (AP-5) and the
   * API records who did it.
   *
   * The returned string is a **failure message**, or `undefined` when
   * the call succeeded. The reason is asked for before the call,
   * because a switch engaged without a reason cannot be released by
   * whoever finds it.
   */
  const setKillSwitch = async (
    engage: boolean,
    reason: string,
  ): Promise<string | undefined> => {
    try {
      await client.setKillSwitch(engage, reason);
      return undefined;
    } catch (cause: unknown) {
      return cause instanceof Error
        ? cause.message
        : 'the kill switch could not be flipped';
    }
  };

  return <Dashboard client={client} now={now} setKillSwitch={setKillSwitch} />;
};

/**
 * The element the dashboard is mounted into.
 */
const container = document.getElementById('root');

if (container === null) {
  throw new Error('the page has no #root element to mount the dashboard into');
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
