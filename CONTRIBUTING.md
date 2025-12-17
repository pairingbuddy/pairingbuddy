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

## Code Style

- **Agents**: Define WHAT, not HOW (language-agnostic)
- **Skills**: Provide language/framework-specific HOW
- **Tests**: Validate structure and contracts, not LLM behavior
- **Focus warning**: All agents must include the laser-focused warning

## Questions?

- **Issues**: [GitHub Issues](https://github.com/pairingbuddy/pairingbuddy/issues)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
