# Pairing Buddy Architecture

> Your pair programming companion for test-driven development and clean architecture.

## Table of Contents

- [Overview](#overview)
- [Design Philosophy](#design-philosophy)
- [Architecture](#architecture)
  - [Components](#components)
  - [Orchestrator-Agent Pattern](#orchestrator-agent-pattern)
  - [State Management](#state-management)
  - [Flow](#flow)
- [Testing Philosophy](#testing-philosophy)
  - [RED-GREEN-REFACTOR Cycle](#red-green-refactor-cycle)
  - [Test Terminology](#test-terminology)
  - [FIRST Principles](#first-principles)
  - [Four-Phase Test Structure](#four-phase-test-structure)
  - [Test Status Verification](#test-status-verification)
- [Testing Strategy for Pairing Buddy Itself](#testing-strategy-for-pairing-buddy-itself)
  - [BDD Approach: Outer to Inner](#bdd-approach-outer-to-inner)
  - [The Test Layers Pyramid](#the-test-layers-pyramid)
  - [Contract-Driven Development](#contract-driven-development)
  - [Test Catalog](#test-catalog)
  - [What We Test vs What We Don't](#what-we-test-vs-what-we-dont)
- [What is Implemented](#what-is-implemented)
  - [Agents](#agents)
  - [Skills](#skills)
  - [JSON Schemas](#json-schemas)
- [Extensibility](#extensibility)
  - [Design for Extension](#design-for-extension)
  - [Adding Language/Framework Support](#adding-languageframework-support)
  - [Future Extensions](#future-extensions)
- [Key Design Decisions](#key-design-decisions)

---

## Overview

Pairing Buddy is a Claude Code plugin that orchestrates Test-Driven Development (TDD) workflows through specialized agents. It migrated from a nested skill-based architecture to a flat agent architecture with Python pseudocode workflows and JSON contracts.

**Core principle:** A skill acts as orchestrator in the main context, invoking self-contained plugin agents via the Task tool. Agents communicate through JSON state files, creating a predictable, testable, and extensible system.

---

## Design Philosophy

### Separation of Concerns: WHAT vs HOW

**Agents define WHAT to do at a high level.** They do NOT include:
- Language-specific syntax (e.g., pytest patterns, JUnit annotations)
- Framework-specific patterns (e.g., Arrange-Act-Assert, Given-When-Then)
- Testing strategies (e.g., "use mocks", "use fixtures")
- Implementation details (e.g., "use parameterized tests")

**Skills provide language/framework-specific HOW via progressive disclosure.** This enables:
- **Extensibility by design**: Add new languages (Java, JavaScript, Go) without changing agents
- **Framework flexibility**: Support multiple testing frameworks (pytest, unittest, JUnit, Jest)
- **Separation of concerns**: Agent logic is stable; skill content evolves

### TDD as First-Class Citizen

The entire architecture is built around the RED-GREEN-REFACTOR cycle:
1. **RED**: Write failing tests first (tests should fail because production code doesn't exist or doesn't match spec)
2. **GREEN**: Write minimal code to make tests pass (no gold-plating)
3. **REFACTOR**: Improve code quality while keeping tests green

### Human Checkpoints

The system includes human review points to prevent:
- Runaway automated changes
- Infinite refactoring loops
- Coverage loss during refactoring
- Misaligned implementations

---

## Architecture

### Components

```
pairingbuddy/
├── .claude-plugin/plugin.json    # Register agents and skills
├── agents/                        # Plugin agents (16 total)
│   ├── classify-task.md
│   ├── enumerate-scenarios-and-test-cases.md
│   ├── create-test-placeholders.md
│   ├── implement-tests.md
│   ├── implement-code.md
│   ├── identify-test-issues.md
│   ├── refactor-tests.md
│   ├── identify-code-issues.md
│   ├── refactor-code.md
│   ├── verify-test-coverage.md
│   ├── scope-refactoring.md
│   ├── run-all-tests.md
│   ├── commit-changes.md
│   ├── setup-spike.md
│   ├── explore-spike-unit.md
│   └── summarize-spike.md
├── contracts/                     # Structure definitions and schemas
│   ├── agent-config.yaml         # Agent structure requirements (single source of truth)
│   ├── skill-config.yaml         # Skill + frontmatter requirements
│   ├── test-terminology.yaml     # Shared definitions for test-related agents
│   └── schemas/                  # JSON schemas for state contracts (19 total)
├── skills/                        # Skills (run in main context)
│   ├── coding/                   # Orchestrator skill
│   ├── using-pairingbuddy/       # Entry point skill
│   ├── writing-tests/            # Reference skill for test patterns
│   ├── writing-code/             # Reference skill for code implementation
│   ├── refactoring-code/         # Reference skill for refactoring
│   ├── enumerating-tests/        # Reference skill for test enumeration
│   └── committing-changes/       # Reference skill for git commits
├── commands/                      # Slash commands
│   └── code.md                   # Entry point: /pairingbuddy:code
├── tests/                         # Test suite (~500 tests)
│   ├── agents/                   # Agent structure and contract tests
│   ├── skills/                   # Skill structure tests
│   └── contracts/                # Test utilities
└── .pairingbuddy/                # Runtime state (gitignored)
    └── *.json                    # State files during workflow
```

### Orchestrator-Agent Pattern

The architecture follows a clear separation:

```
/pairingbuddy:code command
    ↓
coding skill (orchestrator - main context)
    ↓ (interprets Python pseudocode workflow)
    ↓
Task tool: pairingbuddy:<agent-name>
    ↓
Agent reads input JSON → performs operation → writes output JSON
    ↓
Orchestrator reads output, determines next step
    ↓
Repeat...
```

**Key constraints:**
- Skills can invoke agents (via Task tool)
- Agents cannot invoke other agents (by design)
- State passes through JSON files in `.pairingbuddy/`

### State Management

State files live in `.pairingbuddy/` at the git root of the target project:

| State File | Purpose | Schema |
|------------|---------|--------|
| task.json | User's coding task description | task.schema.json |
| task-classification.json | Classified task type | task-classification.schema.json |
| test-config.json | Test runner configuration (persists) | test-config.schema.json |
| human-guidance.json | Accumulated human feedback (per session) | human-guidance.schema.json |
| scenarios.json | Enumerated test scenarios | scenarios.schema.json |
| tests.json | Test file/function mappings | tests.schema.json |
| current-batch.json | Tests being processed | current-batch.schema.json |
| test-state.json | Results from implement-tests | test-state.schema.json |
| code-state.json | Results from implement-code | code-state.schema.json |
| test-issues.json | Test quality issues found | issues.schema.json |
| code-issues.json | Code quality issues found | issues.schema.json |
| files-changed.json | Files modified during refactoring | files-changed.schema.json |
| coverage-report.json | Test coverage verification | coverage-report.schema.json |
| all-tests-results.json | Final test suite results | all-tests-results.schema.json |
| commit-result.json | Git commit results | commit-result.schema.json |
| spike-config.json | Spike goal and exploration mode | spike-config.schema.json |
| spike-questions.json | Exploration units with execution config | spike-questions.schema.json |
| spike-findings.json | Accumulated findings per unit | spike-findings.schema.json |
| spike-summary.json | Reference to summary document | spike-summary.schema.json |
| current-unit.json | Current exploration unit being processed | current-unit.schema.json |

### Flow

The workflow is defined as Python pseudocode in the orchestrator skill. The orchestrator interprets this and invokes agents accordingly.

**New Feature Flow:**
```
task → classify_task → enumerate_scenarios_and_test_cases
                              ↓
                       create_test_placeholders
                              ↓
                       [for each test]
                          implement_tests (RED)
                              ↓
                          implement_code (GREEN)
                              ↓
                          identify_test_issues → refactor_tests
                              ↓
                          identify_code_issues → refactor_code
                              ↓
                       verify_test_coverage
                              ↓ (loop if gaps found)
                       run_all_tests
                              ↓
                       commit_changes
```

**Task Types:**
| Task Type | Description | Workflow |
|-----------|-------------|----------|
| **new_feature** | Adding new functionality | Full TDD with coverage verification loop |
| **bug_fix** | Fixing incorrect behavior | Regression test + fix |
| **refactoring** | Improving structure | Verify tests pass → scope → refactor → verify |
| **config_change** | Configuration only | Make change → verify tests pass |
| **spike** | Exploratory coding | Setup → explore units → summarize findings |

**Spike Flow:**
```
task → classify_task → setup_spike
                            ↓
                     [for each unit]
                        explore_spike_unit
                            ↓
                     (human checkpoint)
                            ↓
                     summarize_spike (optional)
```

The spike workflow is for exploratory coding without TDD - answering questions, comparing approaches, or evaluating technologies. Each exploration unit can have its own language/runtime configuration.

---

## Testing Philosophy

Pairing Buddy enforces a rigorous TDD philosophy for the projects it works on. This section describes the testing principles the system applies.

### RED-GREEN-REFACTOR Cycle

The Three Laws of TDD (Kent Beck):
1. **Don't write production code until you have a failing test**
2. **Don't write more test than sufficient to fail**
3. **Don't write more production code than sufficient to pass**

The cycle:
```
   RED                    GREEN                   REFACTOR
┌─────────┐           ┌─────────┐           ┌─────────────┐
│  Write  │    →      │ Write   │    →      │  Improve    │
│ failing │           │ minimal │           │   code      │
│  test   │           │  code   │           │  quality    │
└─────────┘           └─────────┘           └─────────────┘
     ↑                                            │
     └────────────────────────────────────────────┘
```

**RED Phase (implement-tests agent):**
- Test should fail because production code doesn't exist or doesn't match spec
- Verify tests fail for the RIGHT reason (feature not implemented, API missing)
- Wrong failures (syntax errors, import errors) indicate bad tests - fix and retry

**GREEN Phase (implement-code agent):**
- Write MINIMAL code to make tests pass
- No gold-plating, no refactoring (that comes later)
- If test seems impossible to satisfy, ask human operator

**REFACTOR Phase (identify-*-issues + refactor-* agents):**
- Improve code quality while keeping tests green
- Apply Clean Code principles, SOLID, remove smells
- Human checkpoint: continue, skip remaining, or stop

### Test Terminology

Pairing Buddy uses precise terminology for test organization:

| Term | Definition | Example | Granularity |
|------|------------|---------|-------------|
| **Scenario** | High-level what to test (a feature/behavior area) | "User can log in" | 1 per feature |
| **Test Case** | Specific condition to verify within a scenario | "Login with valid credentials succeeds" | Many per scenario |
| **Test** | Actual code that implements a test case | `def test_login_valid_credentials():` | 1+ per test case |

**Relationships:**
```
Scenario (1) → Test Cases (many) → Tests (1+ per test case)

Example:
Scenario: "Calculator addition"
├── Test Case: "Adding two positive numbers"
│   └── Test: test_add_positive_numbers()
├── Test Case: "Adding negative numbers"
│   └── Test: test_add_negative_numbers()
└── Test Case: "Overflow handling"
    └── Test: test_add_overflow()
```

This hierarchy enables:
- **Traceability**: Every test maps back to a test case and scenario
- **Coverage verification**: Compare implemented tests against enumerated scenarios
- **Gap analysis**: Identify missing test cases during coverage checks

### FIRST Principles

Every test should follow F.I.R.S.T.:

| Principle | Meaning | Implementation |
|-----------|---------|----------------|
| **Fast** | Milliseconds, not seconds | Use fakes, not real databases |
| **Independent** | No shared state between tests | Each test runs in isolation |
| **Repeatable** | Same result in any environment | Local, CI, offline |
| **Self-validating** | Pass/fail via assertions | No manual inspection needed |
| **Timely** | Written before production code | TDD practice |

### Four-Phase Test Structure

Every test follows: **Setup, Exercise, Verify, Teardown** (SEVT):

```python
def test_retries_failed_operations():
    # Setup
    attempts = []
    def operation():
        attempts.append(1)
        if len(attempts) < 3:
            raise ConnectionError("failed")
        return "success"

    # Exercise
    result = retry_operation(operation)

    # Verify
    assert result == "success"
    assert len(attempts) == 3

    # Teardown (implicit or explicit)
```

**Conventions:**
- Use blank lines to separate phases, not comments
- Name the System Under Test `sut` for easy identification
- One assertion concept per test (ideally)

### Test Status Verification

The implement-tests agent verifies tests fail/pass for the RIGHT reason:

| Status | Meaning | Expected When |
|--------|---------|---------------|
| `failing_correctly` | Feature not implemented, code path missing, API doesn't exist | RED phase (good) |
| `failing_wrong_reason` | Syntax error, import error, unexpected exception | Bad test, needs fix |
| `passing` | Test passes | GREEN phase, or unexpected in RED |
| `error` | Test could not run at all | Runner error, environment issue |

**Critical:** A test failing for the wrong reason is not progress - it's a bug in the test.

---

## Testing Strategy for Pairing Buddy Itself

Pairing Buddy was built using BDD/TDD, outside-in development, with a focus on structure and contracts rather than behavior.

### BDD Approach: Outer to Inner

**Philosophy:**
- Write tests first, see them fail, implement minimum to pass
- Start with orchestrator (outer), then sub-agents (inner)
- Focus on structure + contracts (not behavior)

**BDD Order (Outer to Inner):**
```
Outer Layer: Orchestrator Tests
     ↓
     Agent Structure Tests
     ↓
     JSON Schema Tests
     ↓
Inner Layer: Workflow Logic Tests
```

Start with the outermost boundary (orchestrator) and progressively work inward to agents and schemas. Each layer is tested before moving to the next.

### The Test Layers Pyramid

Pairing Buddy's testing strategy uses a custom "pyramid" based on **validation layers**, not the classic unit/integration/E2E pyramid:

```
            /\
           /  \     Workflow Layer
          /----\    (References resolve to registered agents)
         /      \
        /--------\   Schema Sync Layer
       /          \  (Agent inline schemas = canonical schemas)
      /------------\
     /              \ Schemas Layer
    /----------------\ (JSON schemas valid, version pinned)
   /                  \
  /--------------------\ Plugin Layer
 /                      \ (plugin.json references valid files)
/________________________\
                          Structure Layer
                          (Files exist, valid frontmatter, sections in order)
```

| Layer | What It Validates | How |
|-------|-------------------|-----|
| **Structure** | Files exist, valid frontmatter, sections in order | YAML parsing, section detection |
| **Plugin** | plugin.json references valid files | Path existence checks |
| **Schemas** | JSON schemas valid, version pinned | jsonschema validation |
| **Schema Sync** | Agent inline schemas = canonical schemas | Verbatim comparison |
| **Workflow** | References resolve to registered agents | AST parsing |

**Why this approach?**
- Agents are LLM-driven - testing their "behavior" isn't deterministic
- Structure is deterministic and validates the system can be assembled correctly
- Call order is implicitly validated by data flow - each agent's input must come from a prior agent's output

### Contract-Driven Development

Every agent has explicit input/output schemas defined in `agent-config.yaml`:

```yaml
implement-tests:
  inputs:
    current_batch:
      schema: current-batch.schema.json
      file: .pairingbuddy/current-batch.json
    test_config:
      schema: test-config.schema.json
      file: .pairingbuddy/test-config.json
  outputs:
    test_state:
      schema: test-state.schema.json
      file: .pairingbuddy/test-state.json
```

**Benefits:**
- Agents are self-documenting
- Contracts are testable
- State flow is explicit
- Debugging is easier (inspect JSON files)

### Test Catalog

**Orchestrator Tests:**
| Test | What It Validates |
|------|-------------------|
| `test_orchestrator_exists` | Skill file exists at expected path |
| `test_orchestrator_frontmatter` | Valid YAML, required fields (name, description) |
| `test_orchestrator_sections` | Has required sections in order |
| `test_workflow_is_valid_python` | Workflow section parses as Python |
| `test_workflow_references_resolve` | Function calls map to agents in agent-config.yaml |

**Agent Tests:**
| Test | What It Validates |
|------|-------------------|
| `test_agent_exists` | Each agent file exists and registered in plugin.json |
| `test_agent_frontmatter` | Valid YAML, required fields (name, description, model, color) |
| `test_agent_sections_order` | Has sections in order: Purpose, Input, Instructions, Output |
| `test_agent_color_matches_config` | Agent color matches expected value from config |
| `test_agent_model_matches_config` | Agent model matches expected value from config |
| `test_agent_skills_match_config` | Agent skills match expected list from config |
| `test_agent_skill_references_resolve` | Agent skills reference existing skill directories |
| `test_agent_schemas_match` | Agent inline schemas match canonical schema files |
| `test_agent_definitions_match` | Test terminology consistent across agents |
| `test_agent_section_content_matches_canonical` | Canonical content (focus_warning, human_review) matches config |

**Schema Tests:**
| Test | What It Validates |
|------|-------------------|
| `test_schema_valid` | Schema files are valid JSON Schema |
| `test_schema_version` | Schema declares expected $schema version |
| `test_plugin_json_files_exist` | All agent/skill paths in plugin.json point to existing files |

**Skill Tests:**
| Test | What It Validates |
|------|-------------------|
| `test_skill_frontmatter` | Skill frontmatter validates against schema |
| `test_skill_sections` | Skill has required sections per category |
| `test_skill_directories` | Skill directories validate against schema |
| `test_file_references_exist` | All markdown links point to existing files |
| `test_skill_references_valid` | All skill references are valid |

### What We Test vs What We Don't

| What We Test | How |
|--------------|-----|
| Structure | Files exist, valid frontmatter, sections in order |
| Plugin | plugin.json references valid files |
| Schemas | JSON schemas valid, version pinned |
| Schema Sync | Agent inline schemas = canonical schemas |
| Workflow | References resolve to registered agents |
| Definitions | Terminology consistent across test-related agents |
| Human Review | Review content consistent across applicable agents |

| What We DON'T Test | Why |
|--------------------|-----|
| Agent behavior | LLM-driven, not deterministic |
| Call order | Implicitly validated by data flow |
| Mock execution | Deferred - real validation happens at integration |

**Note on data flow validation:** If agent A outputs `scenarios.json` and agent B expects `scenarios.json` as input, correct operation of the workflow implies correct ordering. This is validated at runtime, not through unit tests.

---

## What is Implemented

### Agents

| Agent | Phase | Purpose | Skills |
|-------|-------|---------|--------|
| classify-task | Pre | Determine task type (new feature, bug fix, refactoring, config) | - |
| enumerate-scenarios-and-test-cases | Pre | Analyze requirements, output scenario/test case tree | enumerating-tests |
| create-test-placeholders | Pre | Create test files with placeholder tests | writing-tests |
| implement-tests | RED | Replace placeholders with real failing tests | writing-tests |
| implement-code | GREEN | Write minimal code to pass tests | writing-code |
| identify-test-issues | REFACTOR | Find test quality issues | writing-tests |
| refactor-tests | REFACTOR | Fix test issues | writing-tests, refactoring-code |
| identify-code-issues | REFACTOR | Find code quality issues | refactoring-code |
| refactor-code | REFACTOR | Fix code issues | refactoring-code |
| verify-test-coverage | VERIFY | Check coverage against scenarios | writing-tests |
| scope-refactoring | REFACTOR | Translate refactoring intent to issues | refactoring-code |
| run-all-tests | VERIFY | Final verification of test suite | - |
| commit-changes | COMMIT | Create git commit with changes | committing-changes |
| setup-spike | SPIKE | Clarify goal, determine exploration units | - |
| explore-spike-unit | SPIKE | Explore one unit, capture findings | - |
| summarize-spike | SPIKE | Create summary document from findings | - |

**Color coding follows TDD phases:**
- Cyan: Setup/classification
- Magenta: Analysis/verification
- Yellow: Issue identification
- Red: Failing tests (RED phase)
- Green: Passing tests (GREEN phase)
- Blue: Refactoring

### Skills

| Skill | Category | Purpose |
|-------|----------|---------|
| coding | Orchestrator | Main workflow orchestration |
| using-pairingbuddy | Entry | Entry point, establishes mandatory workflows |
| writing-tests | Reference | Test patterns, FIRST principles, anti-patterns |
| writing-code | Reference | SOLID, Clean Code, minimal code approach |
| refactoring-code | Reference | Code smells, refactoring techniques |
| enumerating-tests | Reference | Test scenario enumeration patterns |
| committing-changes | Reference | Git commit best practices |

**Reference skills provide progressive disclosure:**
```
skills/writing-tests/
├── SKILL.md           # Quick reference + TOC
├── reference.md       # Detailed patterns
├── anti-patterns.md   # What to avoid
└── python.md          # Python/pytest specifics
```

### JSON Schemas

19 JSON schemas define state contracts (all in `contracts/schemas/`):
- task.schema.json
- task-classification.schema.json
- test-config.schema.json
- human-guidance.schema.json
- scenarios.schema.json
- tests.schema.json
- current-batch.schema.json
- test-state.schema.json
- code-state.schema.json
- issues.schema.json
- files-changed.schema.json
- coverage-report.schema.json
- all-tests-results.schema.json
- commit-result.schema.json
- spike-config.schema.json
- spike-questions.schema.json
- spike-findings.schema.json
- spike-summary.schema.json
- current-unit.schema.json

---

## Extensibility

### Design for Extension

The WHAT vs HOW separation enables extensibility without modifying agents:

**Current state:**
```
Agent (WHAT)           →    Skill (HOW)
implement-tests.md     →    writing-tests/python.md
```

**Extended state:**
```
Agent (WHAT)           →    Skill (HOW)
implement-tests.md     →    writing-tests/python.md
                       →    writing-tests/java.md (new)
                       →    writing-tests/javascript.md (new)
```

### Adding Language/Framework Support

To add support for a new language (e.g., Java):

1. **Add language-specific skill file:**
   ```
   skills/writing-tests/java.md
   ```

2. **Update SKILL.md Contents section:**
   ```markdown
   ## Contents
   - [Python & pytest](./python.md)
   - [Java & JUnit](./java.md)  # NEW
   ```

3. **No agent changes required** - agents describe WHAT, skills provide HOW.

**Language-specific files include:**
- Placeholder syntax (e.g., `pytest.fail("TODO: ...")` vs `throw new Error("TODO: ...")`)
- Naming conventions (e.g., `test_` prefix, file patterns)
- File organization (e.g., one file per scenario, folder structure)
- Framework-specific patterns

### Future Extensions

**Planned skills (to migrate from superpowers):**
- brainstorming - Refine ideas through collaborative questioning
- executing-plans - Execute plans in batches with checkpoints
- writing-plans - Create detailed implementation plans
- using-git-worktrees - Isolated feature development

**Planned features:**
- Legacy code test coverage skill
- Batch RED-GREEN execution for performance
- YAML state files (optimization)
- Item-by-item human review (vs whole-list)

**Potential extensions:**
- Design pattern recognition and application
- Architecture-aware test generation
- Performance testing integration
- Security testing patterns
- Domain-specific testing strategies (e.g., robotics, avionics)

---

## Key Design Decisions

### 1. Flat Agent Structure

**Problem:** Previous nested skill structure had 4+ levels of indirection, causing slowness and erratic behavior.

**Solution:** Self-contained agents that communicate via JSON state files. Each agent reads input JSON, performs one atomic operation, writes output JSON.

### 2. Python Pseudocode for Workflows

The orchestrator defines workflow as valid Python code:
```python
scenarios = enumerate_scenarios_and_test_cases(task, test_config)
tests = create_test_placeholders(scenarios, test_config, gaps)
for test in _filter_pending(tests):
    current_batch = [test]
    test_state = implement_tests(current_batch, test_config)
    # ...
```

**Benefits:**
- Parseable logic (not just prose)
- Testable with mocks
- Executable documentation
- Claude can interpret and execute the flow

### 3. Convention Over Configuration

Function names in pseudocode map directly to agent names:
- `enumerate_scenarios_and_test_cases()` → agent `enumerate-scenarios-and-test-cases`
- Underscores in Python → hyphens in agent names

### 4. Single Source of Truth

Configuration lives in `contracts/`:
- `agent-config.yaml` - Agent structure, colors, models, sections, schemas
- `skill-config.yaml` - Skill structure requirements
- `test-terminology.yaml` - Shared definitions across agents

Tests validate that implementations match these contracts.

### 5. Agent Focus and Human Review

**Focus Warning:** All 16 agents include a "laser-focused" warning in their Instructions section to prevent agents from anticipating next steps or doing work that belongs to other agents. This warning is defined canonically in `agent-config.yaml` and tested for verbatim presence.

**Human Review Checkpoints:** Eight agents pause for human review before proceeding:
1. enumerate-scenarios-and-test-cases
2. create-test-placeholders
3. identify-test-issues
4. identify-code-issues
5. verify-test-coverage
6. scope-refactoring
7. setup-spike
8. explore-spike-unit

**Pattern:**
1. Agent completes analysis
2. Presents bullet-point list to human
3. Human approves or provides modifications
4. If modifications: agent appends feedback to `human-guidance.json`
5. Agent writes JSON only after approval

**Feedback persistence:** When the human provides corrections, agents append the feedback to `human-guidance.json`. All agents read this file as input, so corrections given to one agent are visible to all subsequent agents. This prevents the human from having to repeat the same guidance across multiple agents.

### 6. Test Config Persistence

`test-config.json` persists across tasks (not cleaned up). It contains project-specific test runner configuration that shouldn't be re-inferred each time.

**Why this matters:**
- Without explicit test commands, agents default to broken assumptions (e.g., `python` instead of `uv run`, missing `--env-file`)
- Test configuration is project-specific, not task-specific
- Human validates once, reuses many times

---

## References

- [Claude Code Plugin Documentation](https://code.claude.com/docs/en/sub-agents)
- [Claude Agent Skills Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude 4 Prompt Engineering](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices)
- [xUnit Test Patterns](https://xunitpatterns.com/) - Four-Phase Test, SUT convention
- [Clean Code (Robert C. Martin)](https://www.oreilly.com/library/view/clean-code-a/9780136083238/) - SOLID, code smells
- [Test-Driven Development (Kent Beck)](https://www.oreilly.com/library/view/test-driven-development/0321146530/) - RED-GREEN-REFACTOR

---

*Built by [Alberto Prieto Löfkrantz](https://albertoprietolofkrantz.dev/)*
