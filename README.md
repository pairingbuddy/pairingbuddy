# Pairing Buddy

Your pair programming companion for test-driven development and clean architecture.

A Claude Code plugin that enforces TDD, SOLID, and Clean Code practices. Human review checkpoints keep you in control.

## Installation

```bash
/plugin marketplace add pairingbuddy/pairingbuddy-marketplace
/plugin install pairingbuddy@pairingbuddy-marketplace
```

## Usage

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
