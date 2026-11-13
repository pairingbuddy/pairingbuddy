---
name: stacking-branches
description: Guidelines for stacking a unit's branch on the open pull request of the unit it depends on. Covers when to stack, the depth cap, the rebase recipe when a base moves, and merge order.
---

# Stacking Branches

Reference material for stacking one unit's branch on another's open pull request. Stacking is for real code dependencies only. Pairing Buddy never rebases, merges or force-pushes; those are the human's.

## Contents

- [Quick Reference](#quick-reference)

## Quick Reference

### When to stack

Stack only when a unit needs the code of another unit. Declare it in the plan with `Depends on: <unit>` between the unit heading and its first task. Without that line the unit branches from the base.

### Where a unit branches from

`pb unit open --plan` decides:

- The dependency's PR is open: branch from that PR's branch, and target that branch with the new PR.
- The dependency's PR is merged: branch from the freshly fetched base.
- The dependency has no PR line yet: the unit also branches from the base, without the dependency's code. Publish the dependency first.
- The dependency's PR was closed without merging, or its state is unknown: stop; a human decides.

### Depth

Depth is the number of open PRs down the chain. The cap is `pr.stack_depth` (default 3). `0` means a unit never stacks: with an open dependency it stops at `G:next-unit` and waits until the dependency merges; it does not fall back to the base. Past the cap the unit stops at `G:next-unit` with reason `stack-depth` and waits until a base merges.

### When a base moves

`pb unit status` fetches and compares the unit's base with what the unit started from. The plan loop runs it before each task when a unit is already open, and before the publish run. `pb publish` also checks right before it pushes or opens the PR, and refuses on a moved or merged base, printing the recipe, or on a reconcile that was not recorded (run `pb unit status` first).

It stops when the base moved or the dependency merged, and prints a recipe:

```
git rebase --onto <remote>/<new base> <old base sha> <branch>
```

Run it yourself with `!`. If the branch was already pushed, the force push is yours too. Then run `pb unit status` again: it records the new base, and when the dependency merged it drops the stacking so the PR targets the base branch. Pairing Buddy does not retarget a PR that is already open; change its base yourself (`gh pr edit --base`).

`pb unit status` re-proves the rebased unit: it remaps the unit's commits by patch-id, refuses a merge commit, a changed commit or an extra commit, and re-runs the full suite at the new HEAD. Rebase (do not merge) and keep each commit's change as it was. If the suite fails, `pb publish` refuses until a full suite passes at HEAD. The earlier approval at `G:publish` no longer holds after a rebase, so it is asked again.

### Merge order

Merge stacked PRs in stack order, the dependency first, and squash-merge each. After a merge, the next unit up runs `pb unit status`, which prints the rebase onto the new base.
