/**
 * `serve-dashboard-fixture` — the server the Playwright oracle drives.
 *
 * ## What it is
 *
 * One HTTP server that serves **both** the built dashboard and the API
 * on **one origin**. That is not a convenience — it is the shape
 * production has (pack `02` §3: `apps/api` serves the "static
 * dashboard"), and it is what lets the browser see one origin and keeps
 * CORS closed (pack `04` §3: "CORS closed by default").
 *
 * ## Why not the real API
 *
 * The real API's `InspectionPort` is a **port**, and the projections
 * behind it land in later tickets (T-2.09's `approval_queue`, T-4.05's
 * `cost_attribution`). So the real API would answer an overview with
 * five empty regions — and the oracle would then prove nothing about
 * "reaching a review/approval item in ≤2 clicks", because there would
 * be no item to reach.
 *
 * So this server answers with the **seeded** overview the blueprint
 * describes. The seed is deliberately *messy*: an item with no risk
 * tier, an item with no expiry, a task with no activity, a cost region
 * with no accepted change. The dashboard must render all of it
 * honestly.
 *
 * ## The kill switch really flips
 *
 * `POST /v1/factory/kill-switch` really flips a flag, and the flag is
 * really served back. So the round-trip is a real round-trip, not a
 * stub that always says "ok".
 *
 * ## The stream really streams
 *
 * `GET /v1/stream` is a real SSE endpoint that sends the six classes'
 * events and holds the connection open — so the browser's `EventSource`
 * is exercised for real.
 *
 * ## How it is run
 *
 * `node tools/serve-dashboard-fixture.ts --port 0` prints the URL it
 * is listening on, as JSON on stdout, and then serves until it is
 * killed.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

/**
 * The port to listen on. `0` means "any free port".
 */
const portArgument = (): number => {
  const index = process.argv.indexOf('--port');
  if (index === -1) {
    return 0;
  }
  const value = process.argv[index + 1];
  const parsed = Number(value ?? '0');
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Where the built dashboard is.
 *
 * The Vite build's output directory. The path is relative to the repo
 * root, because the tool is run from there.
 */
const DASHBOARD_ROOT = 'apps/dashboard/dist';

/**
 * The content type for a file extension.
 */
const contentTypeOf = (path: string): string => {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
};

/**
 * The seeded overview.
 *
 * blueprint `15` §6.2's five regions, with the awkward cases included
 * on purpose:
 *
 * * a **needs-you** item with no risk tier (it must sort **last**, not
 *   first);
 * * a needs-you item with **no expiry** (it must not look urgent);
 * * an **in-flight** task with no activity (it must come **first** — it
 *   is the one most likely to be wedged);
 * * a **health** item that is `failing` (the alarm);
 * * a **cost** region with no accepted change (no per-change figure).
 */
const SEEDED_OVERVIEW = {
  needsYou: [
    {
      kind: 'approval',
      taskId: 'task-critical',
      approvalId: 'appr-critical',
      title: 'merge the payment-service migration',
      riskTier: 'R4',
      rationale: 'touches the payment path',
      requestedAt: '2026-01-01T09:00:00.000Z',
      expiresAt: '2026-01-01T11:00:00.000Z',
    },
    {
      kind: 'review',
      taskId: 'task-review',
      reviewId: 'rev-review',
      title: 'review the auth-service refactor',
      riskTier: 'R2',
      requestedAt: '2026-01-01T10:00:00.000Z',
      expiresAt: '2026-01-01T12:00:00.000Z',
    },
    {
      kind: 'escalation',
      taskId: 'task-escalated',
      title: 'the gateway is failing over repeatedly',
      requestedAt: '2026-01-01T10:30:00.000Z',
      // No risk tier and no expiry — the two awkward cases.
    },
  ],
  inFlight: [
    {
      taskId: 'task-quiet',
      repo: 'acme/widgets',
      workflow: 'pr',
      stage: 'verify',
      state: 'running',
      isolationTier: 'T1',
      spentUsdMicros: 412_000,
      budgetUsdMicros: 1_000_000,
      // No last activity — the task that has not been heard from.
      nextExpectedEvent: 'stage.completed',
    },
    {
      taskId: 'task-busy',
      repo: 'acme/gadgets',
      workflow: 'pr',
      stage: 'build',
      state: 'running',
      isolationTier: 'T0',
      spentUsdMicros: 98_000,
      budgetUsdMicros: 500_000,
      lastActivityAt: '2026-01-01T10:55:00.000Z',
      nextExpectedEvent: 'model.requested',
    },
  ],
  recentOutcomes: [
    {
      taskId: 'task-merged',
      repo: 'acme/things',
      workflow: 'pr',
      outcome: 'merged',
      completedAt: '2026-01-01T10:40:00.000Z',
    },
    {
      taskId: 'task-failed',
      repo: 'acme/stuff',
      workflow: 'pr',
      outcome: 'failed',
      failureClassification: 'gate-timeout',
      completedAt: '2026-01-01T10:20:00.000Z',
    },
  ],
  health: [
    {
      capability: 'model-gateway',
      detail: 'the failover provider is degraded',
      severity: 'failing',
    },
    {
      capability: 'scheduler',
      detail: 'the queue is 12 deep',
      severity: 'degraded',
    },
  ],
  cost: [
    {
      day: '2026-01-01',
      workflow: 'pr',
      stage: 'build',
      usdMicros: 1_250_000,
      acceptedChangeCount: 2,
    },
    {
      day: '2026-01-01',
      workflow: 'pr',
      stage: 'verify',
      usdMicros: 640_000,
      // No accepted change — so the per-change figure is attributed
      // only to the rows that have one.
    },
  ],
};

/**
 * A task's events, for the timeline.
 */
const SEEDED_TASK_EVENTS: Readonly<Record<string, readonly unknown[]>> = {
  'task-critical': [
    {
      seq: 41,
      eventType: 'approval.requested',
      occurredAt: '2026-01-01T09:00:00.000Z',
      actor: { kind: 'human', id: 'alice' },
      correlationId: 'corr-critical',
    },
    {
      seq: 42,
      eventType: 'stage.completed',
      occurredAt: '2026-01-01T09:30:00.000Z',
      actor: { kind: 'service', id: 'orchestrator' },
      correlationId: 'corr-critical',
    },
  ],
  'task-review': [
    {
      seq: 51,
      eventType: 'review.queued',
      occurredAt: '2026-01-01T10:00:00.000Z',
      actor: { kind: 'service', id: 'orchestrator' },
      correlationId: 'corr-review',
    },
  ],
};

/**
 * The kill switch's state.
 */
let killSwitchEngaged = false;

/**
 * The reason the switch was last flipped.
 */
let killSwitchReason = '';

/**
 * The stream's subscribers.
 *
 * Each one is a response the server is holding open. When an event is
 * published, it is written to every one of them.
 */
const subscribers = new Set<ServerResponse>();

/**
 * The counter the stream's event ids come from.
 */
let streamSeq = 0;

/**
 * The counter the overview's stream tick comes from.
 *
 * It increments on **every published event**, and the overview carries
 * it. So the browser can watch it move — which is the only honest way
 * to prove the SSE event reached the page and the page acted on it.
 */
let streamTick = 0;

/**
 * Publish an event to every open stream.
 */
const publish = (eventType: string): void => {
  streamSeq += 1;
  // The tick. It is what makes the stream **observable** from the
  // browser: the overview carries it, and the dashboard re-reads the
  // overview when an event arrives — so a tick that moves is proof that
  // the event reached the page and the page acted on it.
  streamTick += 1;
  const frame =
    `id: ${String(streamSeq)}\n` +
    `event: ${eventType}\n` +
    `data: ${JSON.stringify({
      seq: streamSeq,
      eventType,
      class: eventType,
      aggregate: { kind: 'task', id: 'task-review' },
      occurredAt: new Date().toISOString(),
      payload: { note: 'the fixture published this' },
    })}\n\n`;
  for (const response of subscribers) {
    response.write(frame);
  }
};

/**
 * Send a JSON body.
 */
const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
};

/**
 * Send a problem document.
 *
 * pack `04` §3: failures are `application/problem+json` with a closed
 * `code` set.
 */
const sendProblem = (
  response: ServerResponse,
  status: number,
  code: string,
  title: string,
  detail: string,
): void => {
  const text = JSON.stringify({
    type: 'about:blank',
    title,
    status,
    code,
    detail,
    requestId: 'req-fixture',
  });
  response.writeHead(status, {
    'content-type': 'application/problem+json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
};

/**
 * Read a request's body.
 */
const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      resolve(body);
    });
  });

/**
 * Serve the API's routes.
 *
 * @returns `true` when the request was answered.
 */
const serveApi = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> => {
  if (url.pathname === '/v1/views/overview') {
    // The tick travels with the overview, so a browser can watch it move
    // and know that a stream event really reached the page.
    sendJson(response, 200, { ...SEEDED_OVERVIEW, streamTick });
    return true;
  }

  if (url.pathname === '/v1/tasks') {
    sendJson(response, 200, { items: [] });
    return true;
  }

  const eventsMatch = /^\/v1\/tasks\/([^/]+)\/events$/.exec(url.pathname);
  if (eventsMatch !== null) {
    const taskId = decodeURIComponent(eventsMatch[1] as string);
    sendJson(response, 200, { items: SEEDED_TASK_EVENTS[taskId] ?? [] });
    return true;
  }

  const taskMatch = /^\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
  if (taskMatch !== null) {
    const taskId = decodeURIComponent(taskMatch[1] as string);
    sendJson(response, 200, { id: taskId, state: 'awaiting-approval' });
    return true;
  }

  if (url.pathname === '/v1/factory/kill-switch' && request.method === 'POST') {
    const body = await readBody(request);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendProblem(response, 400, 'validation', 'the body is not valid', 'the body is not JSON');
      return true;
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (typeof record['engage'] !== 'boolean') {
      sendProblem(
        response,
        400,
        'validation',
        'the body is not valid',
        'engage must be a boolean',
      );
      return true;
    }
    if (typeof record['reason'] !== 'string' || record['reason'].trim() === '') {
      sendProblem(
        response,
        400,
        'validation',
        'the body is not valid',
        'reason must be a non-empty string',
      );
      return true;
    }
    killSwitchEngaged = record['engage'];
    killSwitchReason = record['reason'];
    sendJson(response, 200, { engaged: killSwitchEngaged, reason: killSwitchReason });
    publish('killswitch.changed');
    return true;
  }

  if (url.pathname === '/v1/factory/kill-switch' && request.method === 'GET') {
    sendJson(response, 200, { engaged: killSwitchEngaged, reason: killSwitchReason });
    return true;
  }

  if (url.pathname === '/v1/stream') {
    // The SSE stream. The connection is held open, and the headers say
    // so — `x-accel-buffering: no` so a proxy does not batch the
    // frames.
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': the fixture stream is open\n\n');
    subscribers.add(response);
    request.on('close', () => {
      subscribers.delete(response);
    });
    return true;
  }

  return false;
};

/**
 * The CSRF token the fixture's session carries.
 *
 * pack `04` §3: the browser is authenticated with a **session cookie**,
 * and a mutating call must carry the **CSRF token** as well. The token
 * belongs to the session, so the server renders it into the page.
 *
 * The fixture's value is a **fake** (HR-9) — it is never a real secret,
 * and it is not one that grants anything beyond this fixture.
 */
const FIXTURE_CSRF_TOKEN = 'csrf-fixture';

/**
 * The name of the meta tag the CSRF token is served in.
 *
 * The dashboard reads it from there (see `apps/dashboard/src/main.tsx`).
 */
const CSRF_META_NAME = 'factory-csrf-token';

/**
 * Render the dashboard's HTML, with the CSRF token in it.
 *
 * The token goes into the **head**, in a meta tag, and it is injected
 * into the served document rather than baked into the built asset — the
 * token is per-session, so it cannot be part of a file built once.
 *
 * The injection is a **string replacement** on the `</head>` marker, and
 * if the marker is absent the document is served unchanged. A dashboard
 * built without a `</head>` is malformed, but a fixture that refused to
 * serve it would hide the dashboard's own failure behind the fixture's.
 */
const renderDashboardHtml = (html: string): string => {
  const tag = `<meta name="${CSRF_META_NAME}" content="${FIXTURE_CSRF_TOKEN}" />`;
  if (!html.includes('</head>')) {
    return html;
  }
  return html.replace('</head>', `  ${tag}\n  </head>`);
};

/**
 * Serve a file from the built dashboard.
 */
const serveFile = async (
  response: ServerResponse,
  path: string,
): Promise<boolean> => {
  try {
    const content = await readFile(path);
    if (path.endsWith('.html')) {
      const rendered = renderDashboardHtml(content.toString('utf8'));
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(rendered),
        'cache-control': 'no-store',
      });
      response.end(rendered);
      return true;
    }
    response.writeHead(200, {
      'content-type': contentTypeOf(path),
      'content-length': content.byteLength,
      'cache-control': 'no-store',
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
};

/**
 * Serve the built dashboard.
 */
const serveDashboard = async (
  response: ServerResponse,
  url: URL,
): Promise<void> => {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  // The path is normalised and then checked to be inside the root —
  // a request for `/../../etc/passwd` must not escape it.
  const relative = normalize(requested).replace(/^([/\\])+/, '');
  const path = join(DASHBOARD_ROOT, relative);
  if (!path.startsWith(DASHBOARD_ROOT)) {
    sendProblem(response, 403, 'policy_denied', 'refused', 'the path is outside the dashboard');
    return;
  }
  if (await serveFile(response, path)) {
    return;
  }
  // An unknown path falls back to the index — a single-page app's
  // own routing.
  if (await serveFile(response, join(DASHBOARD_ROOT, 'index.html'))) {
    return;
  }
  sendProblem(response, 404, 'not_found', 'not found', 'the dashboard is not built');
};

/**
 * The server.
 */
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  void serveApi(request, response, url)
    .then((answered) => {
      if (!answered) {
        return serveDashboard(response, url);
      }
      return undefined;
    })
    .catch(() => {
      if (!response.headersSent) {
        sendProblem(response, 500, 'policy_denied', 'refused', 'the request could not be served');
      }
    });
});

server.listen(portArgument(), '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  // The URL, on one line, so the caller can read it.
  process.stdout.write(`http://127.0.0.1:${String(port)}\n`);
});
