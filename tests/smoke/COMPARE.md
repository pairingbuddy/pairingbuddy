# Compare lab: v0.7.0 vs the new build

`tests/smoke/compare-lab.mjs` runs the released Pairing Buddy (old, tag `v0.7.0`) and a new build on the same task, with the same model, unattended. It writes a side-by-side result: wall time, tokens, cost, tests passing, and a blind judge's scores. It spends money, so no suite runs it. `tests/js/compare-lab.test.mjs` covers the parts that need no model.

## Run it

From the root of this checkout, with `ANTHROPIC_API_KEY` unset. The script refuses to start when it is set, and drops every `ANTHROPIC_*` variable from the runs it starts.

```sh
node tests/smoke/compare-lab.mjs all --new-plugin /path/to/new-build
```

It prints the lab folder, then the path of `results/summary.md`. The steps also run on their own:

```sh
node tests/smoke/compare-lab.mjs setup --new-plugin /path/to/new-build   # prints the lab dir
node tests/smoke/compare-lab.mjs run both      # or: run old, run new. both runs in parallel
node tests/smoke/compare-lab.mjs judge         # diffs, pytest in each repo, the blind judge, then the summary
node tests/smoke/compare-lab.mjs summary       # rewrite results.json and summary.md
node tests/smoke/compare-lab.mjs reset new     # or: reset old, reset both. the side's repo back at the start, its results gone
```

`run`, `reset`, `judge` and `summary` use the newest lab under the labs root, or the one `--lab <dir>` names. A side runs once per lab: `run` refuses a side that has `results/<side>/run.json`, and names the `reset` that clears it. To run one side again in the same lab, reset it, run it, then judge:

```sh
node tests/smoke/compare-lab.mjs reset new --lab <lab>
node tests/smoke/compare-lab.mjs run new --lab <lab>
node tests/smoke/compare-lab.mjs judge --lab <lab>
```

`reset` remakes the side's repo and origin from the fixture (same start commit, or it refuses), rewrites its configs, empties its gh shim log and removes `results/<side>/`. The other side is not touched.

Setup options (also taken by `all`):

| Option | Default | What it does |
|---|---|---|
| `--model` | `sonnet` | `sonnet`, `opus`, `haiku` or a full model id, for both runs and the judge |
| `--tiers` | `same` | `same` sets `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` to the model, so agents pinned to a tier also run on it. `native` leaves each build's pins alone |
| `--permission-mode` | `bypassPermissions` | the same for both sides |
| `--budget-usd` | `25` | `--max-budget-usd` for each side |
| `--timeout-min` | `120` | wall-clock limit per side, over all its invocations. The run's process group is killed at the limit |
| `--max-resumes` | `30` | how many times the new side's session is resumed at most. A lab made before this option takes 30 |
| `--new-plugin` | this checkout | the new build's plugin dir |
| `--old-ref` | `v0.7.0` | the tag the old plugin worktree is made from |
| `--old-plugin` | none | an existing checkout of the old build, used instead of making a worktree |
| `--root` | `$PB_COMPARE_LABS` or `$TMPDIR/pb-compare-labs` | where labs go. It must not be inside either plugin |

## What setup makes

```
<root>/<stamp>/
  lab.json            settings, plugin dirs and shas, the start commit
  task.txt            the fixture task
  plugin-v0.7.0/      detached git worktree of the tag (unless --old-plugin)
  old/ new/           repo/ (on main), origin.git (bare, holds main), pb-gh-shim-*/
  results/            written by run, judge and summary
```

Both repos come from `tests/smoke/fixtures/compare-schedule/`: a small `schedule.py` with four functions and their tests, and a task for `free_slots` with merging, clipping, a minimum length and three validation errors (about 6 tests). The start commit has a fixed date, so both repos start from the same sha. Each repo's gitignored `.pairingbuddy/` gets the test and doc config its build takes: v0.7.0's test-config schema has no `selector_template`.

Nothing reaches GitHub: `origin` is a local bare repo, and the recording `gh` shim is first on PATH (calls land in `pb-gh-shim-*/gh.log`). Remove a lab's old plugin worktree with `git worktree remove <lab>/plugin-v0.7.0` from this repo, or `git worktree prune` after deleting the lab.

## How each side runs unattended

Both run `claude -p "/pairingbuddy:code <task>" --output-format json --model <id> --plugin-dir <plugin> --setting-sources project,local --strict-mcp-config --tools <tests/smoke/session-tools.json> --permission-mode bypassPermissions --max-budget-usd <cap>` in their repo. The tools are named because the default set can leave out Glob and Grep. The environment drops every `PAIRINGBUDDY*`, `PB_*`, `CLAUDE*`, `ANTHROPIC_*` and `GIT_*` variable first.

- **Old** gets `PAIRINGBUDDY_SOLO=true`. Its `_ask_human` checkpoints answer yes, as under Solo Buddy, which also ran `claude -p --dangerously-skip-permissions`.
- **New** gets `PAIRINGBUDDY_GATE_POLICY=auto`. The gate hook records the auto policy from it whatever the permission mode, so its continue gates pass by themselves, and the curator asks no question under `claude -p`.

`bypassPermissions` is the default for both because it is what Solo Buddy used, and it keeps the permission layer the same on both sides. `--permission-mode auto` (what the S2 smoke and the t4a lab use) adds a classifier call per tool call and its cost, and acceptEdits would stop at the first Bash or Workflow prompt with no one to answer. The new build's hooks still hold under bypass (probe P13B).

Both also get `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. The new build starts each stage as a background Workflow and its main turn ends while it runs. `claude -p` waits for background tasks and takes each one's notification as a new turn, but by default it stops them 10 minutes after the last turn. A code-tdd stage runs longer than that. In the first lab (20261120-234453) the new side ended after 11.9 minutes with code-tdd still active, 4 placeholder tests left and no safety net or PR. Its stderr said: "Background tasks still running 10m after the last turn ...; stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely." With 0, the side's own timeout is the only limit. Old runs in the foreground and is not affected.

### The new side's resume loop

The wait setting should keep the new side in one `claude -p`. The loop is the backstop for the rest. After each `claude -p` exits, the script reads the run with the new build's own CLI, `node <plugin>/cli/pb.mjs status --action` in the repo, which writes nothing, plus the runs the build kept under `.pairingbuddy/reports/runs/`:

- **Ended**: no run is open and a kept publish run is there. It is finished when that run opened a PR (`kept.json` has `prUrl`), and "ended-no-pr" when it opened none.
- **Waiting for a human**: the run has a stop, a question (`needsHuman`) with no stage active, or an answer only the human can act on. The loop stops and records the reason.
- **Unreadable**: `pb status` failed for any reason but "no run here" (no run open: an older build refuses with it, the current one answers `run: null` with exit 0). The loop stops.
- **Running**, **task-ended** (the task ended and its publish run has not run) or **not-started**: the session is resumed with `claude -p --resume <session_id> "<continue prompt>"` and the same flags. `--max-budget-usd` gets what is left of the cap. The prompt says no human is available, that a stage left active lost its workflow with the process (when one did), and to run `pb status --action` and do what it says.

The loop also stops at `--max-resumes`, the wall time, the budget, an `error_max_budget_usd` result, or a result with no session id. `run.json` records the end state (`end`) and the loop (`loop`: invocations, resumes, why it stopped, each exit). Old runs once. Its end is read from `.pairingbuddy/SOLO_BUDDY_REPORT.md` when there is one (Solo writes it for a plan). A single `/code` task writes none, so its `commit-result.json` with status success stands in.

## What is counted

- **Finished**: the real end state, from `outcome.json`'s `end` (read again at judge time) or else `run.json`'s, not the exit code. "yes" with the reason, "no, waiting for a human: <reason>", or "no: <why the loop stopped>; <state>". A run from before end states were read shows "exit N, end not read".
- **Wall time**: measured by the script from the first `claude -p` to the last, pb reads included. **API time** is the result's `duration_api_ms`. `duration_ms` covers only the last turn of a `-p` call, so it is not shown.
- **Cost**: the result's `total_cost_usd`, Claude Code's own count for the session. It should include subagents and workflow agents. A resumed session goes on from the total its transcript saved, so each result carries the running total and `--max-budget-usd` counts only that call's own spend. The script adds each call's rise over the one before; a total that fell started over, so all of it counts. API time is added the same way. Each invocation's raw result is kept: `results/<side>/claude.json`, `claude.2.json`, and so on, with `stderr.txt`, `stderr.2.txt`. Cross-check against `modelUsage` in them.
- **Tokens**: summed from the transcripts under `~/.claude/projects/`: the session's `<session-id>.jsonl` and every `.jsonl` under `<session-id>/` (Agent subagents in `subagents/`, workflow agents in `subagents/workflows/`), not the workflow `journal.jsonl`. Each API message counts once by message id. Synthetic messages count zero. Without a session id (a killed run), all sessions in the repo's project folder count.
- **Not counted**: the permission classifier under `auto` mode (not in transcripts), hook processes, and `pb` CLI work, which spends no tokens. The judge's cost is reported on its own line.
- **Turns** are the main session's `num_turns`, summed over the invocations, not the agents' turns. Each `-p` result counts the turns since its own last result, so turns started by background notifications before it are not all in it.

## The judge

`judge` takes each repo's diff from the start commit, untracked files included (`git add -A --intent-to-add`), and runs pytest in each repo. It labels the two diffs A and B in random order, saves the mapping in `results/judge/mapping.json`, and runs `claude -p` with no tools, the same model, and a JSON schema. The judge scores correctness, test quality, readability and scope discipline from 1 to 10, with reasons, and says which it prefers. The summary gives the reasons by label, then unblinds them at the end.

The judge sees the task, the starting files, both diffs, and each side's pytest counts. It does not see commit messages, branches or which plugin ran. A diff's style (test names, docstrings, any docs it adds) can still give a side away.

## Results

`results/results.json` holds everything. `results/summary.md` is the side-by-side table. Under `results/old/` and `results/new/`: `claude.json` (raw result; `claude.<n>.json` for the nth invocation), `stderr.txt` (and `stderr.<n>.txt`), `run.json` (with `end` and `loop`), `diff.patch`, `tests.txt` and `outcome.json` (with `end`, read at judge time, and `loop`). Under `results/judge/`: `prompt.txt`, `mapping.json`, `claude.json` and `judge.json`.

## What drives cost and time

- The number of agent calls. Old runs about 4 to 5 agents per test (RED, GREEN, two issue finders, refactor), plus classify, scenarios, placeholders, coverage, the full run, docs and commit, one after another. New adds lens reviews, refuters and a course checker per stage, and a PR draft with lint at publish.
- Cache reads. Each agent re-reads its instructions and skills, so cache-read tokens dominate. With `--tiers native`, agents pinned to opus cost more per token than sonnet, and the builds pin different agents to it.
- `run both` runs the sides at the same time on one account, so they share rate limits. Run `run old` and then `run new` for clean wall times.

## Known risks

- Old can stop early by its own rules: Solo mode stops on any ambiguity it finds no rule for, and writes the reason to `.pairingbuddy/SOLO_BUDDY_REPORT.md` in its repo.
- New asks in spite of the auto policy at its always-stop conditions (a coverage gap, the retry limit, a changed config, a bad selector), and at publish when the PR lint fails or a task has no lens record. Under `claude -p` no one answers, so the loop stops there and the summary says "waiting for a human" with the reason. The code and its commits up to that point are still judged. Its ledger is at `new/repo/.pairingbuddy/run/`.
- A resume after a lost workflow leaves the new build to decide how to go on (its `pb status --action` names `pb stage fail` for a killed workflow). That restart costs time and money the run would not have spent in one process, so a run that needed resumes is not a clean timing.
- A run that hits `--budget-usd` ends with `error_max_budget_usd`. The summary's "finished" row shows it.
