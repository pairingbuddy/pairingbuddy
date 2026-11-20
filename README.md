# Pairing Buddy

Your pair programming companion for test-driven development and clean architecture.

A Claude Code plugin that enforces TDD, SOLID, and Clean Code practices. Plan features with tracer bullet methodology, design UX systems, and build with full TDD workflows. Human review checkpoints keep you in control.

## Installation

```bash
/plugin marketplace add pairingbuddy/pairingbuddy-marketplace
/plugin install pairingbuddy@pairingbuddy-marketplace
```

### Channels: stable and experimental

Pairing Buddy comes in two channels, two plugins in the same marketplace:

| Plugin | Installs from | What the tag passed first |
|--------|---------------|---------------------------|
| `pairingbuddy` (stable) | release tags `vX.Y.Z` only | the full test suite and a smoke run, and the release was cut with a CHANGELOG entry |
| `pairingbuddy-experimental` | tags `vX.Y.Z-exp.N` only | the full test suite and a smoke run. New work lands here first, so it changes more often and may still have rough edges |

The marketplace pins each plugin to one tag, so neither ever installs from an untagged commit. Both are invoked the same way, `/pairingbuddy:code`, `/pairingbuddy:plan` and `/pairingbuddy:design-ux`, so nothing you type changes when you switch.

Only one channel can be on at a time. With both on, Pairing Buddy says so at session start and refuses every prompt until you turn one off.

**Switch to experimental** (in a terminal, then restart Claude Code):

```bash
claude plugin disable pairingbuddy@pairingbuddy-marketplace && claude plugin install pairingbuddy-experimental@pairingbuddy-marketplace
```

**Switch back to stable:**

```bash
claude plugin disable pairingbuddy-experimental@pairingbuddy-marketplace && claude plugin enable pairingbuddy@pairingbuddy-marketplace
```

Claude Code has no single command that swaps two plugins, so each switch is one line of two plugin commands. After the first switch, experimental is installed, and later switches to it use `claude plugin enable` in place of `install`. Run `claude plugin update pairingbuddy-experimental@pairingbuddy-marketplace` to move to a newer experimental tag.

## Usage

### Code

```
/pairingbuddy:code <describe what you want to build or fix>
```

The orchestrator classifies your task and runs the appropriate workflow:

| Task | Workflow |
|------|----------|
| **New feature** | Enumerate scenarios → Write failing tests → Implement → Refactor |
| **Bug fix** | Write regression test → Fix → Verify |
| **Refactoring** | Verify tests pass → Scope changes → Refactor → Verify again |
| **Spike** | Exploratory coding without tests (research and prototyping) |

Supports plan execution mode: point `/code` at a plan MD file and it iterates through tasks with automatic checkbox tracking and Claude Code Task visibility.

**Run it in Claude Code's auto mode.** There is no separate flag: auto mode is what lets a gate pass by itself when its evidence is complete. In manual mode the cost is yours to pay: you approve each workflow start in a permission dialog, and every gate stops and waits for you to type its approval at the prompt.

#### Fewer prompts

The first run in a project asks once before each stage starts ("Run a dynamic workflow?"). That prompt is your consent to spend tokens on the stage, so pb never answers it for you. Pick "Yes, and don't ask again" and later runs in that project start their stages quietly.

pb allows these by itself, with no prompt:

- Its own CLI calls (`node <plugin>/cli/pb.mjs <verb>`) in their bare form, with no `cd`, `;`, `&&`, pipe, quotes or redirect: before a run, `status`, `unit open`, `unit status`, `run open` and `plan next`; during a run, every verb but `publish` and `pr refresh`, which ask each time because they reach GitHub.
- Loading its internal stage skills, such as `pairingbuddy:intake`, which only load instructions.

Its skills and agents look at files with Read, Glob and Grep and keep Bash to one plain command, so a compound shell command does not stop a run on a prompt.

### Plan

```
/pairingbuddy:plan
```

Produces a sequenced, TDD-ready task list using tracer bullet methodology:

1. **Discover** — Brainstorm requirements with adaptive Socratic questioning
2. **Structure** — Analyze/create/update architecture documents
3. **Decompose** — Break into thin end-to-end tracer bullet slices
4. **Sequence** — Write rich, self-contained task descriptions with checkboxes

Output is a markdown plan document ready for `/pairingbuddy:code` execution.

### Design UX

```
/pairingbuddy:design-ux
```

Creates production-ready design systems with three-tiered token architecture:

1. **Explore** — Establish domain grounding and design intent
2. **Architect** — Make strategic layout, color, and typography decisions
3. **Generate** — Produce three-tier tokens (global → alias → component)
4. **Build** — Create preview and example HTML with Playwright feedback
5. **Critique** — Evaluate using 6-pass UX analysis framework
6. **Validate** — Check structural correctness of all artifacts

### Solo Mode

```bash
./scripts/solo-buddy.sh [OPTIONS] <plan_file>
```

Autonomous execution: Solo Buddy runs a plan file without human interaction, using the full TDD workflow for each task. Currently **macOS only**.

```bash
# Basic usage
cd your-project
solo-buddy.sh --plugin-dir /path/to/pairingbuddy plan.md

# With options
solo-buddy.sh -n 3 --max-turns 200 --plugin-dir /path/to/pairingbuddy plan.md
```

| Option | Description |
|--------|-------------|
| `-n <retries>` | Max retries per task (default: 5) |
| `--max-turns <n>` | Limit Claude's turns |
| `--max-budget-usd <n>` | Set a spending cap |
| `--plugin-dir <path>` | Use a specific plugin directory |
| `--use-api-key` | Bill to API key instead of Max/Pro subscription |

**What it does:**
- Executes each plan task through the full TDD workflow (classify, enumerate, implement tests, implement code, refactor, commit)
- Shows live terminal progress: task list with checkmarks, progress bar, current agent, spinner
- Creates a GitHub PR on completion with the report as the body
- Prevents macOS sleep with `caffeinate -s`
- Resumes from where it left off (plan checkboxes are the durable state)

**Important operational notes:**

- **VPN:** Disable your VPN before running. VPN interference causes sessions to terminate after 1-4 tasks. Without VPN, 29-task plans complete in a single ~2 hour session.
- **API key safety:** The script unsets `ANTHROPIC_API_KEY` by default to prevent unexpected API billing. Use `--use-api-key` only if you explicitly want API billing instead of your Max/Pro subscription.
- **Output format:** The script uses `--output-format json` internally. Do not change this to `text` — it causes early session termination.

## Documentation

- [Architecture](./ARCHITECTURE.md) - Design philosophy and system structure
- [Contributing](./CONTRIBUTING.md) - Development setup and release process
- [Changelog](./CHANGELOG.md) - Version history

## Support

- **Issues**: [GitHub Issues](https://github.com/pairingbuddy/pairingbuddy/issues)
- **Marketplace**: [pairingbuddy/pairingbuddy-marketplace](https://github.com/pairingbuddy/pairingbuddy-marketplace)

## License

MIT License - see LICENSE file for details © 2025 Alberto Prieto Löfkrantz

---

*Built by [Alberto Prieto Löfkrantz](https://albertoprietolofkrantz.dev/)*
