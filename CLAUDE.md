# Claude Code Context

Pairing Buddy is a Claude Code plugin that orchestrates TDD workflows through specialized agents.

## Quick Reference

**Run tests:**
```bash
uv run pytest
```

**Run specific test file:**
```bash
uv run pytest tests/agents/test_agent_structure.py -v
```

**Lint and format:**
```bash
uv run ruff check .
uv run ruff format .
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:
- Design philosophy (WHAT vs HOW separation)
- Testing strategy (BDD outer-to-inner, test layers pyramid)
- Agent and skill structure (17 agents, 7 skills)
- State management via JSON files (21 schemas)
- Spike workflow (exploratory coding without TDD)
- Extensibility patterns

## Project Structure

```
pairingbuddy/
├── agents/           # Plugin agents (invoke via Task tool)
├── skills/           # Skills (run in main context)
│   ├── coding/       # Orchestrator skill
│   └── */            # Reference skills (writing-tests, etc.)
├── contracts/        # Single source of truth
│   ├── agent-config.yaml    # Agent definitions
│   ├── skill-config.yaml    # Skill definitions
│   └── schemas/             # JSON schemas for state
├── commands/         # Slash commands (/pairingbuddy:code)
└── tests/            # Structural tests (~500)
```

## Key Conventions

### Agents
- Agents define WHAT to do, not HOW (language-agnostic)
- Skills provide language/framework-specific HOW
- Each agent reads input JSON, performs one operation, writes output JSON
- State files live in `.pairingbuddy/` at target project root

### Configuration
- `contracts/agent-config.yaml` is the single source of truth for agents
- `contracts/skill-config.yaml` is the single source of truth for skills
- Tests validate implementations match these contracts

### Testing
- Tests validate structure and contracts, not agent behavior
- Agent behavior is LLM-driven and not deterministically testable
- All tests are parameterized over config files

## When Modifying

### Adding an Agent
1. Add agent definition to `contracts/agent-config.yaml`
2. Create agent file in `agents/<name>.md`
3. Register in `.claude-plugin/plugin.json`
4. Add schema if new input/output needed in `contracts/schemas/`
5. Run tests: `uv run pytest tests/agents/ -v`

### Adding a Skill
1. Add skill definition to `contracts/skill-config.yaml`
2. Create `skills/<name>/SKILL.md`
3. Add reference files if needed (reference.md, etc.)
4. Run tests: `uv run pytest tests/skills/ -v`

### Modifying Schemas
1. Update schema in `contracts/schemas/`
2. Update inline schema in relevant agent markdown files
3. Run `uv run pytest tests/agents/test_agent_schemas.py -v`

## Common Pitfalls

- **Don't add language-specific instructions to agents** - Put them in skills instead
- **Don't modify agent behavior without updating config** - Tests will fail
- **Don't forget to register new agents in plugin.json** - They won't be invocable
- **Keep definitions in sync** - Test terminology must match `contracts/test-terminology.yaml`
- **Focus warning is mandatory** - All agents must include the laser-focused warning from `agent-config.yaml`

## Changelog Convention

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**When making changes:** Add entries to the `[Unreleased]` section as you work. This accumulates changes between releases.

**When releasing:** Move the `[Unreleased]` content to a new versioned section (e.g., `[0.3.0] - 2025-12-17`).

## Releases

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full release process.

**Quick reference:**
1. Update version in `.claude-plugin/plugin.json`
2. Update `CHANGELOG.md` (move Unreleased to new version)
3. Commit: `git commit -m "Bump version to X.Y.Z"`
4. Tag: `git tag -a vX.Y.Z -m "Release description"`
5. Push: `git push origin main && git push origin vX.Y.Z`
