# Ticket template — one ticket, one agent run

<!--
  Copied from pack 05's ticket format. A ticket is a CONTRACT: the `Read` line bounds
  the agent's context, the `Build` line bounds its writes, and the `Oracle` line says
  what proves the work is correct. An agent that must guess any of those will escalate
  instead of guessing — that is the intended behaviour, not a failure of the ticket.
-->

## `T-x.yy` — <title>

| Field | Value |
|---|---|
| **Size** | S \| M \| L |
| **Blast radius** | R0 \| R1 \| R2 \| R3 \| R4 |
| **Depends on** | `T-a.bb`, `T-c.dd` (or `—`) |
| **Blocked by** | `T-a.bb` (or `—`) |
| **Profile** | TypeScript \| Python \| Go \| .NET \| Java \| Rust |

**Goal.** One sentence. What is true when this ticket is done that is not true now?

**Read.** The exact files and sections the agent may load. Anything not listed here is
out of context; if the agent needs more, it proposes a ticket.

- `docs/pack/0N_FILE.md §M`
- `packages/<name>/src/**`

**Build.** The exact paths the agent may create or modify. Must be a subset of the PR's
`Allowed-paths`; the scope-guard enforces it.

- `packages/<name>/src/**`
- `tests/unit/<file>.test.ts`

**Oracle.** The files that prove the work. These are READ-ONLY to the agent (HR-2).
If they do not exist when the run starts, the agent stops (HR-3). The owner records the
sha in the PR as `Oracle-Sha`.

- `tests/invariants/INV-N.test.ts`

**Verify.** Evidence the owner checks. Commands, with the ids that select a single test.

- `pnpm test:invariants -t "INV-N"`
- `pnpm run ci`

**Not done here.** What this ticket deliberately leaves out, and which ticket owns it.

**Escalate if.** The conditions that mean the agent must stop and write `ESCALATION.md`
rather than proceed. Use the categories in `AGENTS.md` §6.

**Notes.** Facts the owner knows and the agent cannot look up. External systems, rate
limits, credentials location (never the credential itself), and anything marked
`[VERIFY]` with the source recorded.
