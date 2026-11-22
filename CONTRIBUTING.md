# Contributing to Pairing Buddy

## Development Setup

```bash
# Clone the repository
git clone https://github.com/pairingbuddy/pairingbuddy.git
cd pairingbuddy

# Install dependencies
uv sync --extra dev

# Run tests
uv run pytest

# Run mod tests (mod/*.test.tsx)
claude plugin test .

# Lint and format
uv run ruff check .
uv run ruff format .
```

### Loading the plugin from a checkout

A session never starts inside the directory it passes to `--plugin-dir`. Claude Code treats every path inside an inline `--plugin-dir` as sensitive, so with the cwd there, auto mode fails an in-repo Write with no verdict. Marketplace installs are not affected.

Load the plugin from a separate checkout, and work somewhere else:

```bash
cd /path/to/your/worktree
claude --plugin-dir /path/to/separate/pairingbuddy-checkout
```

Smoke and the recovery drill keep to this: `tests/smoke/runner.py` and `tests/smoke/claude-run.mjs` refuse a repo inside the plugin, and `force_wedge.mjs` prints a start line with two directories.

## Project Structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## Making Changes

### Adding an Agent

1. Add agent definition to `contracts/agent-config.yaml`
2. Create agent file in `agents/<name>.md`
3. Register in `.claude-plugin/plugin.json`
4. Add schema if new input/output needed in `contracts/schemas/`
5. Run tests: `uv run pytest tests/agents/ -v`

### Adding a Skill

1. Add skill definition to `contracts/skill-config.yaml`
2. Create `skills/<name>/SKILL.md`
3. Add reference files if needed
4. Run tests: `uv run pytest tests/skills/ -v`

### Modifying Schemas

1. Update schema in `contracts/schemas/`
2. Update inline schema in relevant agent markdown files
3. Run `uv run pytest tests/agents/test_agent_schemas.py -v`

## Release Process

### Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes to agent contracts or workflows
- **MINOR** (0.X.0): New agents, skills, or features (backward compatible)
- **PATCH** (0.0.X): Bug fixes and documentation updates

### Changelog

We follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**When to update CHANGELOG.md:**
- Before every release
- Group changes under: Added, Changed, Deprecated, Removed, Fixed, Security

**Format:**
```markdown
## [Unreleased]

### Added
- New feature description

## [X.Y.Z] - YYYY-MM-DD

### Added
- Feature that was added

### Changed
- Feature that was modified

### Removed
- Feature that was removed
```

### Git Tags

We use annotated tags with a `v` prefix following common convention.

**Creating a release:**

1. **Update version** in `.claude-plugin/plugin.json`

2. **Update CHANGELOG.md**
   - Move items from `[Unreleased]` to new version section
   - Add release date in ISO 8601 format (YYYY-MM-DD)

3. **Commit the release**
   ```bash
   git add CHANGELOG.md .claude-plugin/plugin.json
   git commit -m "Bump version to X.Y.Z"
   ```

4. **Create annotated tag**
   ```bash
   git tag -a vX.Y.Z -m "Release description

   - Key change 1
   - Key change 2
   - Key change 3"
   ```

5. **Push commits and tags**
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

**Tag message guidelines:**
- First line: Brief release title
- Blank line
- Bulleted list of key changes

**Example:**
```bash
git tag -a v0.3.0 -m "Add Java support

- Add writing-tests/java.md for JUnit patterns
- Add writing-code/java.md for Java conventions
- Update skill config with Java file references"
```

### Tagging Historical Commits

To tag a past commit (e.g., for retroactive releases):

```bash
git tag -a vX.Y.Z -m "Release message" <commit-hash>
```

### Release channels

Two plugins in `pairingbuddy-marketplace` install from this repo, each pinned to one tag:

| Marketplace entry | Tag | Installs as |
|-------------------|-----|-------------|
| `pairingbuddy` (stable) | `vX.Y.Z` | `pairingbuddy@pairingbuddy-marketplace` |
| `pairingbuddy-experimental` | `vX.Y.Z-exp.N` | `pairingbuddy-experimental@pairingbuddy-marketplace` |

Both tags carry the same `plugin.json` name, `pairingbuddy`, so skills, agents and commands keep the `pairingbuddy:` namespace on either channel. Do not rename it for experimental: every stage and agent reference reads `pairingbuddy:<name>`. The marketplace entry name is what tells the channels apart in `enabledPlugins`, and `hooks/channel-guard.mjs` refuses every prompt while both are on (SessionStart cannot stop a session, so it only warns there). The ids live in `shared-node/channels.mjs`.

**Cutting an experimental tag `vX.Y.Z-exp.N`.** `X.Y.Z` is the next stable release, and `N` counts up from 1. Every step must pass before the tag exists:

1. On a clean checkout of the commit to tag, set `version` in `.claude-plugin/plugin.json` to `X.Y.Z-exp.N` and commit it. The version must change on each tag: Claude Code detects an update by it.
2. Run the full suite:
   ```bash
   uv run --extra dev pytest -q
   claude plugin test .
   node scripts/build-workflows.mjs --check
   claude plugin validate .
   ```
   `claude plugin validate .` reports six known errors today, `pairingbuddy.<key> is not declared` from the mod's types contract. Until those are fixed, no other error may show.
3. Run a smoke run from the repo root, in a separate shell (it spends money): `uv run python -m tests.smoke.s1`. It must end with a pass.
4. Tag and push the tag (the human approves every public tag):
   ```bash
   git tag -a vX.Y.Z-exp.N -m "Experimental X.Y.Z-exp.N"
   git push origin vX.Y.Z-exp.N
   ```
5. In `pairingbuddy-marketplace/.claude-plugin/marketplace.json`, set the `pairingbuddy-experimental` entry's `source.ref` to `vX.Y.Z-exp.N`, then commit and push the marketplace.

**Cutting a stable release `vX.Y.Z`.** Do steps 2 and 3 on the release commit, then follow Creating a release above, then set the `pairingbuddy` entry's `source.ref` to `vX.Y.Z` in the marketplace. A stable tag never carries `-exp`.

### Updating the Marketplace

The two entries, with neither `version` set (the tag's `plugin.json` version governs updates):

```json
{
  "name": "pairingbuddy",
  "source": { "source": "github", "repo": "pairingbuddy/pairingbuddy", "ref": "vX.Y.Z" },
  "description": "Pairing Buddy, your pair-programming companion. Stable channel: release tags only.",
  "strict": true
},
{
  "name": "pairingbuddy-experimental",
  "source": { "source": "github", "repo": "pairingbuddy/pairingbuddy", "ref": "vX.Y.Z-exp.N" },
  "description": "Pairing Buddy, experimental channel: tags that passed the full suite and a smoke run. Turn stable off first.",
  "strict": true
}
```

Check it with `claude plugin validate <marketplace checkout>`, then commit and push the marketplace repo.

## Recovering a wedged run

Each section below says what you see, then what to type. These steps are for a human. Do not hand them to a model: `pb human` commands are refused from a model, and deleting run state by hand ends the run.

To practise on a throwaway clone, force a wedge and follow its section:

```
node tests/drills/force_wedge.mjs --list
node tests/drills/force_wedge.mjs --stranded-stage
```

The script makes a clone with no remote, for the session to work in, and a checkout beside it, for the session to load the plugin from. It prints both paths, the `claude --plugin-dir` line to start a session, and the `export` line for `ROOT` and `PLUGIN`. It refuses this repo and any repo it did not make. `--clone <path>` resets one of its own clones and forces another wedge there.

### Before you start

Work in a separate terminal, where no hook runs. Set `ROOT` to the worktree that holds the run and `PLUGIN` to the checkout the session was started with, then:

```bash
pb() { node "$PLUGIN/cli/pb.mjs" "$@"; }
cd "$ROOT"
```

Typed at the Claude prompt with a leading `!`, a command also skips the hooks. Each `!` line is its own shell, so write it out in full: `!cd <ROOT> && node <PLUGIN>/cli/pb.mjs status`.

### gate.mjs crash or throw

**What you see:** every Write, Edit, Bash, Workflow and Agent call is denied with `Gate error during a run, so the call is denied: ...`. The model cannot fix this, since its Bash is denied too.

Restore the plugin's code:

```bash
git -C "$PLUGIN" status --short
git -C "$PLUGIN" checkout -- hooks shared-node
pb status
```

If the bad code is committed in `$PLUGIN`, move the pin back instead: see Back-out in the plan.

### gate.mjs parse failure

**What you see:** every Write, Edit, Bash, Workflow and Agent call is denied with `The gate could not load, so the call is denied during a run: ...`. The registered hook is `hooks/gate-boot.mjs`, which loads `gate.mjs` and denies when it cannot. The model cannot fix this, since its Bash is denied too.

```bash
git -C "$PLUGIN" status --short
git -C "$PLUGIN" checkout -- hooks
ls -la "$ROOT/.pairingbuddy/run/task"
pb status
```

Inspect that listing. Run state is gitignored, so `git status` cannot show a write into it, and a file there with a time after the hook broke did not come through the gate. If `pb status` reports a SHA mismatch, go to that section.

### gate-boot.mjs parse failure

**What you see:** the pane and the band read `✕ STOPPED · safety checks are off`, with the fix line under it, and the model says the safety checks are off and stops. `hooks/gate-watch.mjs` loads `gate-boot.mjs` apart from it: during a run it denies Write, Edit, Bash, Workflow and Agent with that message and leaves `.pairingbuddy/run/gate-off.json` for the pane. Without it you would see only a hook error with a `SyntaxError` on each call, and the tool still runs, since this is the one file whose parse failure is not a deny. Treat the run as ungated from the moment it broke, and stop the session before doing anything else.

```bash
git -C "$PLUGIN" status --short
git -C "$PLUGIN" checkout -- hooks
git -C "$ROOT" status --short
git -C "$ROOT" log --oneline -5
ls -la "$ROOT/.pairingbuddy/run/task"
pb status
```

The last four show what ran while nothing was gated. Inspect the listing too: run state is gitignored, so only `ls` shows a write into it. If `pb status` reports a SHA mismatch, go to that section.

### Stranded active stage

**What you see:** the next stage is denied with `Stage <name> is active at attempt <n>. Wait for it to finish`, a deny that ends by naming `pb stage fail`, and nothing is running. `pb status` shows the stage as active.

```bash
pb status
pb stage fail
```

Then start the same stage again, at the attempt `stage fail` printed as `nextAttempt`. Late returns from the dead attempt are voided. A stage with no recorded run also clears this way, or after its 120-second start lease the gate lets it restart at the same attempt.

### Killed session mid-stage

**What you see:** the session is gone and the stage is active. `pb stage fail` may refuse with `could not take the ledger lock`, because a write died under the lock. The lock goes stale after 30 seconds and the next writer clears it, so do not delete it.

```bash
sleep 31
pb stage fail
git -C "$ROOT" status --short
```

The status line lists what the killed stage left behind. Delete what you do not want by hand, because `pb task end` refuses a dirty tree. Commits the stage already made stay on the branch. Then start a new session and restart the stage at `nextAttempt`.

Within the same session, a killed stage workflow can instead be resumed by calling it with `resumeFromRunId` equal to the stage's recorded `runId`; otherwise run `pb stage fail` and restart the stage.

### Killed session at a gate

**What you see:** `pb status` shows `needsHuman` with a gate, and `pb stage fail` refuses or finds no stage to fail. Only a human can pass a gate. The same command undoes a human's `stop` or `redo` answer at a gate, and `pb stage fail` refuses to lift a human's `stop`.

```bash
pb status
pb human approve G:task-end
pb status
```

Use the gate `pb status` names, in place of `G:task-end`.

### Ledger SHA mismatch

**What you see:** `pb` refuses with `sha mismatch: the file was edited outside deterministic code`, and the gate denies Write, Edit and Workflow with the same text. Bash stays open so that the route out works.

Look at `.pairingbuddy/run/task/ledger.json`. If you accept the edit:

```bash
pb human accept
pb status
```

If the file is not well-formed, `pb human accept` refuses: fix it by hand and run it again. If it cannot be fixed, delete the run as in "A run with no unit".

### Second session in the same worktree

**What you see:** SessionStart tells the second session that the run belongs to another session, names that session and when it was last seen, and gives the adopt line. The second session does not own the run: its permission mode is not recorded, the Stop hook tells it nothing, `pb run open` refuses with `a run is already active`, and a stage the first session holds denies the next one.

If the first session is still working, close the second one, and that is the whole recovery.

To move the run to the second session, close the first one, then the human types `pb human adopt` at the prompt (with `--force` when the owner was seen in the last 10 minutes). It clears the owner and fails an active stage, and the next call from the second session claims the run. Then run `pb status`:

```bash
pb human adopt --force
pb status
```

### A run with no unit

**What you see:** a run you want to drop. `pb task end` refuses with `is not finished, so the task cannot end`.

`pb human abandon` is human-only, so a human types it at the Claude prompt. It removes the run state under `.pairingbuddy/run/`. The branch and its commits stay, and so do `.pairingbuddy/test-config.json` and `git-config.json`, which are outside `run/`:

```bash
! cd <ROOT> && node <PLUGIN>/cli/pb.mjs human abandon
```

If the CLI itself is broken, that command cannot run. Use the Broken CLI recovery below, which ends with deleting the run state by hand.

### Broken CLI

**What you see:** every `pb` call dies with a `SyntaxError` or `unexpected failure`. If the fault is in `shared-node/`, the gate also denies every call, as it does for a crash.

Restore the code first, which keeps the run:

```bash
git -C "$PLUGIN" status --short
git -C "$PLUGIN" checkout -- cli shared-node
pb status
```

If the code is committed that way and no good checkout is at hand, a human deletes the run state by hand. With the run gone the gate has nothing to enforce, broken or not. Then move the pin back, see Back-out in the plan:

```bash
rm -rf "$ROOT/.pairingbuddy/run"
```

### Not verified without a live session

`tests/drills/test_wedges.py` runs the commands above against each forced wedge, with the hooks called directly. The live drill of 2026-11-02 saw the prompt, the `!` route, hook files restored under a running session and a second real session: see "T1 recovery drill" in `docs/spikes/workflow-platform-spike.md`. These parts still need a person and a real session:

- That the deny from `gate-boot.mjs` holds at the prompt. The live drill ran before that file existed, and only direct hook calls have seen it.
- A Workflow that outlives its killed session. The drill kills a ledger writer under the lock.

## Code Style

- **Agents**: Define WHAT, not HOW (language-agnostic)
- **Skills**: Provide language/framework-specific HOW
- **Tests**: Validate structure and contracts, not LLM behavior
- **Focus warning**: All agents must include the laser-focused warning

## Questions?

- **Issues**: [GitHub Issues](https://github.com/pairingbuddy/pairingbuddy/issues)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
