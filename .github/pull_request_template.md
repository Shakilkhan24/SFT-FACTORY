# Pull request — <one-line summary>

<!--
  The `Allowed-paths:` section is parsed by `tools/scope-guard` (see the AGENTS.md HR-5
  rule and pack 07 §3). The scope-guard FAILS when the section is absent, when it is
  empty, and when any changed path falls outside the listed globs. A glob that matches
  nothing is reported as a possible typo.

  Rules:
  - One glob per line, relative to the repository root.
  - `*` matches within one path segment; `**` matches across segments.
  - The list ends at the first line that is not a glob and not blank.
  - Only two scopes are never a scope: one `Allowed-paths:` section per PR.
-->

## Ticket

`T-x.yy` — <ticket title>

## Allowed-paths:

- `packages/<name>/**`

## Oracle-Sha

`<sha256 of the oracle files this ticket names>`

## What I did

<!-- ≤8 lines. Restate the ticket, not a changelog of files. -->

## What I did NOT do

<!-- Explicitly out of scope, deferred, or knowingly incomplete. A PR that hides its gaps
     is worse than a PR that fails. -->

## Evidence

<!-- Commands run and their output. Include the oracle test id and the result. -->

```
$ pnpm run ci
...
```

## Risks

<!-- What could break. What a reviewer should look at hardest. -->

## Review tier

<!-- R0 | R1 | R2 | R3 | R4 — see the blast-radius model in the blueprint.
     R4 paths require the owner's review and must not be changed by an agent run
     without the owner naming them on the ticket's Build line. -->
