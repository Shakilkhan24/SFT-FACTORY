#!/usr/bin/env bash
# tools/worktree.sh <ticket> — the per-ticket worktree (AGENTS.md §3 step 1).
#
# Creates a git worktree on branch `ticket/T-x.yy` at `.worktrees/T-x.yy`, based on
# the current branch. The agent never works on `main`; this script is what makes that
# true rather than merely stated.
#
#   tools/worktree.sh T-1.02        →  branch ticket/T-1.02, path .worktrees/T-1.02
#   tools/worktree.sh T-1.02 --print   →  print the path and exit (no worktree made)
#
# Exit codes:
#   0  the worktree exists (or was already there) and its path was printed
#   1  bad usage, or git refused
#
# The worktree directory is gitignored; the BRANCH is not. Delete the worktree with
# `git worktree remove` and the branch with `git branch -d` after the PR merges.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: tools/worktree.sh <ticket> [--print]

  <ticket>   a ticket id such as T-1.02
  --print    print the worktree path for an existing ticket and exit
USAGE
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

TICKET="$1"
PRINT_ONLY=0
if [ "${2:-}" = "--print" ]; then
  PRINT_ONLY=1
elif [ $# -gt 1 ]; then
  usage
  exit 1
fi

# The ticket id appears in a path and a branch name. Keep it to a safe charset so a
# ticket id can never become a shell injection or a path escape.
if ! printf '%s' "$TICKET" | grep -Eq '^T-[0-9]+\.[0-9]+$'; then
  echo "worktree: refusing ticket id '$TICKET' (expected the form T-<n>.<nn>)" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="ticket/$TICKET"
WORKTREE_PATH="$REPO_ROOT/.worktrees/$TICKET"

if [ "$PRINT_ONLY" -eq 1 ]; then
  if [ -d "$WORKTREE_PATH" ]; then
    printf '%s\n' "$WORKTREE_PATH"
    exit 0
  fi
  echo "worktree: no worktree for $TICKET (expected $WORKTREE_PATH)" >&2
  exit 1
fi

if [ -d "$WORKTREE_PATH" ]; then
  echo "worktree: $TICKET already has a worktree at $WORKTREE_PATH" >&2
  printf '%s\n' "$WORKTREE_PATH"
  exit 0
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "worktree: branch $BRANCH exists but has no worktree; attaching to it" >&2
else
  git branch "$BRANCH" >/dev/null
  echo "worktree: created branch $BRANCH at $(git rev-parse --short HEAD)" >&2
fi

git worktree add "$WORKTREE_PATH" "$BRANCH" >&2

printf '%s\n' "$WORKTREE_PATH"
