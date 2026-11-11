/**
 * `playwright.config` — the browser oracle's configuration (T-1.16).
 *
 * ## What this runs
 *
 * The **built** dashboard, served by the fixture server, on **one
 * origin** — the same shape as production (pack `02` §3: `apps/api`
 * serves the "static dashboard"). So the browser sees one origin, and
 * CORS never applies (pack `04` §3: "CORS closed by default").
 *
 * ## Why the fixture server rather than the real API
 *
 * The real API's `InspectionPort` is a **port**, and the projections
 * behind it land in later tickets (T-2.09's `approval_queue`, T-4.05's
 * `cost_attribution`). So the real API would answer an overview with
 * five empty regions — and the oracle would then prove nothing about
 * "reaching a review/approval item in ≤2 clicks", because there would
 * be no item to reach.
 *
 * The fixture answers with the **seeded** overview the blueprint
 * describes, with the awkward cases included on purpose.
 *
 * ## The two environment facts that shaped this file
 *
 * 1. **`channel: 'chromium'`** is mandatory. Playwright 1.63.0's
 *    `browsers.json` maps to chromium revision **1243**, which is the
 *    one cached at `~/.cache/ms-playwright/chromium-1243`. The
 *    *headless shell* for that revision is **not** cached and its CDN
 *    download times out on this network. So the full browser is
 *    launched, not the shell.
 * 2. **`--no-sandbox`** is required under WSL2, where the user namespaces
 *    the container's sandbox needs are not available.
 *
 * ## The suite is not part of `pnpm run ci`
 *
 * The CI script runs the unit, acceptance, invariant and redteam
 * suites. This one needs a **browser**, so it has its own script
 * (`pnpm run test:e2e:browser`) and belongs in a browser-enabled CI
 * job. The `test:e2e` script stays the Vitest path.
 */

import { defineConfig } from '@playwright/test';

/**
 * The port the fixture server listens on.
 *
 * A **fixed** port, not `--port 0`, because Playwright's `webServer`
 * needs a URL to poll before it starts the tests. The port is high and
 * out of the way of the API's 3001 and Vite's 5173.
 */
const FIXTURE_PORT = 5174;

/**
 * The fixture server's base URL.
 */
const BASE_URL = `http://127.0.0.1:${String(FIXTURE_PORT)}`;

export default defineConfig({
  testDir: './tests/e2e',
  // The oracle is one browser, one worker, one origin. Parallel workers
  // would each need their own server, and the fixture holds one kill
  // switch and one stream — so the workers would interfere.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    channel: 'chromium',
    launchOptions: { args: ['--no-sandbox'] },
    // The dashboard is private; the browser needs no camera, no
    // microphone and no geolocation to render five regions.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    // The dashboard must be **built** before the fixture serves it: the
    // fixture serves `apps/dashboard/dist`, and a missing build is a
    // 404 rather than a page. So the command builds and then serves.
    command: `pnpm --filter @factory/dashboard run build && node tools/serve-dashboard-fixture.ts --port ${String(FIXTURE_PORT)}`,
    url: `${BASE_URL}/v1/views/overview`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
