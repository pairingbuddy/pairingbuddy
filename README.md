# Pairing Buddy

Your pair programming companion for test-driven development and clean architecture.

A Claude Code plugin that enforces TDD, SOLID, and Clean Code practices. Plan features with tracer bullet methodology, design UX systems, and build with full TDD workflows. Human review checkpoints keep you in control.

## Installation

```bash
/plugin marketplace add pairingbuddy/pairingbuddy-marketplace
/plugin install pairingbuddy@pairingbuddy-marketplace
```

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
