/**
 * `api/routes` — the **route inventory** (T-1.14).
 *
 * ## Why this file is the point of the ticket
 *
 * The ticket's third proof is: *"a **route-inventory test proves no
 * endpoint accepts free-form agent instructions**"*. That proof is only
 * worth something if it is **structural** — if the inventory is derived
 * from the routes the app actually serves, so a route added later is
 * covered without anyone remembering to extend a list.
 *
 * So this file **is** the inventory, and the routes are registered *from*
 * it. There is no second place where a route can be added.
 *
 * ## What it buys
 *
 * ADR-0002's rejected alternative is exactly the thing this prevents:
 * "Humans operating agents directly (bypassing access points) … the
 * 'chat with the agent' pattern. It makes governance unenforceable and
 * leaves no durable record of authority." Blueprint `13` §3.1 calls it
 * "**Deliberately excluded**: a generic 'chat with the agent' access
 * point."
 *
 * So each route here declares:
 *
 * * the **access point** it belongs to (blueprint `13` §3.1's six);
 * * whether it **mutates** — and so whether it must emit an event with
 *   its actor and authority, and whether it needs an `Idempotency-Key`;
 * * the **body schema** — and the inventory test proves that no body
 *   schema accepts a free-form instruction field.
 *
 * ## The body schemas
 *
 * The bodies are **Zod schemas with `.strict()`**, so an unknown field is
 * rejected at the boundary (the stack profile: "no untyped data across a
 * boundary: parse into a validated type and reject unknown fields").
 * That is what makes the free-form-instruction proof work: a body cannot
 * smuggle an `instructions` field past a strict schema, and no schema in
 * this file *declares* one.
 *
 * The one body that carries free text is AP-1's `manual` intent source
 * (`title`, `body`) and the approval `comment`. Those are **content the
 * factory processes**, not **instructions to an agent**: they are inputs
 * to a task, they are stored as artefacts, and they are never executed
 * as instructions. The inventory test checks the *shape*, not the
 * content: what matters is that no field is a free-form command to an
 * agent.
 */

import { z } from 'zod';

/**
 * The access points (blueprint `13` §3.1).
 */
export const ACCESS_POINTS = [
  'define-intent',
  'approve',
  'review',
  'inspect',
  'intervene',
  'amend-factory',
] as const;

export type AccessPoint = (typeof ACCESS_POINTS)[number];

/**
 * The body of AP-1's intent.
 *
 * pack `04` §3: `{repo, source:{kind:'github-issue',ref:'o/r#123'} |
 * {kind:'manual',title,body}, workflow?, budgetUsdMicros?}`.
 */
export const IntentBody = z
  .object({
    /** The repository — `owner/repo`. */
    repo: z.string().min(1),
    /** Where the intent came from. */
    source: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('github-issue'),
          /** The issue reference — `o/r#123`. */
          ref: z.string().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal('manual'),
          /** The title. */
          title: z.string().min(1),
          /**
           * The body.
           *
           * This is *content the factory processes* — it becomes a task
           * input, not an instruction to an agent. It is bounded so a
           * caller cannot push an unbounded payload through the API.
           */
          body: z.string().min(1).max(100_000),
        })
        .strict(),
    ]),
    /** The workflow to run, when the caller names one. */
    workflow: z.string().min(1).optional(),
    /** The budget, in integer micro-USD. */
    budgetUsdMicros: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * The body of AP-2's approval decision.
 *
 * pack `04` §3: `{decision:'grant'|'refuse', comment?,
 * securityScopeAck?, reviewMinutes?}`.
 */
export const ApprovalDecisionBody = z
  .object({
    /** The decision. */
    decision: z.enum(['grant', 'refuse']),
    /** The approver's comment. */
    comment: z.string().min(1).max(10_000).optional(),
    /**
     * Whether the approver acknowledges the security scope.
     *
     * A security-scope approval must be acknowledged explicitly — that is
     * the difference between an approver who read the scope and one who
     * clicked through.
     */
    securityScopeAck: z.boolean().optional(),
    /** How many minutes the review took. */
    reviewMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * The body of AP-2's revoke.
 */
export const ApprovalRevokeBody = z
  .object({
    /** Why the approval is revoked. */
    reason: z.string().min(1).max(10_000),
  })
  .strict();

/**
 * The body of AP-3's review decision.
 *
 * pack `04` §3: `{decision:'approve'|'reject'|'defer', rationale}`.
 */
export const ReviewDecisionBody = z
  .object({
    /** The decision. */
    decision: z.enum(['approve', 'reject', 'defer']),
    /** The reviewer's rationale — required, always. */
    rationale: z.string().min(1).max(10_000),
  })
  .strict();

/**
 * The body of AP-5's intervention.
 */
export const InterventionBody = z
  .object({
    /** Why. */
    reason: z.string().min(1).max(10_000),
  })
  .strict();

/**
 * The body of AP-5's kill switch.
 */
export const KillSwitchBody = z
  .object({
    /** Whether to engage the switch. */
    engage: z.boolean(),
    /** Why. */
    reason: z.string().min(1).max(10_000),
  })
  .strict();

/**
 * The body of AP-5's temporary grant.
 *
 * pack `04` §3: `{taskId, capability, scope, ttlSeconds≤3600, reason}`.
 */
export const TemporaryGrantBody = z
  .object({
    /** The task the grant is for. */
    taskId: z.string().min(1),
    /** The capability. */
    capability: z.string().min(1),
    /** The scope. */
    scope: z.string().min(1),
    /** The time to live — at most an hour. */
    ttlSeconds: z.number().int().positive().max(3600),
    /** Why. */
    reason: z.string().min(1).max(10_000),
  })
  .strict();

/**
 * The body of AP-5's defect flag.
 */
export const DefectFlagBody = z
  .object({
    /** The note. */
    note: z.string().min(1).max(10_000),
  })
  .strict();

/**
 * The body of AP-6's apply.
 *
 * pack `04` §3: `{sha, approvalId}` — "applies **only** a merged SHA".
 */
export const DefinitionApplyBody = z
  .object({
    /** The merged SHA the change landed as. */
    sha: z.string().min(1),
    /** The approval bound to that SHA. */
    approvalId: z.string().min(1),
  })
  .strict();

/**
 * How a route authenticates.
 */
export type AuthMode =
  /** A browser session cookie, and a CSRF token for the mutating calls. */
  | 'session'
  /** A CLI bearer token. */
  | 'token'
  /** Both — a session for the browser, a token for the CLI. */
  | 'session-or-token'
  /** Neither — the route is public (the webhook, the health checks). */
  | 'public';

/**
 * A route in the inventory.
 */
export interface RouteSpec {
  /** The method. */
  readonly method: 'GET' | 'POST';
  /** The path — with `{param}` placeholders. */
  readonly path: string;
  /** The access point the route belongs to. */
  readonly accessPoint: AccessPoint;
  /** Whether the route changes state. */
  readonly mutating: boolean;
  /** How the route authenticates. */
  readonly auth: AuthMode;
  /** The body schema, for the mutating routes that take one. */
  readonly body?: z.ZodTypeAny;
  /** The scopes a CLI token must carry. */
  readonly scopes: readonly string[];
  /**
   * Whether the rate limit applies to this route.
   *
   * It applies to everything by default. The **health checks** are
   * exempt, and the exemption is declared here rather than inferred in
   * the app: a health check that answers `429` tells the orchestrator
   * the process is down when it is merely busy, and that false negative
   * can trigger a restart loop.
   *
   * So the default is `true` and the exemption is explicit — a new
   * route is rate-limited unless it says otherwise.
   */
  readonly rateLimited?: boolean;
}

/**
 * The routes, in the order of pack `04` §3's table.
 *
 * The table's order is the table's order, because the pack's table is the
 * specification and a reader comparing the two should find them in the
 * same order.
 */
export const ROUTES: readonly RouteSpec[] = [
  // ---- AP-1 · define-intent -----------------------------------------
  {
    method: 'POST',
    path: '/v1/intents',
    accessPoint: 'define-intent',
    mutating: true,
    auth: 'session-or-token',
    body: IntentBody,
    scopes: ['define-intent'],
  },

  // ---- AP-2 · approve ------------------------------------------------
  {
    method: 'GET',
    path: '/v1/approvals',
    accessPoint: 'approve',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['approve'],
  },
  {
    method: 'GET',
    path: '/v1/approvals/{id}',
    accessPoint: 'approve',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['approve'],
  },
  {
    method: 'POST',
    path: '/v1/approvals/{id}/decision',
    accessPoint: 'approve',
    mutating: true,
    auth: 'session-or-token',
    body: ApprovalDecisionBody,
    scopes: ['approve'],
  },
  {
    method: 'POST',
    path: '/v1/approvals/{id}/revoke',
    accessPoint: 'approve',
    mutating: true,
    auth: 'session-or-token',
    body: ApprovalRevokeBody,
    scopes: ['approve'],
  },

  // ---- AP-3 · review -------------------------------------------------
  {
    method: 'GET',
    path: '/v1/reviews',
    accessPoint: 'review',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['review'],
  },
  {
    method: 'GET',
    path: '/v1/reviews/{taskId}',
    accessPoint: 'review',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['review'],
  },
  {
    method: 'POST',
    path: '/v1/reviews/{taskId}/decision',
    accessPoint: 'review',
    mutating: true,
    auth: 'session-or-token',
    body: ReviewDecisionBody,
    scopes: ['review'],
  },

  // ---- AP-4 · inspect ------------------------------------------------
  {
    method: 'GET',
    path: '/v1/views/overview',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/tasks',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/tasks/{id}',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/tasks/{id}/events',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/tasks/{id}/runs',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/runs/{id}',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/runs/{id}/artefacts/{name}',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/metrics/summary',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/audit/explain',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },
  {
    method: 'GET',
    path: '/v1/stream',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['inspect'],
  },

  // ---- AP-5 · intervene ----------------------------------------------
  {
    method: 'POST',
    path: '/v1/tasks/{id}/pause',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: InterventionBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/tasks/{id}/resume',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: InterventionBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/tasks/{id}/cancel',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: InterventionBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/tasks/{id}/escalate',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: InterventionBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/tasks/{id}/rerun',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: InterventionBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/factory/kill-switch',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: KillSwitchBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/grants/temporary',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: TemporaryGrantBody,
    scopes: ['intervene'],
  },
  {
    method: 'POST',
    path: '/v1/tasks/{id}/defect-flag',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'session-or-token',
    body: DefectFlagBody,
    scopes: ['intervene'],
  },

  // ---- AP-6 · amend-factory ------------------------------------------
  {
    method: 'GET',
    path: '/v1/definition/plan',
    accessPoint: 'amend-factory',
    mutating: false,
    auth: 'session-or-token',
    scopes: ['amend-factory'],
  },
  {
    method: 'POST',
    path: '/v1/definition/apply',
    accessPoint: 'amend-factory',
    mutating: true,
    auth: 'session-or-token',
    body: DefinitionApplyBody,
    scopes: ['amend-factory'],
  },

  // ---- the operational surface --------------------------------------
  {
    method: 'POST',
    path: '/webhooks/github',
    accessPoint: 'intervene',
    mutating: true,
    auth: 'public',
    scopes: [],
  },
  {
    method: 'GET',
    path: '/healthz',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'public',
    scopes: [],
    rateLimited: false,
  },
  {
    method: 'GET',
    path: '/readyz',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'public',
    scopes: [],
    rateLimited: false,
  },
  {
    method: 'GET',
    path: '/metrics',
    accessPoint: 'inspect',
    mutating: false,
    auth: 'public',
    scopes: [],
  },
];

/**
 * The field names the inventory test refuses.
 *
 * These are the names a "chat with the agent" endpoint would have to
 * carry. The test proves that **no** body schema in the inventory accepts
 * any of them.
 *
 * The list is deliberately broad: it names the *shapes* a free-form
 * instruction channel would take, not just the word "instructions".
 */
export const FREE_FORM_FIELD_NAMES: readonly string[] = [
  'instructions',
  'instruction',
  'prompt',
  'prompts',
  'systemPrompt',
  'system_prompt',
  'messages',
  'command',
  'commands',
  'directive',
  'directives',
  'task',
  'tasks',
  'agentInstructions',
  'agent_instructions',
  'freeform',
  'freeForm',
  'chat',
  'ask',
  'query',
  'objective',
  'goal',
];

/**
 * Find the route for a method and path.
 *
 * @param method the HTTP method
 * @param path the request path
 */
export const findRoute = (
  method: string,
  path: string,
): RouteSpec | undefined =>
  ROUTES.find(
    (route) =>
      route.method === method &&
      (route.path === path ||
        route.path.split('/').every((segment, index) => {
          if (segment.startsWith('{')) {
            return path.split('/')[index] !== undefined;
          }
          return segment === path.split('/')[index];
        })),
  );
