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
```

`run`, `judge` and `summary` use the newest lab under the labs root, or the one `--lab <dir>` names.

Setup options (also taken by `all`):

| Option | Default | What it does |
|---|---|---|
| `--model` | `sonnet` | `sonnet`, `opus`, `haiku` or a full model id, for both runs and the judge |
| `--tiers` | `same` | `same` sets `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` to the model, so agents pinned to a tier also run on it. `native` leaves each build's pins alone |
| `--permission-mode` | `bypassPermissions` | the same for both sides |
| `--budget-usd` | `25` | `--max-budget-usd` for each side |
| `--timeout-min` | `120` | wall-clock limit per side. The run's process group is killed at the limit |
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

Both run `claude -p "/pairingbuddy:code <task>" --output-format json --model <id> --plugin-dir <plugin> --setting-sources project,local --strict-mcp-config --permission-mode bypassPermissions --max-budget-usd <cap>` in their repo. The environment drops every `PAIRINGBUDDY*`, `PB_*`, `CLAUDE*`, `ANTHROPIC_*` and `GIT_*` variable first.

- **Old** gets `PAIRINGBUDDY_SOLO=true`. Its `_ask_human` checkpoints answer yes, as under Solo Buddy, which also ran `claude -p --dangerously-skip-permissions`.
- **New** gets `PAIRINGBUDDY_GATE_POLICY=auto`. The gate hook records the auto policy from it whatever the permission mode, so its continue gates pass by themselves, and the curator asks no question under `claude -p`.

`bypassPermissions` is the default for both because it is what Solo Buddy used, and it keeps the permission layer the same on both sides. `--permission-mode auto` (what the S2 smoke and the t4a lab use) adds a classifier call per tool call and its cost, and acceptEdits would stop at the first Bash or Workflow prompt with no one to answer. The new build's hooks still hold under bypass (probe P13B).

## What is counted

- **Wall time**: measured by the script around the `claude -p` process. Claude duration is the result's `duration_ms`.
- **Cost**: the result's `total_cost_usd`, Claude Code's own count for the session. It should include subagents and workflow agents. Cross-check against `modelUsage` in `results/<side>/claude.json`.
- **Tokens**: summed from the transcripts under `~/.claude/projects/`: the session's `<session-id>.jsonl` and every `.jsonl` under `<session-id>/` (Agent subagents in `subagents/`, workflow agents in `subagents/workflows/`), not the workflow `journal.jsonl`. Each API message counts once by message id. Synthetic messages count zero. Without a session id (a killed run), all sessions in the repo's project folder count.
- **Not counted**: the permission classifier under `auto` mode (not in transcripts), hook processes, and `pb` CLI work, which spends no tokens. The judge's cost is reported on its own line.
- **Turns** are the main session's `num_turns`, not the agents' turns.

## The judge

`judge` takes each repo's diff from the start commit, untracked files included (`git add -A --intent-to-add`), and runs pytest in each repo. It labels the two diffs A and B in random order, saves the mapping in `results/judge/mapping.json`, and runs `claude -p` with no tools, the same model, and a JSON schema. The judge scores correctness, test quality, readability and scope discipline from 1 to 10, with reasons, and says which it prefers. The summary gives the reasons by label, then unblinds them at the end.

The judge sees the task, the starting files, both diffs, and each side's pytest counts. It does not see commit messages, branches or which plugin ran. A diff's style (test names, docstrings, any docs it adds) can still give a side away.

## Results

`results/results.json` holds everything. `results/summary.md` is the side-by-side table. Under `results/old/` and `results/new/`: `claude.json` (raw result), `stderr.txt`, `run.json`, `diff.patch`, `tests.txt` and `outcome.json`. Under `results/judge/`: `prompt.txt`, `mapping.json`, `claude.json` and `judge.json`.

## What drives cost and time

- The number of agent calls. Old runs about 4 to 5 agents per test (RED, GREEN, two issue finders, refactor), plus classify, scenarios, placeholders, coverage, the full run, docs and commit, one after another. New adds lens reviews, refuters and a course checker per stage, and a PR draft with lint at publish.
- Cache reads. Each agent re-reads its instructions and skills, so cache-read tokens dominate. With `--tiers native`, agents pinned to opus cost more per token than sonnet, and the builds pin different agents to it.
- `run both` runs the sides at the same time on one account, so they share rate limits. Run `run old` and then `run new` for clean wall times.

## Known risks

- Old can stop early by its own rules: Solo mode stops on any ambiguity it finds no rule for, and writes the reason to `.pairingbuddy/SOLO_BUDDY_REPORT.md` in its repo.
- New asks in spite of the auto policy at its always-stop conditions (a coverage gap, the retry limit, a changed config, a bad selector), and at publish when the PR lint fails or a task has no lens record. Under `claude -p` no one answers, so the run ends there. The code and its commits up to that point are still judged. Its ledger is at `new/repo/.pairingbuddy/run/`.
- A run that hits `--budget-usd` ends with `error_max_budget_usd`. The summary's "finished" row shows it.
