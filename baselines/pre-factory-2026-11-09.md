# Pre-factory baseline — software-factory

**Date:** 2026-11-09  
**Window:** 90 days (since 2026-08-11T12:25:39.907Z)  
**Measured on:** the existing human workflow, before any factory output existed  
**Source:** git history only — no network, no CI API

> This is a **reference point, not a control group** (blueprint `14` §9.3). It was measured
> under different conditions than a factory-assisted run will be. It is the only honest
> reference point available, and it is measured **once** and never regenerated.

## Metrics

| Metric | Unit | Value | Definition |
|---|---|---|---|
| `pr_lead_time_hours` | hours | no data | First commit on the PR branch → merge commit. |
| `issue_to_merge_hours` | hours | no data | First commit referencing the issue → merge commit. A LOWER BOUND: the issue creation time is not in git history. |
| `review_rounds` | rounds (proxy) | no data | Distinct commit subjects on the PR branch. A proxy for review rounds from git-only data. |
| `pr_size_lines` | lines changed | no data | Added + removed lines in the merge commit. |
| `revert_hotfix_rate` | percent | no data | Revert commits per merged PR, over the window. |
| `ci_failure_rate` | percent (proxy) | 0% | Commits whose subject repeats within the window, over all commits. A proxy for CI failures — CI results are not in git history. |

## Coverage

- Commits in window: **1**
- Merge commits: **0**

## Known gaps

- DORA metrics (deployment frequency, lead time for changes, change failure rate, time to restore) come from CI/CD and incident history, not from git. The owner must supply them.
- `issue_to_merge_hours` is a lower bound (issue creation time is not in git history).
- `review_rounds` and `ci_failure_rate` are proxies, labelled as such in the table.

## Rules for this file

- It is committed **once**. It is never regenerated, never edited to look better, and never
  compared against a vendor's published figure.
- Every later factory report states its **baseline, delta, cost and guardrail** (MEAS-03).
