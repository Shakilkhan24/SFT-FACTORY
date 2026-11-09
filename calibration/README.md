# Calibration corpus — mining status

**Tool:** `tools/mining` → `calibration/candidates.jsonl` (JSONL, one candidate per line)
**Requirement:** CL-G0-08 — *≥10 fix commits, or shortfall documented*

## Status: SHORTFALL — the target repo is not yet chosen

`tools/mining` reads **git history only** and finds commits that **fix a bug AND touch tests**.
Each such commit is a `(preFixSha → fixSha)` pair: the pre-fix tree is the real violation, the
fix's test is a real oracle for it. That pairing is what makes a detector calibratable
(blueprint `14` §5.6, "Historical mining").

The corpus is mined from the **target repository** (owner decision **D1**), not from the factory
repository. The factory repo was created for this plan and has no pre-factory history to mine.

```
$ node tools/mining --repo . --out calibration/candidates.jsonl --days 3650 --min 10
mining: calibration candidates
  out:            calibration/candidates.jsonl
  commits seen:   1
  candidates:     0
SHORTFALL  mined 0 candidates, below the required 10. The corpus is not usable yet — mine a
longer window (--days) or more history. Do NOT pad the corpus with synthetic samples to reach
the count; a synthetic sample does not calibrate against real context.
```

## What unblocks it

1. **Answer D1** — the target repo (host, language, build/test/lint/typecheck commands, CI).
   See `docs/stack-profile.md`.
2. Run the miner against that repo's clone:

   ```
   node tools/mining --repo /path/to/target-repo --out calibration/candidates.jsonl --days 3650 --min 10
   ```

3. If the target's history is shallow or its commits do not follow a conventional-commit style,
   raise the window (`--days`) and, if the messages are unconventional, extend the fix-message
   patterns in `tools/mining` — **and record the extension**, because a mining rule that is
   widened to reach a number is no longer a mining rule.

## What will NOT be done

- **The corpus will not be padded.** Synthetic samples are a legitimate calibration input
  (blueprint `14` §5.6, "Synthetic corpus"), but they are a *different* input from historical
  mining, and labelling them as mined would make the corpus's detection rate meaningless.
- **The `--min` threshold will not be lowered to make the gate pass.** The threshold is the
  requirement (CL-G0-08), not a parameter to tune.
- **No real target-repository content will be copied into this repository.** The mined output
  contains commit shas, file paths and commit messages. If the target repo is private, its
  messages may be sensitive — the mined file belongs in the factory repo only if the owner is
  content with that; otherwise the corpus is mined on the runner host and the *counts* are
  recorded here instead.

## The tool's own test

The miner is proven against a fixture history with known fixes, not merely run:
`tests/unit/mining.test.ts` (A0.35–A0.38) builds a repository with four known fix-and-test
commits plus two near-misses, and asserts that the four are found and the two are not.

| Test | What it proves |
|---|---|
| A0.35 | The known fixes in a fixture history are found, each with `fixSha`, `preFixSha` and `testPaths` |
| A0.36 | A fix that touches no test is not mined; a test added without a fix is not mined |
| A0.37 | A shortfall is reported and exits non-zero rather than padding the corpus |
| A0.38 | The tool uses git only — no network calls in its source |

## Related

- `docs/spikes/S-1.md` — the first spike (Postgres append design)
- `docs/adr/0022-blast-radius.md` — the calibration-threshold policy these candidates feed
- blueprint `14` §5 — the calibration framework
