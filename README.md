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
