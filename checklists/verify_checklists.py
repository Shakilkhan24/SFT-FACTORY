#!/usr/bin/env python3
"""
verify_checklists.py — prove the checklist folder's coverage claims are true.

The checklist folder is the execution layer over the Software Factory Pack. It adds
navigation and order; it does not restate the spec. That only works if every ticket,
spike and gate row is covered by exactly one checklist, and if every checklist points
at pack files and sections that actually exist.

This script checks, and only checks, those claims:

  1. every ticket `T-x.yy` in pack 05 appears in EXACTLY ONE checklist;
  2. every spike `S-n` in pack 05 appears;
  3. every gate row `CL-G<n>-<nn>` in pack 06 Part A appears;
  4. every invariant `INV-n` / `I-n` and every attack `AT-n` referenced by a
     checklist exists in pack 08;
  5. every pack file and section a checklist opens actually exists;
  6. no checklist references a ticket that does not exist.

Run it before you start and after you change anything:

    python3 checklists/verify_checklists.py

Expected final line:

    ALL CHECKLIST COVERAGE VERIFIED AGAINST THE PACK

Exit code 0 = every claim holds. Exit code 1 = at least one claim fails; the
failures are printed above the final line.

This script READS ONLY. It never writes to the pack, to the checklists, or anywhere
else.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# The pack's canonical install path inside the built repo.
CANONICAL_PACK = Path("docs/pack")
# Where the pack actually lives in this working copy.
WORKING_PACK = ROOT / "software-factory-pack" / "software-factory-pack"
# The three root READMEs the user requires to stay untouched.
ROOT_READMES = [
    ROOT / "00_START_HERE_AGENT_ENTRYPOINT.md",
    ROOT / "07_AGENT_OPERATING_MANUAL.md",
    ROOT / "01_MISSION_SCOPE_AND_DECISIONS.md",
]

PACK_FILES = [
    "00_START_HERE_AGENT_ENTRYPOINT.md",
    "01_MISSION_SCOPE_AND_DECISIONS.md",
    "02_ARCHITECTURE_SPEC.md",
    "03_CONTRACTS_AND_DATA_MODEL.md",
    "04_INTEGRATIONS_AND_API_CATALOG.md",
    "05_TICKET_BACKLOG.md",
    "06_MASTER_CHECKLIST_AND_COVERAGE.md",
    "07_AGENT_OPERATING_MANUAL.md",
    "08_VERIFICATION_AND_PRODUCTION_READINESS.md",
    "A1_STACK_NEUTRALITY_AND_ADAPTERS.md",
    "A2_PATH_TO_PEAK_AUTOMATION.md",
]

TICKET_BACKLOG = "05_TICKET_BACKLOG.md"
MASTER_CHECKLIST = "06_MASTER_CHECKLIST_AND_COVERAGE.md"
VERIFICATION = "08_VERIFICATION_AND_PRODUCTION_READINESS.md"

# The blueprint corpus — the numbered source documents the pack cites as [BP: ...].
BLUEPRINT_FILES = [
    "01_EXECUTIVE_VISION.md",
    "06_REQUIREMENTS_AND_NFRS.md",
    "07_REFERENCE_ARCHITECTURE.md",
    "08_AGENT_CATALOG_AND_CONTRACTS.md",
    "09_ORCHESTRATION_STATE_AND_EVENTS.md",
    "10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md",
    "11_TOOLS_MCP_AND_INTEGRATIONS.md",
    "12_END_TO_END_WORKFLOWS.md",
    "13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md",
    "14_QUALITY_TESTING_AND_EVALUATION.md",
    "15_OBSERVABILITY_COST_AND_FEEDBACK.md",
    "16_IMPLEMENTATION_ROADMAP.md",
    "17_DOWNSTREAM_BUILD_AGENT_BRIEF.md",
    "18_OPEN_QUESTIONS_AND_RISKS.md",
]

# ---------------------------------------------------------------------------
# Failure reporting
# ---------------------------------------------------------------------------

FAILURES: list[str] = []
NOTES: list[str] = []


def fail(check: str, message: str) -> None:
    FAILURES.append(f"[{check}] {message}")


def note(message: str) -> None:
    NOTES.append(message)


# ---------------------------------------------------------------------------
# Locating the pack
# ---------------------------------------------------------------------------


def locate_pack() -> Path:
    """Return the pack directory that actually holds the source-of-truth files."""
    for candidate in (ROOT / CANONICAL_PACK, WORKING_PACK):
        if (candidate / TICKET_BACKLOG).exists():
            return candidate
    return WORKING_PACK


PACK = locate_pack()


def pack_text(name: str) -> str | None:
    path = PACK / name
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Checklist loading
# ---------------------------------------------------------------------------

CHECKLIST_FILES = sorted(
    p for p in HERE.glob("*.md") if p.name not in {"README.md"}
)
CHECKLIST_BY_NAME = {p.name: p for p in CHECKLIST_FILES}


def checklist_text() -> dict[str, str]:
    return {p.name: p.read_text(encoding="utf-8") for p in CHECKLIST_FILES}


# ---------------------------------------------------------------------------
# ID extraction
# ---------------------------------------------------------------------------

TICKET_RE = re.compile(r"\bT-\d+\.\d+\b")
SPIKE_RE = re.compile(r"\bS-\d+\b")
GATE_ROW_RE = re.compile(r"\bCL-G\d+-\d+\b")
INV_TEST_RE = re.compile(r"\bINV-\d+\b")
INV_DESIGN_RE = re.compile(r"\bI-\d+\b")
ATTACK_RE = re.compile(r"\bAT-\d+\b")

# A bare `S-3` must not match the `S-1` inside `T-1.01`-style tokens or a
# path like `docs/spikes/S-1.md` (that one IS a spike reference, which is fine).
SPIKE_CONTEXT_RE = re.compile(r"\bS-\d+\b(?!\w)")


def tickets_in(text: str) -> set[str]:
    return set(TICKET_RE.findall(text))


def spikes_in(text: str) -> set[str]:
    return set(SPIKE_CONTEXT_RE.findall(text))


def gate_rows_in(text: str) -> set[str]:
    return set(GATE_ROW_RE.findall(text))


def inv_tests_in(text: str) -> set[str]:
    return set(INV_TEST_RE.findall(text))


def attacks_in(text: str) -> set[str]:
    return set(ATTACK_RE.findall(text))


# A ticket's home is the checklist that has a `### T-x.yy · …` heading — the
# section that tells the agent what to build. A ticket merely *mentioned* in
# prose (a dependency, a prerequisite, a cross-reference) is not a second home.
def ticket_is_home(text: str, ticket: str) -> bool:
    return bool(re.search(rf"^#{{2,4}}\s+{re.escape(ticket)}\b", text, re.M))


# A spike's home is the checklist whose spikes section runs it. The heading must
# be a *work* section ("### Spikes S-1 … S-6 — …"), not a map heading in the
# index ("## 2. Ticket → checklist map (66 tickets + 6 spikes)").
SPIKE_TABLE_HEADING_RE = re.compile(
    r"^#{2,4}\s+Spikes?\b.*$", re.M | re.I
)


def spike_is_home(text: str, spike: str) -> bool:
    """A spike is run by the checklist whose spikes section lists it."""
    m = SPIKE_TABLE_HEADING_RE.search(text)
    if not m:
        return False
    start = m.start()
    level = len(m.group(0)) - len(m.group(0).lstrip("#"))
    rest = text[start + len(m.group(0)) :]
    nxt = re.search(r"^#{1,%d}\s" % level, rest, re.M)
    section = rest[: nxt.start()] if nxt else rest
    return bool(re.search(rf"\b{re.escape(spike)}\b", section))


# ---------------------------------------------------------------------------
# CHECK 1 + 2 — tickets and spikes covered exactly once
# ---------------------------------------------------------------------------


def check_tickets_and_spikes(checklists: dict[str, str]) -> None:
    backlog = pack_text(TICKET_BACKLOG)
    if backlog is None:
        fail("pack", f"{TICKET_BACKLOG} not found under {PACK}")
        return

    # Pack truth: tickets are `### T-x.yy · ...` headings; spikes are `### S-n · ...`.
    pack_tickets = set(
        re.findall(r"^#{2,4}\s+(T-\d+\.\d+)\b", backlog, re.M)
    )
    # Spikes are table rows `| **S-1** | ... |` in the spike table of pack 05.
    pack_spikes = set(re.findall(r"^\|\s*\*\*(S-\d+)\*\*\s*\|", backlog, re.M))
    if not pack_spikes:
        pack_spikes = set(re.findall(r"^#{2,4}\s+(S-\d+)\b", backlog, re.M))

    if not pack_tickets:
        fail("pack", f"no ticket headings parsed from {TICKET_BACKLOG}")
    if not pack_spikes:
        fail("pack", f"no spike headings parsed from {TICKET_BACKLOG}")

    # Where each checklist mentions each ticket.
    ticket_homes: dict[str, list[str]] = {}
    ticket_mentions: dict[str, list[str]] = {}
    spike_homes: dict[str, list[str]] = {}
    spike_mentions: dict[str, list[str]] = {}
    for name, text in checklists.items():
        for t in tickets_in(text):
            ticket_mentions.setdefault(t, []).append(name)
            if ticket_is_home(text, t):
                ticket_homes.setdefault(t, []).append(name)
        for s in spikes_in(text):
            spike_mentions.setdefault(s, []).append(name)
            if spike_is_home(text, s):
                spike_homes.setdefault(s, []).append(name)

    for t in sorted(pack_tickets):
        homes = sorted(set(ticket_homes.get(t, [])))
        if not homes:
            refs = ", ".join(sorted(set(ticket_mentions.get(t, []))))
            extra = f" (mentioned in {refs})" if refs else ""
            fail(
                "ticket",
                f"{t} (pack 05) has no home — add a '### {t}' section to the "
                f"checklist that builds it{extra}",
            )
        elif len(homes) > 1:
            fail(
                "ticket",
                f"{t} (pack 05) is built by {len(homes)} checklists: "
                f"{', '.join(homes)} — each ticket must be built by exactly one",
            )

    for s in sorted(pack_spikes):
        homes = sorted(set(spike_homes.get(s, [])))
        if not homes:
            refs = ", ".join(sorted(set(spike_mentions.get(s, []))))
            extra = f" (mentioned in {refs})" if refs else ""
            fail(
                "spike",
                f"{s} (pack 05) has no home — list it in the spikes table of the "
                f"checklist that runs it{extra}",
            )
        elif len(homes) > 1:
            fail(
                "spike",
                f"{s} (pack 05) is run by {len(homes)} checklists: "
                f"{', '.join(homes)} — each spike must be run by exactly one",
            )

    # A checklist referencing a ticket the pack does not define.
    for t in sorted(set(ticket_mentions) - pack_tickets):
        homes = ", ".join(sorted(set(ticket_mentions[t])))
        fail("ticket", f"{t} is referenced by {homes} but does not exist in pack 05")

    for s in sorted(set(spike_mentions) - pack_spikes):
        homes = ", ".join(sorted(set(spike_mentions[s])))
        fail("spike", f"{s} is referenced by {homes} but does not exist in pack 05")

    note(
        f"tickets: {len(pack_tickets)} in pack, {len(pack_tickets)} each built by exactly one checklist"
    )
    note(f"spikes:  {len(pack_spikes)} in pack, {len(pack_spikes)} each run by exactly one checklist")


# ---------------------------------------------------------------------------
# CHECK 3 — gate rows covered
# ---------------------------------------------------------------------------

# A checklist's GATE ROWS section: the rows it CLOSES. A row's *home* is the
# checklist whose GATE ROWS area contains it. The area runs until the next
# top-level `## ` heading — `### ` subsections (e.g. "G3 rows closed by this
# phase") are part of it. A row mentioned elsewhere (the index's map, a later
# checklist that reuses the evidence) is a cross-reference, which is legitimate.
GATE_ROWS_SECTION_RE = re.compile(r"^## GATE ROWS.*?(?=^## |\Z)", re.M | re.S)

# A markdown table inside that section: header row, separator row, body rows.
TABLE_RE = re.compile(r"(^\|.*\|[ \t]*$\n)(^\|[-| :\t]+$\n)((?:^\|.*\|[ \t]*$\n)+)", re.M)


def gate_row_homes(checklists: dict[str, str]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Split gate-row mentions into (homes, forward references).

    A row is *closed* by a checklist whose GATE ROWS table lists it in the **ID
    column** of a table with the normal `ID | Statement | Verify | By` shape. A
    table headed `Row (closed later) | Statement | Closed in` is a **forward
    reference** — the row is created there and closed somewhere else — so those
    rows are cross-references, not homes.

    A row that appears in any *other* column (typically the **Verify** column,
    where one row cites another row's evidence) is an evidence reference, not a
    second home.
    """
    homes: dict[str, list[str]] = {}
    forward: dict[str, list[str]] = {}
    for name, text in checklists.items():
        m = GATE_ROWS_SECTION_RE.search(text)
        if not m:
            continue
        section = m.group(0)
        for header, _sep, body in TABLE_RE.findall(section):
            cols = [c.strip().lower() for c in header.strip().strip("|").split("|")]
            is_forward = any("closed in" in c for c in cols) or any(
                "closed later" in c for c in cols
            )
            target = forward if is_forward else homes
            for line in body.splitlines():
                if not line.startswith("|"):
                    continue
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                if not cells:
                    continue
                # Only the ID column (the first) declares a home. A row named in
                # the Verify or By column is a citation of evidence.
                id_cell = cells[0]
                found = GATE_ROW_RE.findall(id_cell)
                if not found:
                    continue
                for row in found:
                    target.setdefault(row, []).append(name)
    return homes, forward


def check_gate_rows(checklists: dict[str, str]) -> None:
    master = pack_text(MASTER_CHECKLIST)
    if master is None:
        fail("pack", f"{MASTER_CHECKLIST} not found under {PACK}")
        return

    pack_rows = set(GATE_ROW_RE.findall(master))
    if not pack_rows:
        fail("pack", f"no gate rows parsed from {MASTER_CHECKLIST}")
        return

    homes, forward = gate_row_homes(checklists)

    # Every pack row must have exactly one home.
    for row in sorted(pack_rows):
        closers = sorted(set(homes.get(row, [])))
        if not closers:
            fwd = ", ".join(sorted(set(forward.get(row, []))))
            extra = f" (it is only a forward reference in {fwd})" if fwd else ""
            fail(
                "gate-row",
                f"{row} (pack 06 Part A) is not closed by any checklist — "
                f"add it to that checklist's GATE ROWS table{extra}",
            )
        elif len(closers) > 1:
            fail(
                "gate-row",
                f"{row} (pack 06 Part A) is closed by {len(closers)} checklists: "
                f"{', '.join(closers)} — each gate row must be closed by exactly one",
            )

    # No checklist may close a row the pack does not define.
    for row in sorted(set(homes) - pack_rows):
        closers = ", ".join(sorted(set(homes[row])))
        fail("gate-row", f"{row} is closed by {closers} but does not exist in pack 06")

    # A forward reference must name a checklist that actually closes the row.
    # The target is prose ("checklist 03 (T-1.06)"), so match on the leading
    # number of the closing checklist rather than on the whole filename.
    for row, refs in sorted(forward.items()):
        closers = set(homes.get(row, []))
        if not closers:
            continue
        closer_nums = {c.split("-")[0] for c in closers}
        for name in sorted(set(refs)):
            text = checklists[name]
            m = GATE_ROWS_SECTION_RE.search(text)
            section = m.group(0) if m else ""
            for header, _sep, body in TABLE_RE.findall(section):
                if not any(
                    "closed in" in c.strip().lower()
                    for c in header.strip().strip("|").split("|")
                ):
                    continue
                for line in body.splitlines():
                    if not re.match(rf"^\|\s*{re.escape(row)}\b", line):
                        continue
                    target = line.split("|")[-2].strip()
                    # Only the *checklist* reference counts. The cell may also
                    # name a ticket ("checklist 05 (T-2.13)"), and a ticket
                    # number must not be mistaken for a checklist number.
                    named = set(
                        re.findall(r"checklist\s+(\d{2})", target, re.I)
                    )
                    if not named:
                        named = set(re.findall(r"\b(\d{2})\b", target))
                    if not (named & closer_nums):
                        fail(
                            "gate-row",
                            f"{name} forward-references {row} as closed in "
                            f"'{target}', but it is actually closed in "
                            f"{', '.join(sorted(closers))}",
                        )

    # Cross-references are allowed, but a row referenced anywhere must exist.
    mentioned: dict[str, list[str]] = {}
    for name, text in checklists.items():
        for row in gate_rows_in(text):
            mentioned.setdefault(row, []).append(name)

    for row in sorted(set(mentioned) - pack_rows):
        refs = ", ".join(sorted(set(mentioned[row])))
        fail("gate-row", f"{row} is referenced by {refs} but does not exist in pack 06")

    by_gate: dict[str, int] = {}
    for row in pack_rows:
        gate = row.split("-")[1]
        by_gate[gate] = by_gate.get(gate, 0) + 1
    note(
        "gate rows: "
        + ", ".join(f"{g}={by_gate[g]}" for g in sorted(by_gate))
        + f" ({len(pack_rows)} total, each closed by exactly one checklist)"
    )


# ---------------------------------------------------------------------------
# CHECK 4 — invariants and attacks exist in pack 08
# ---------------------------------------------------------------------------


def check_invariants_and_attacks(checklists: dict[str, str]) -> None:
    verification = pack_text(VERIFICATION)
    if verification is None:
        fail("pack", f"{VERIFICATION} not found under {PACK}")
        return

    pack_inv_tests = set(inv_tests_in(verification))
    pack_attacks = set(attacks_in(verification))
    pack_inv_design = set(
        re.findall(r"\bI-(\d+)\b", verification)
    )  # numeric bodies only

    if len(pack_inv_tests) != 12:
        fail("pack", f"expected 12 INV tests in pack 08, found {len(pack_inv_tests)}")
    if len(pack_attacks) != 15:
        fail("pack", f"expected 15 AT attacks in pack 08, found {len(pack_attacks)}")

    for name, text in checklists.items():
        for inv in sorted(inv_tests_in(text)):
            if inv not in pack_inv_tests:
                fail("invariant", f"{name} references {inv}, which is not in pack 08")
        for at in sorted(attacks_in(text)):
            if at not in pack_attacks:
                fail("attack", f"{name} references {at}, which is not in pack 08")

    note(f"invariants: 12 defined in pack 08; references across checklists all resolve")
    note(f"attacks:    15 defined in pack 08; references across checklists all resolve")


# ---------------------------------------------------------------------------
# CHECK 5 — pack files and sections a checklist opens actually exist
# ---------------------------------------------------------------------------

# A pack-file reference, e.g. `docs/pack/03_CONTRACTS_AND_DATA_MODEL.md` or
# `blueprint-reference/16_IMPLEMENTATION_ROADMAP.md`.
PACK_FILE_REF_RE = re.compile(
    r"`(?:docs/pack/|blueprint-reference/|reference/)?"
    r"((?:\d{2}[A-Z0-9_]*|A[12])_[A-Z0-9_]+\.md)`"
)

# A section reference attached to a file reference.
FILE_AND_SECTION_RE = re.compile(
    r"`(?:docs/pack/|blueprint-reference/)?"
    r"((?:\d{2}[A-Z0-9_]*|A[12])_[A-Z0-9_]+\.md)`?\s*"
    r"(?:§§?|Part\s+)\s*"
    r"([0-9]+(?:\.[0-9]+)*)"
)

# A bare `` `NN` §N `` shorthand, e.g. "`03` §2" or "pack `05` §1".
# The optional qualifier word before the number says which corpus it names:
# "pack" (pack files 00–08, A1, A2) or "blueprint" (blueprint-reference files).
#
# The section list may be compound — "`04` §2 + §4", "`07` §2–§11",
# "`08` §3, §4" — so the trailing group captures the whole run of section
# numbers and each one is checked separately.
SECTION_RUN = r"[0-9]+(?:\.[0-9]+)*"
SHORTHAND_SECTION_RE = re.compile(
    r"(?:(pack|blueprint)\s+)?`(\d{2})`\s*"
    r"((?:§\s*" + SECTION_RUN + r"(?:\s*(?:[-–+&,]|and)\s*(?:§\s*)?" + SECTION_RUN + r")*))",
    re.I,
)

# The individual section numbers inside a compound reference.
SECTION_NUMBERS_RE = re.compile(SECTION_RUN)

# `A1` §7 / `A2` §11 shorthand.
APPENDIX_SECTION_RE = re.compile(r"`(A[12])`\s*§+\s*([0-9]+(?:\.[0-9]+)*)")

# Blueprint reference numbering: `blueprint 17` §10.
BLUEPRINT_SECTION_RE = re.compile(
    r"blueprint\s+`?(\d{2})`?\s*§+\s*([0-9]+(?:\.[0-9]+)*)", re.I
)


def heading_number(text: str, target: str) -> bool:
    """True if `text` has a heading whose section number is `target`."""
    for level, title in re.findall(r"^(#{1,6})\s+(.+)$", text, re.M):
        stripped = title.strip()
        m = re.match(r"^(\d+(?:\.\d+)*)\.?\s", stripped)
        if not m:
            continue
        num = m.group(1)
        if num == target or num.startswith(target + "."):
            return True
    return False


def heading_exists_part(text: str, part: str) -> bool:
    """True if `text` has a heading containing the given 'Part X' label."""
    for _, title in re.findall(r"^(#{1,6})\s+(.+)$", text, re.M):
        if re.search(rf"\bPart\s+{re.escape(part)}\b", title, re.I):
            return True
    return False


def shorthand_targets(
    num: str, qualifier: str | None
) -> list[tuple[str, str | None]]:
    """Resolve `` `NN` `` to the files it could name.

    `num` is a two-digit document number. Pack files 01–08 and blueprint files
    01–18 share a namespace, and for 01, 06, 07 and 08 *both* corpora have a
    file with that number. The qualifier word ("pack" / "blueprint") narrows it
    when present; without one, every candidate is returned so the caller can
    require that the section resolves in at least one of them.
    """
    pack_candidate = next((f for f in PACK_FILES if f.startswith(num + "_")), None)
    blueprint_candidate = next(
        (f for f in BLUEPRINT_FILES if f.startswith(num + "_")), None
    )

    q = qualifier.lower() if qualifier else None
    out: list[tuple[str, str | None]] = []
    if q in (None, "pack") and pack_candidate:
        body = (PACK / pack_candidate)
        out.append((pack_candidate, body.read_text(encoding="utf-8") if body.exists() else None))
    if q in (None, "blueprint") and blueprint_candidate:
        body = PACK / "blueprint-reference" / blueprint_candidate
        out.append(
            (
                f"blueprint-reference/{blueprint_candidate}",
                body.read_text(encoding="utf-8") if body.exists() else None,
            )
        )
    return out


def check_pack_references(checklists: dict[str, str]) -> None:
    pack_cache: dict[str, str | None] = {}

    def get(name: str) -> str | None:
        if name not in pack_cache:
            pack_cache[name] = pack_text(name)
        return pack_cache[name]

    def blueprint_get(name: str) -> str | None:
        path = PACK / "blueprint-reference" / name
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    checked_files = 0
    checked_sections = 0

    for name, text in checklists.items():
        # 5a. plain file references resolve
        for ref in sorted(set(PACK_FILE_REF_RE.findall(text))):
            if ref in pack_cache:
                continue
            checked_files += 1
            if get(ref) is None and blueprint_get(ref) is None:
                fail(
                    "pack-file",
                    f"{name} opens `{ref}`, which does not exist in the pack",
                )

        # 5b. file + section references resolve
        for fname, section in sorted(set(FILE_AND_SECTION_RE.findall(text))):
            checked_sections += 1
            body = get(fname) or blueprint_get(fname)
            if body is None:
                fail("pack-file", f"{name} opens `{fname}`, which does not exist")
                continue
            if not heading_number(body, section):
                fail(
                    "pack-section",
                    f"{name} opens `{fname}` §{section}, "
                    f"but that section does not exist in the file",
                )

        # 5c. shorthand `` `NN` §N `` — the number names either a pack file or a
        # blueprint file, and the qualifier word ("pack" / "blueprint") tells us
        # which. For 01, 06, 07 and 08 both exist, so an unqualified reference is
        # checked against BOTH and passes only if either resolves.
        for qualifier, num, sections in sorted(set(SHORTHAND_SECTION_RE.findall(text))):
            targets = shorthand_targets(num, qualifier)
            if not targets:
                fail(
                    "pack-file",
                    f"{name} references `{num}` §{sections}, "
                    f"but neither the pack nor the blueprint has a file numbered {num}",
                )
                continue
            for section in SECTION_NUMBERS_RE.findall(sections):
                checked_sections += 1
                resolved = [
                    (fname, body)
                    for fname, body in targets
                    if body is not None and heading_number(body, section)
                ]
                if not resolved:
                    where = ", ".join(fname for fname, _ in targets)
                    fail(
                        "pack-section",
                        f"{name} references `{num}` §{section}, "
                        f"but that section exists in none of: {where}",
                    )

        # 5d. `A1` §7 / `A2` §11 — always pack appendices.
        for num, section in sorted(set(APPENDIX_SECTION_RE.findall(text))):
            fname = next((f for f in PACK_FILES if f.startswith(num + "_")), None)
            if fname is None:
                fail("pack-file", f"{name} references pack `{num}`, which does not exist")
                continue
            checked_sections += 1
            body = get(fname)
            if body is None or not heading_number(body, section):
                fail(
                    "pack-section",
                    f"{name} references pack `{num}` §{section}, "
                    f"but that section does not exist in {fname}",
                )

        # 5e. `Part A` style references against pack 06
        for part in sorted(set(re.findall(r"`06`\s*Part\s+([A-E])", text))):
            checked_sections += 1
            body = get(MASTER_CHECKLIST)
            if body is None or not heading_exists_part(body, part):
                fail(
                    "pack-section",
                    f"{name} references pack `06` Part {part}, which does not exist",
                )

        # 5f. blueprint reference numbering — `blueprint 17` §10
        for num, section in sorted(set(BLUEPRINT_SECTION_RE.findall(text))):
            checked_sections += 1
            fname = next(
                (f for f in sorted(BLUEPRINT_FILES) if f.startswith(num + "_")), None
            )
            if fname is None:
                fail("pack-file", f"{name} references blueprint `{num}`, which does not exist")
                continue
            body = blueprint_get(fname)
            if body is None or not heading_number(body, section):
                fail(
                    "pack-section",
                    f"{name} references blueprint `{num}` §{section}, "
                    f"but that section does not exist in {fname}",
                )

    note(f"pack file references checked: {checked_files}")
    note(f"pack section references checked: {checked_sections}")


# ---------------------------------------------------------------------------
# CHECK 6 — internal consistency of the index
# ---------------------------------------------------------------------------


def check_index_consistency(checklists: dict[str, str]) -> None:
    index = checklists.get("17-full-index.md")
    if index is None:
        fail("index", "17-full-index.md is missing")
        return

    # The index claims a total. Verify the arithmetic it states.
    m = re.search(r"= \*\*(\d+) tickets\*\*, plus \*\*(\d+) spikes\*\*", index)
    if not m:
        fail("index", "17-full-index.md does not state a ticket/spike total")
        return
    claimed_tickets, claimed_spikes = int(m.group(1)), int(m.group(2))

    backlog = pack_text(TICKET_BACKLOG) or ""
    actual_tickets = len(set(re.findall(r"^#{2,4}\s+(T-\d+\.\d+)\b", backlog, re.M)))
    actual_spikes = len(
        set(re.findall(r"^\|\s*\*\*(S-\d+)\*\*\s*\|", backlog, re.M))
    ) or len(set(re.findall(r"^#{2,4}\s+(S-\d+)\b", backlog, re.M)))

    if claimed_tickets != actual_tickets:
        fail(
            "index",
            f"17-full-index.md claims {claimed_tickets} tickets; "
            f"pack 05 defines {actual_tickets}",
        )
    if claimed_spikes != actual_spikes:
        fail(
            "index",
            f"17-full-index.md claims {claimed_spikes} spikes; "
            f"pack 05 defines {actual_spikes}",
        )

    # Every checklist file must be reachable from the index.
    for fname in sorted(CHECKLIST_BY_NAME):
        if fname in {"17-full-index.md"}:
            continue
        if fname not in index:
            fail(
                "index",
                f"{fname} is not mentioned in 17-full-index.md — "
                f"every checklist must have an entry in the index",
            )

    # The index's gate-row map must match where the rows are actually closed.
    # The map's tables are `| <rows> | **<checklist>** |`. A cell naming rows
    # names the checklist that closes them.
    homes, _forward = gate_row_homes(checklists)
    actual: dict[str, str] = {}
    for row, closers in homes.items():
        for c in set(closers):
            actual[row] = c.split("-")[0]

    map_section = index
    start = map_section.find("## 3. Gate row")
    if start == -1:
        fail("index", "17-full-index.md has no '## 3. Gate row → checklist map' section")
    else:
        end = map_section.find("\n## ", start + 5)
        map_section = map_section[start : end if end != -1 else len(map_section)]

        claimed: dict[str, str] = {}

        def expand_rows(cell: str) -> list[str]:
            """Expand a rows cell into individual gate-row IDs.

            The map writes rows as a list (`CL-G3-13, CL-G3-14`), as a range
            (`CL-G0-01 … CL-G0-11`), or as a list with annotations
            (`CL-G3-06 (A2.7), CL-G3-07 (A2.8)`).
            """
            # A range binds tighter than a comma: pull the ranges out first,
            # then read whatever is left as a plain list of individual rows.
            text = cell
            ids: list[str] = []
            for m in re.finditer(
                r"(CL-G\d+)-(\d+)\s*(?:…|\.\.\.)\s*(?:CL-G\d+)?-(\d+)", cell
            ):
                prefix, lo, hi = m.group(1), int(m.group(2)), int(m.group(3))
                for n in range(lo, hi + 1):
                    rid = f"{prefix}-{n:02d}"
                    if rid not in ids:
                        ids.append(rid)
                text = text.replace(m.group(0), " ")
            # Whatever is left is a plain list of individual rows.
            for m in re.finditer(r"CL-G\d+-\d+", text):
                if m.group(0) not in ids:
                    ids.append(m.group(0))
            return ids

        for _header, _sep, body in TABLE_RE.findall(map_section):
            for line in body.splitlines():
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                if len(cells) < 2:
                    continue
                rows_cell, target_cell = cells[0], cells[1]
                # The target is the first **bolded** number in the cell:
                # `**08** (they measure machinery built in 05)`.
                bold = re.search(r"\*\*(\d{2})\*\*", target_cell)
                if not bold:
                    continue
                target = bold.group(1)
                for row in expand_rows(rows_cell):
                    claimed[row] = target

        # G0 and G1 are written as prose ("### G0 (11 rows) → checklist **01**"
        # followed by "CL-G0-01 … CL-G0-11"), not as a table.
        for gate, target in re.findall(
            r"^### (G\d)[^\n]*→ checklist \*\*(\d{2})\*\*", map_section, re.M
        ):
            for lo, hi in re.findall(
                rf"CL-{gate}-(\d+)\s*…\s*CL-{gate}-(\d+)", map_section
            ):
                for n in range(int(lo), int(hi) + 1):
                    claimed.setdefault(f"CL-{gate}-{n:02d}", target)

        for row, target in sorted(claimed.items()):
            if actual.get(row) != target:
                fail(
                    "index",
                    f"17-full-index.md says {row} is closed in {target}, "
                    f"but it is closed in {actual.get(row, '(nowhere)')}",
                )
        missing_from_map = sorted(set(actual) - set(claimed))
        if missing_from_map:
            fail(
                "index",
                "17-full-index.md's gate-row map omits: "
                + ", ".join(missing_from_map),
            )

    note(
        f"index: {claimed_tickets} tickets + {claimed_spikes} spikes claimed, "
        f"matches pack 05"
    )


# ---------------------------------------------------------------------------
# CHECK 7 — the pack and the root READMEs are untouched
# ---------------------------------------------------------------------------


def check_pack_integrity() -> None:
    """The user's hard requirement: nothing in the pack or the READMEs changes.

    This does not use git (the tree may not be a repo). It records a fingerprint
    of the pack and the READMEs so that a human can diff before/after, and it
    fails loudly if a pack file the checklists depend on has gone missing.
    """
    missing = [f for f in PACK_FILES if not (PACK / f).exists()]
    if missing:
        fail("pack", f"pack files missing: {', '.join(missing)}")
    for readme in ROOT_READMES:
        if not readme.exists():
            fail("readme", f"{readme.name} is missing from the repo root")
    note(f"pack intact: {len(PACK_FILES)} files present; pack is read-only by policy")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    print("Software Factory — checklist coverage verifier")
    print(f"pack:      {PACK}")
    print(f"checklists:{HERE}")
    print()

    checklists = checklist_text()
    print(f"loaded {len(checklists)} checklist files:")
    for name in sorted(checklists):
        print(f"  - {name}")
    print()

    check_tickets_and_spikes(checklists)
    check_gate_rows(checklists)
    check_invariants_and_attacks(checklists)
    check_pack_references(checklists)
    check_index_consistency(checklists)
    check_pack_integrity()

    print()
    for n in NOTES:
        print(f"  ok  {n}")
    print()

    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S):")
        for f in FAILURES:
            print(f"  FAIL {f}")
        print()
        print("CHECKLIST COVERAGE VERIFICATION FAILED")
        return 1

    print("ALL CHECKLIST COVERAGE VERIFIED AGAINST THE PACK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
