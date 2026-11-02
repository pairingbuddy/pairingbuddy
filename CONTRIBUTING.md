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

Smoke and the recovery drill keep to this: `tests/smoke/runner.py` refuses a repo inside the plugin, and `force_wedge.mjs` prints a start line with two directories.

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

### Updating the Marketplace

After creating a release in this repo, update the marketplace:

1. Update version in `pairingbuddy-marketplace/.claude-plugin/marketplace.json`
2. Commit and push to marketplace repo

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

**What you see:** each tool call reports a hook error with a `SyntaxError`, and the tool still runs. This is the one file whose parse failure is not a deny: the hook exits 1 with no decision. Treat the run as ungated from that moment, and stop the session before doing anything else.

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

**What you see:** nothing warns you. The second session can call tools, but it does not own the run: its permission mode is not recorded, `pb run open` refuses with `a run is already active`, and a stage the first session holds denies the next one. Adopting a run explicitly does not exist yet.

If the first session is still working, close the second one, and that is the whole recovery.

To move the run to the second session, close the first one, then void its attempt and clear the owner by hand. The next call from the second session claims the run:

```bash
pb stage fail
node -e 'const fs = require("fs"); const path = process.argv[1]; const ledger = JSON.parse(fs.readFileSync(path, "utf8")); fs.writeFileSync(path, JSON.stringify({ ...ledger, owner: { sessionId: null, lastSeen: null } }, null, 2) + "\n");' "$ROOT/.pairingbuddy/run/task/ledger.json"
pb human accept
pb status
```

Leave out `pb stage fail` when no stage is active.

### A run with no unit

**What you see:** a run you want to drop. `pb task end` refuses with `is not finished, so the task cannot end`, and `pb human abandon` fails with `unknown verb`, because it does not exist until T3a. This is the exposure of dogfood runs before then.

There is no CLI route, so a human deletes the run state by hand. The branch and its commits stay. `.pairingbuddy/test-config.json` and `git-config.json` are outside `run/` and stay too:

```bash
git -C "$ROOT" log --oneline -5
git -C "$ROOT" status --short
rm -rf "$ROOT/.pairingbuddy/run"
```

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
