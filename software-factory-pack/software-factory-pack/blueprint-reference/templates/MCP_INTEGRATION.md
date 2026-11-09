# Template — Integration Registration (`McpServerRegistration` / `ToolCapability`)

**Use when:** registering an external system with the factory — an MCP server, an HTTP service, a CLI, or an in-process library.
**Authority:** `11_TOOLS_MCP_AND_INTEGRATIONS.md` §2 (capability record), §3 (MCP story and reconciliation), §4 (grants and scopes), §7 (credentials) are the sources of truth.
**Submission:** this file is a **definition change**. It is reviewed at the **security-scope** approval class whenever the capability's effect class is E2 or above, because the registration defines what the factory can reach.

---

## Authoring rules

1. **The registry is authoritative.** A capability that is not in the registry does not exist for the factory, regardless of what a server advertises. A server operator adding a tool does not thereby add it (FR-62).
2. **MCP is a transport, not a capability model.** The registration is factory-owned and transport-independent. Changing transport must not require changing a workflow's grant.
3. **Declare the effect class honestly, and conservatively when unsure.** The effect class determines which gates the capability passes through. A misclassification weakens the gate. An over-restrictive classification is a friction cost; an under-restrictive one is a safety defect.
4. **Never name a secret.** The capability names a `credentialRef`; the credential broker resolves it at call time. A capability record containing secret material is a rejection, not a review comment.
5. **Trust levels are explicit.** `untrusted` servers are never offered to an agent, regardless of how useful their tools are.
6. **Input and output trust are classified separately.** An issue body's text is untrusted even when the issue was filed by a colleague; a build result from your own CI is trusted output but may contain untrusted upstream material.
7. **Prefer the transport with the strongest output contract.** A schema-validated output is a cheap failure; a prose output is a silent corruption risk.
8. **Every capability has an owner and a health check.** A capability without an owner is unmaintained; one without a health check is discovered broken by a user's task.
9. **Scope is expressed in the registry.** The `resourcePattern` is what the broker checks against the actual resource at invocation time — this is the check that catches a capability handed the wrong repository.
10. **An integration that cannot state its degraded behaviour is not ready.** Every capability must say what happens when it is unavailable.

---

## The template — server registration

```yaml
apiVersion: factory/v1
kind: McpServerRegistration
metadata:
  id: mcp.<vendor>.<purpose>       # stable identity
  version: <integer>
  owner: <team-or-person>           # accountable for this integration
  title: <short human title>
  description: >
    What this server provides and what it is used for.
  transport:
    type: stdio | http-sse | streamable-http
    # For stdio: the command and its pinned version.
    command: [<binary>]
    version: "<pinned>"
    args: []
    # For HTTP: the endpoint and its authentication reference.
    endpoint: <url>
    # Where the server process runs. Not inside an agent's environment.
    runsIn: control-plane | broker-side
  trust:
    level: internal | external | untrusted
    verified: true | false
    # Where the provenance was established.
    provenance: <evidence-reference>
    signature: <signature-ref> | null
    # External servers: the per-tool approval that is mandatory before use.
    perToolApprovalRequired: true | false
  scope:
    # The capabilities this server may expose. A tool outside this list is
    # not reconciled into the registry at all.
    allowedCapabilities: [<glob or id>]
    # Explicitly excluded, even if advertised.
    deniedCapabilities: [<capability.id>]
  credentials:
    # A reference, never a secret.
    credentialRef: cred.<name>
    # The scopes the credential carries.
    scopes: [<scope>]
    # Whether the credential is minted per invocation or pooled.
    issuance: per-invocation | pooled
    ttlSeconds: <integer>
  network:
    egress: none | <declared-hosts>
    # For a stdio server: the hosts it is permitted to reach.
    allowedHosts: []
    denyAllElse: true
  health:
    checkType: spawn-and-list | http-probe | <custom>
    intervalSeconds: <integer>
    timeoutSeconds: <integer>
    degradedBehaviour: fail-fast | degrade | queue
    # When `degrade`, the named reduced mode.
    reducedMode: <description> | null
  discovery:
    # registered-static: the registry entry is the only truth.
    # probed-and-diffed: the server is probed and the difference recorded.
    mode: registered-static | probed-and-diffed
    reconciledAt: <timestamp>
    # Where the findings from the last reconciliation are recorded.
    findingsRef: <finding-record-ref> | null
```

---

## The template — capability record

One per tool or endpoint the integration exposes. These live in the registry, not in the server.

```yaml
apiVersion: factory/v1
kind: ToolCapability
metadata:
  id: <vendor>.<verb>.<noun>         # factory-owned, stable, transport-independent
  version: "<integer>"
  owner: <team-or-person>
  # read | mutation | compute | communicate
  kind: read | mutation | compute | communicate
  transport:
    type: mcp | http | cli | library | in-process | fetching-service
    server: <mcp server id>          # for type: mcp
    tool: <transport-level name>     # the name on the wire
    # The version of the remote contract this record was written against.
    contractVersion: "<string>"
  description: >
    What this capability does, in one or two sentences.
  inputSchema:
    type: object
    required: [<field>]
    properties:
      <field>: {type: string}
    additionalProperties: false
  outputSchema:
    type: object
    properties:
      <field>: {type: string}
    # A capability whose output is genuinely unstructured says so here.
    structured: true | false
  scope:
    required: [<scope from the vocabulary>]
    optional: [<scope>]
    # The pattern the actual resource must match at invocation time.
    resourcePattern: <scope pattern>
    # control-plane | execution-environment
    environment: control-plane | execution-environment
  effect:
    # E0 | E1 | E2 | E3 | E4
    class: E0 | E1 | E2 | E3 | E4
    reversible: true | false
    # The operation that undoes this one. Required if reversible.
    undo: <capability.id> | null
    external: true | false
    # For E4: the enumerated runbook this capability may act under.
    runbookRef: <runbook-id> | null
  credentials:
    credentialRef: cred.<name>
    scopes: [<scope>]
    ttlSeconds: <integer>
  cost:
    model: none | <cost-model-id>
    perCallUsd: <number>
  trust:
    inputTrust: trusted | untrusted-content | derived
    resultTrust: trusted | untrusted-content | derived
  health:
    checkType: live | inherited
    timeoutSeconds: <integer>
    degradedBehaviour: fail-fast | degrade | queue
  observability:
    redactArguments: [<field>]
    redactResult: [<field>]
  # The capability that undoes this one, where one exists — surfaced in the
  # review queue so an approver can see the reversibility claim.
  inverseOf: <capability.id> | null
```

---

## The reconciliation record

Produced by the discovery process; not authored by hand, but it is a reviewable artefact.

```yaml
apiVersion: factory/v1
kind: RegistryReconciliation
metadata:
  server: mcp.<vendor>.<purpose>
  reconciledAt: <timestamp>
  mode: registered-static | probed-and-diffed
findings:
  - type: advertised-not-registered    # does NOT become callable
    tool: <transport-level name>
    disposition: ignored-recorded
    rationale: >
      Not in the registry. Not offered, not callable, not discoverable by an agent.
  - type: registered-not-advertised    # marks the capability unavailable
    tool: <transport-level name>
    disposition: marked-unavailable
    rationale: The server no longer exposes a registered capability.
  - type: schema-drift                 # the advertised schema differs
    tool: <transport-level name>
    fieldsChanged: [<field>]
    disposition: flagged-for-review
    rationale: The registry record is authoritative; the difference is recorded.
  - type: contract-version-changed
    tool: <transport-level name>
    from: "<version>"
    to: "<version>"
    disposition: flagged-for-review
summary:
  advertised: <count>
  registered: <count>
  actionable: <count>
  unavailable: <count>
```

---

## Worked example — an internal MCP server for issue tracking

```yaml
apiVersion: factory/v1
kind: McpServerRegistration
metadata:
  id: mcp.internal.issue-tracker
  version: 2
  owner: engineering-tools
  title: Internal issue tracker
  description: >
    Read and update issues in the internal tracker. Provides issue text to
    the triage stage and creates the tracking artefact for a task. Does not
    provide merge, deploy, or credential capabilities.
  transport:
    type: stdio
    command: ["mcp-server-issue-tracker"]
    version: "2.3.1"
    args: ["--config", "/etc/factory/mcp/issue-tracker.yaml"]
    runsIn: control-plane
  trust:
    level: internal
    verified: true
    provenance: "built-internal; source in eng-tools/mcp-issue-tracker; reviewed 2026-09-14"
    signature: "sig:ed25519:…"
    perToolApprovalRequired: false
  scope:
    allowedCapabilities: ["issue.*"]
    deniedCapabilities: ["issue.delete", "issue.admin"]
  credentials:
    credentialRef: cred.issue.bot
    scopes: ["issue:read", "issue:write"]
    issuance: pooled
    ttlSeconds: 3600
  network:
    egress: none
    allowedHosts: []
    denyAllElse: true
  health:
    checkType: spawn-and-list
    intervalSeconds: 60
    timeoutSeconds: 5
    degradedBehaviour: queue
    reducedMode: null
  discovery:
    mode: probed-and-diffed
    reconciledAt: "2026-11-04T03:00:00Z"
    findingsRef: findings.mcp-issue-tracker@2026-11-04
---
apiVersion: factory/v1
kind: ToolCapability
metadata:
  id: issue.read
  version: "4"
  owner: engineering-tools
  kind: read
  transport:
    type: mcp
    server: mcp.internal.issue-tracker
    tool: read_issue
    contractVersion: "2.3"
  description: >
    Reads a single issue by id, including its title, body, labels, and comments.
  inputSchema:
    type: object
    required: [issueId]
    properties:
      issueId: {type: string, maxLength: 64}
    additionalProperties: false
  outputSchema:
    type: object
    properties:
      id: {type: string}
      title: {type: string}
      body: {type: string}
      labels: {type: array, items: {type: string}}
      comments: {type: array, items: {type: string}}
    structured: true
  scope:
    required: ["issue:read"]
    optional: []
    resourcePattern: "project:*"
    environment: control-plane
  effect:
    class: E0
    reversible: true
    undo: null
    external: false
    runbookRef: null
  credentials:
    credentialRef: cred.issue.bot
    scopes: ["issue:read"]
    ttlSeconds: 3600
  cost:
    model: none
    perCallUsd: 0.0
  trust:
    inputTrust: trusted
    # Issue bodies routinely quote external reports, logs, and web content.
    resultTrust: untrusted-content
  health:
    checkType: live
    timeoutSeconds: 5
    degradedBehaviour: queue
  observability:
    redactArguments: []
    redactResult: ["body", "comments"]
---
apiVersion: factory/v1
kind: ToolCapability
metadata:
  id: issue.write
  version: "2"
  owner: engineering-tools
  kind: mutation
  transport:
    type: mcp
    server: mcp.internal.issue-tracker
    tool: update_issue
    contractVersion: "2.3"
  description: >
    Updates the labels, assignee, and status of an existing issue. Does not
    create issues and cannot delete them.
  inputSchema:
    type: object
    required: [issueId, fields]
    properties:
      issueId: {type: string, maxLength: 64}
      fields:
        type: object
        properties:
          labels: {type: array, items: {type: string}}
          assignee: {type: string}
          status: {type: string, enum: [open, in_progress, blocked, done]}
        additionalProperties: false
    additionalProperties: false
  outputSchema:
    type: object
    properties:
      id: {type: string}
      updatedFields: {type: array, items: {type: string}}
    structured: true
  scope:
    required: ["issue:write"]
    optional: ["issue:read"]
    resourcePattern: "project:*"
    environment: control-plane
  effect:
    class: E1
    reversible: true
    undo: issue.write
    external: true
    runbookRef: null
  credentials:
    credentialRef: cred.issue.bot
    scopes: ["issue:write"]
    ttlSeconds: 3600
  cost:
    model: none
    perCallUsd: 0.0
  trust:
    inputTrust: untrusted-content
    resultTrust: trusted
  health:
    checkType: live
    timeoutSeconds: 5
    degradedBehaviour: fail-fast
  observability:
    redactArguments: []
    redactResult: []
  inverseOf: issue.write
```

---

## Review checklist

Before submitting:

- [ ] The server's trust level is justified, with provenance recorded; `untrusted` means no tool is offered to an agent.
- [ ] Every advertised tool has a corresponding registry record, or a reconciliation finding explaining why not.
- [ ] Every capability has an effect class, and the class is consistent with the `undo` claim: `reversible: true` requires a real `undo`.
- [ ] No capability record contains secret material — only a `credentialRef`.
- [ ] `scope.resourcePattern` is specific enough to catch a capability handed the wrong resource.
- [ ] `trust.inputTrust` and `trust.resultTrust` are classified, and any content originating outside the organisation is `untrusted-content`.
- [ ] `health.degradedBehaviour` is set for every capability, and a `degrade` names its reduced mode.
- [ ] The server does not run inside an agent's execution environment; it runs control-plane or broker-side.
- [ ] The credential's scopes are no broader than the capability's required scopes.
- [ ] E2+ capabilities have an enumerated runbook or an approval gate declared in the consuming workflow.
- [ ] `discovery.mode` is `registered-static` unless a probe exists; the reconciliation record is retained.
- [ ] The transport's output is schema-validated, or the capability is explicitly marked `structured: false` with a rationale.

---

## Related

- `11_TOOLS_MCP_AND_INTEGRATIONS.md` §2 — the capability record and the effect classes E0–E4
- `11_TOOLS_MCP_AND_INTEGRATIONS.md` §3 — MCP's role, trust levels, the reconciliation rule, and the adapter contract
- `11_TOOLS_MCP_AND_INTEGRATIONS.md` §4 — the scope vocabulary and the three-scope rule
- `11_TOOLS_MCP_AND_INTEGRATIONS.md` §7 — credential rules; "a secret is not context"
- `11_TOOLS_MCP_AND_INTEGRATIONS.md` §10 — the workflow environment declaration
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` §7 — security controls by category, including supply chain
- `templates/WORKFLOW.md` — declaring a workflow's capability grants
