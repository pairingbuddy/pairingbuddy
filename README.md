# Pairing Buddy

> **Work in Progress**: This plugin is not ready for use yet. After learning from previous mistakes, I'm moving to an agent-based approach.

Your pair programming companion for test-driven development and clean architecture.

## Documentation

- **[Architecture Guide](./ARCHITECTURE.md)** - Design philosophy, testing strategy, agent architecture, and extensibility

## Installation

```bash
/plugin marketplace add pairingbuddy/pairingbuddy-marketplace
/plugin install pairingbuddy@pairingbuddy-marketplace
```

## Included Skills

### coding
Orchestrates TDD workflows through specialized agents. Classifies tasks and delegates to the appropriate workflow.

### writing-tests
Reference skill for test patterns, FIRST principles, and anti-patterns.

### writing-code
Reference skill for SOLID principles, Clean Code practices, and minimal code approach.

### refactoring-code
Reference skill for code smell identification and refactoring techniques.

### enumerating-tests
Reference skill for test scenario enumeration patterns.

### committing-changes
Reference skill for git commit best practices.

## How It Works

Use `/pairingbuddy:code` to start any coding task. The orchestrator:

1. **Classifies** your task (new feature, bug fix, refactoring, config change, or spike)
2. **Delegates** to the appropriate TDD workflow
3. **Invokes** specialized agents via the Task tool
4. **Pauses** for human review at key checkpoints

**Task Types:**
- **new_feature**: Full TDD with RED-GREEN-REFACTOR cycle
- **bug_fix**: Regression test + fix
- **refactoring**: Verify tests pass, scope changes, refactor
- **config_change**: Make change, verify tests pass
- **spike**: Exploratory coding without TDD (for answering questions, comparing approaches, evaluating technologies)

## Development

```bash
# Install dev dependencies
uv sync --extra dev

# Run tests
uv run pytest
```

## Requirements

- Claude Code
- Familiarity with TDD concepts

## Updating

Skills update automatically when you update the plugin:
```bash
/plugin update pairingbuddy
```

## Attribution

Pairing Buddy builds upon the excellent foundation of [obra/superpowers](https://github.com/obra/superpowers).

## Support

- **Issues**: [GitHub Issues](https://github.com/pairingbuddy/pairingbuddy/issues)
- **Marketplace**: [pairingbuddy/pairingbuddy-marketplace](https://github.com/pairingbuddy/pairingbuddy-marketplace)

## License

MIT License - see LICENSE file for details © 2025 Alberto Prieto Löfkrantz

---

*Built by [Alberto Prieto Löfkrantz](https://albertoprietolofkrantz.dev/)*
