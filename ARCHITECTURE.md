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
- [Solo Mode](#solo-mode)
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
├── agents/                        # Plugin agents (36 total: TDD/spike, design-ux, planning and PR drafting)
│   ├── curate-guidance.md
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
│   ├── update-documentation.md
│   ├── commit-changes.md
│   ├── draft-pull-request.md      # Sonnet; writes the PR body
│   ├── setup-spike.md
│   ├── explore-spike-unit.md
│   ├── document-spike.md
│   ├── brainstorm-requirements.md
│   ├── solidify-architecture.md
│   ├── decompose-tracer-bullets.md
│   ├── sequence-tasks.md
│   ├── design-ux-explorer.md
│   ├── design-ux-architect.md
│   ├── design-ux-token-generator.md
│   ├── design-ux-visual-builder.md
│   ├── design-ux-critic.md
│   ├── design-ux-validator.md
│   └── design-ux-gallery-generator.md
├── contracts/                     # Structure definitions and schemas
│   ├── agent-config.yaml         # Agent structure requirements (single source of truth)
│   ├── skill-config.yaml         # Skill + frontmatter requirements
│   ├── test-terminology.yaml     # Shared definitions for test-related agents
│   └── schemas/                  # JSON schemas for state contracts (63 total)
├── skills/                        # Skills (run in main context)
│   ├── coding/                   # TDD orchestrator skill
│   ├── planning/                 # Planning orchestrator skill
│   ├── designing-ux/             # Design UX orchestrator skill
│   ├── using-pairingbuddy/       # Entry point skill
│   ├── writing-tests/            # Reference: test patterns
│   ├── writing-code/             # Reference: code implementation
│   ├── refactoring-code/         # Reference: refactoring
│   ├── enumerating-tests/        # Reference: test enumeration
│   ├── committing-changes/       # Reference: git commits
│   ├── creating-pull-requests/   # Reference: stand-alone PR bodies
│   ├── setting-up-spike/         # Reference: spike setup (goal, units, code location)
│   ├── curating-guidance/        # Conversational: curates human guidance in main (non-Solo, non-plan tasks)
│   ├── decomposing-tracer-bullets/ # Reference: tracer bullet methodology
│   ├── sequencing-tasks/         # Reference: task sequencing for TDD
│   ├── differentiating-designs/  # Reference: design differentiation
│   ├── applying-design-principles/ # Reference: UX principles
│   ├── critiquing-designs/       # Reference: design critique
│   ├── building-components/      # Reference: component patterns
│   ├── generating-design-previews/ # Reference: preview templates
│   └── generating-exploration-gallery/ # Reference: gallery templates
├── commands/                      # Slash commands
│   ├── code.md                   # Entry point: /pairingbuddy:code
│   ├── plan.md                   # Entry point: /pairingbuddy:plan
│   └── design-ux.md              # Entry point: /pairingbuddy:design-ux
├── tests/                         # Test suite (~1121 tests)
│   ├── agents/                   # Agent structure and contract tests
│   ├── skills/                   # Skill structure tests
│   └── contracts/                # Test utilities
├── hooks/                        # Claude Code hooks
│   ├── hooks.json               # Hook registration (SessionStart, PostToolUse)
│   ├── session-start.mjs        # Injects using-pairingbuddy skill at session start
│   ├── guardian.mjs             # Session drift guardian (time-based workflow reminder)
│   └── solo-progress.mjs       # Solo mode progress tracker (async PostToolUse hook)
└── .pairingbuddy/                # Runtime state (gitignored)
    ├── *.json                    # TDD state files during workflow
    ├── solo-status               # Solo mode current progress (plain text, overwritten)
    ├── solo-progress.log         # Solo mode progress history (append-only, timestamped)
    ├── hooks/                    # Hook state (injection timestamps per session)
    ├── plan/                     # Planning state (isolated from /code cleanup)
    │   ├── plan-config.json      # Persists across plans
    │   ├── plan-requirements.json
    │   ├── plan-architecture.json
    │   └── plan-tracer-bullets.json
    └── design-ux/                # Design UX state (per exploration)
        └── {name}/*.json
```

### Orchestrator-Agent Pattern

The architecture follows a clear separation:

```
/pairingbuddy:code or /pairingbuddy:plan or /pairingbuddy:design-ux command
    ↓
orchestrator skill (coding, planning, or designing-ux - main context)
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
- TDD state passes through JSON files in `.pairingbuddy/`
- Plan state passes through JSON files in `.pairingbuddy/plan/`
- Design UX state passes through JSON files in `.pairingbuddy/design-ux/{name}/`

### Session Drift Guardian

Long Claude Code sessions tend to drift — the session agent starts skipping workflow steps, doing agent work in the main context, or rationalizing its way out of following the pseudocode. The guardian is a hook-based mechanism that periodically re-injects a workflow compliance reminder.

**How it works:**
- `PostToolUse` hook fires after every tool call (the universal activity heartbeat)
- If 5+ minutes have elapsed since the last injection, the guardian injects the reminder
- After context compaction (`SessionStart:compact`), always inject — instructions may have been lost
- No injection during idle periods (event-driven, no polling, no token waste)

**State:** Injection timestamps are stored per session in `.pairingbuddy/hooks/{session-id}.json`.

**Design constraints:**
- The guardian runs as an external process, not controllable by the session agent
- No activation signal needed — injects regardless of whether a workflow is active (the cost is 4 lines of harmless text)
- Time-based, not count-based — adapts naturally to both rapid agent bursts and slow interactive sessions

### Git and gh Guard (D17)

The gate hook (`hooks/gate.mjs`) denies git and gh calls in Bash commands by run state and caller. The rules are data plus a pure classifier in `shared-node/d17.mjs` (`D17_TABLE`, `classify`, `decide`, `d17Denial`). `shared-node/shell-calls.mjs` reads the command and `shared-node/git-files.mjs` reads git state.

| Caller and state | Rule |
|------------------|------|
| Subagent, run or unit open | Read-only git/gh allowlist, plus the table's single-file checkout/restore/switch forms and branch creation. Everything else is denied, plumbing included. |
| Main context, run open | The table's denylist: push outside `pb publish`, `gh pr create/merge/edit`, no-revert commands, branch switching while a unit is open, and plumbing equivalents. |
| Subagent, no run | No push to a protected or unresolvable target, no force. |
| Main context, no run | Unrestricted. The guard imports nothing new on this path. |

**Shell reader.** It handles heredocs, ANSI-C (`$'...'`) quoting, git global options, `gh -R` anywhere, and `cd`, `-C`, `--git-dir` and `GIT_DIR` targets. It re-reads commands passed to `watch`, `git rebase -x`, `git bisect run`, `git submodule foreach` and `script -c`.

**Git state as files.** Hooks never call git. They read HEAD, config and refs as plain files, including linked worktrees. A reftable repo reads as "unknown".

**Fail closed.** Write and Edit into `.git` are denied while a run exists. If the guard's modules fail to import, subagents are denied.

**Accepted gaps** (Section 8): built command words, `${IFS}` splitting, aliases and scripts in config, and commits made without `git commit`.

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
| doc-config.json | Documentation locations (persists) | doc-config.schema.json |
| docs-updated.json | Documentation updates made | docs-updated.schema.json |

**Planning state files** (in `.pairingbuddy/plan/`):

| State File | Purpose | Schema |
|------------|---------|--------|
| plan-config.json | Plan name, output path, existing docs (persists) | plan-config.schema.json |
| plan-requirements.json | Structured requirements from brainstorming | plan-requirements.schema.json |
| plan-architecture.json | Architectural context and decisions | plan-architecture.schema.json |
| plan-tracer-bullets.json | Tracer bullet decomposition | plan-tracer-bullets.schema.json |

**Design UX state files** (in `.pairingbuddy/design-ux/{name}/`):

| State File | Purpose | Schema |
|------------|---------|--------|
| session.json | Active explorations and gallery config | design-session.schema.json |
| direction.json | Design brief and constraints | design-direction.schema.json |
| domain-spec.json | Domain grounding and design intent | domain-spec.schema.json |
| design-decisions.json | Architecture decisions (layout, color, typography) | design-decisions.schema.json |
| tokens-generated.json | Token generation status | tokens-generated.schema.json |
| config.json | Design system configuration | design-system-config.schema.json |
| critique.json | Design evaluation results | design-critique.schema.json |
| validation.json | Structural validation results | design-validation.schema.json |
| gallery-output.json | Gallery generation output | gallery-output.schema.json |

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
| **spike** | Exploratory coding | Setup → explore units → document findings |

**Spike Flow:**
```
task → classify_task → setup_spike
                            ↓
                     [for each unit]
                        explore_spike_unit
                            ↓
                     (human checkpoint)
                            ↓
                     document_spike (mandatory)
```

The spike workflow is for exploratory coding without TDD - answering questions, comparing approaches, or evaluating technologies. Each exploration unit can have its own language/runtime configuration.

**Design UX Flow:**
```
/pairingbuddy:design-ux → designing-ux orchestrator
                                ↓
                         design_ux_explorer (domain grounding)
                                ↓
                         design_ux_architect (design decisions)
                                ↓
                         design_ux_token_generator (three-tier tokens)
                                ↓
                         design_ux_visual_builder (preview + example HTML)
                                ↓
                         design_ux_critic (6-pass evaluation)
                                ↓ (iterate if issues found)
                         design_ux_validator (structural validation)
                                ↓
                         design_ux_gallery_generator (comparison gallery)
```

The design UX workflow creates production-ready design systems with three-tiered token architecture (global → alias → component). It supports parallel explorations with isolated state per exploration, Playwright-based visual feedback, and web-hostable output.

**Plan Flow:**
```
/pairingbuddy:plan → planning orchestrator
                          ↓
                   brainstorm_requirements (adaptive Socratic exploration)
                          ↓ [human checkpoint]
                   solidify_architecture (create/update arch docs)
                          ↓ [human checkpoint]
                   decompose_tracer_bullets (thin E2E slices)
                          ↓ [human checkpoint]
                   sequence_tasks (rich task descriptions, writes plan MD)
                          ↓ [human checkpoint]
                   Plan complete → human points /code at plan MD
```

The planning workflow produces a markdown plan document with checkboxes ready for `/code` execution. Each task is self-contained with goal, acceptance criteria, and context links. Plan state lives in `.pairingbuddy/plan/`, isolated from `/code`'s cleanup.

**Plan Execution Flow (via `/code`):**
```
/pairingbuddy:code (with plan MD path)
    ↓
_detect_plan_file → _read_plan_tasks → _hydrate_claude_tasks
    ↓
[for each unchecked task]
    Write task.json → normal TDD workflow
        ↓
    _mark_task_complete (update MD checkbox)
        ↓
    _update_claude_task (mark visible task done)
        ↓
    [human checkpoint between tasks]
```

When `/code` receives a plan MD file, it enters plan execution mode: iterates through unchecked tasks, runs the TDD workflow for each, updates checkboxes, and provides visibility via Claude Code Tasks. Cross-session recovery reads the MD checkboxes to determine progress.

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
| curate-guidance | Pre | Curate human guidance for carry-over between tasks | - |
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
| update-documentation | DOCS | Analyze changes, update docs | - |
| commit-changes | COMMIT | Create git commit with changes | committing-changes |
| setup-spike | SPIKE | Clarify goal, determine exploration units | - |
| explore-spike-unit | SPIKE | Explore one unit, capture findings | - |
| document-spike | SPIKE | Document all findings, persist to human-specified location | - |
| brainstorm-requirements | PLAN | Adaptive Socratic exploration of requirements | decomposing-tracer-bullets |
| solidify-architecture | PLAN | Analyze/create/update architecture documents | - |
| decompose-tracer-bullets | PLAN | Decompose into thin E2E tracer bullet slices | decomposing-tracer-bullets |
| sequence-tasks | PLAN | Sequence tasks within TBs, write plan MD | sequencing-tasks |
| design-ux-explorer | DESIGN | Establish domain grounding and design intent | differentiating-designs |
| design-ux-architect | DESIGN | Make strategic layout, color, component, typography decisions | differentiating-designs, applying-design-principles |
| design-ux-token-generator | DESIGN | Generate three-tier token architecture | - |
| design-ux-visual-builder | DESIGN | Create preview.html and example.html with Playwright feedback | differentiating-designs, applying-design-principles, building-components, generating-design-previews |
| design-ux-critic | DESIGN | Evaluate designs using 6-pass framework | differentiating-designs, critiquing-designs, applying-design-principles |
| design-ux-validator | DESIGN | Validate structural correctness of design artifacts | - |
| design-ux-gallery-generator | DESIGN | Create web-hostable gallery for comparing explorations | generating-exploration-gallery |

**Color coding follows workflow phases:**
- Cyan: Setup/classification (classify-task, brainstorm-requirements, design-ux-explorer, design-ux-gallery-generator)
- Magenta: Analysis/verification (enumerate-scenarios, verify-coverage, solidify-architecture, design-ux-architect)
- Yellow: Issue identification/decomposition (identify-*-issues, decompose-tracer-bullets, design-ux-critic)
- Red: Failing tests (RED phase)
- Green: Passing tests/output (GREEN phase, sequence-tasks, design-ux-token-generator, design-ux-validator)
- Blue: Refactoring (refactor-*, design-ux-visual-builder)

### Skills

| Skill | Category | Purpose |
|-------|----------|---------|
| coding | Orchestrator | TDD workflow orchestration (with plan execution mode) |
| planning | Orchestrator | Tracer bullet planning workflow orchestration |
| designing-ux | Orchestrator | Design system and UX workflow orchestration |
| using-pairingbuddy | Entry | Entry point, establishes mandatory workflows |
| writing-tests | Reference | Test patterns, FIRST principles, anti-patterns |
| writing-code | Reference | SOLID, Clean Code, minimal code approach |
| refactoring-code | Reference | Code smells, refactoring techniques |
| enumerating-tests | Reference | Test scenario enumeration patterns |
| committing-changes | Reference | Git commit best practices |
| decomposing-tracer-bullets | Reference | Tracer bullet methodology and thin E2E slicing |
| sequencing-tasks | Reference | Task sequencing for TDD-ready plans |
| differentiating-designs | Reference | Craft knowledge for intentional differentiation |
| applying-design-principles | Reference | Laws of UX, Norman's principles, specifications |
| critiquing-designs | Reference | 6-pass UX critique framework |
| building-components | Reference | Component patterns and domain packs |
| generating-design-previews | Reference | Preview and example HTML templates |
| generating-exploration-gallery | Reference | Gallery and comparison HTML templates |

**Reference skills provide progressive disclosure:**
```
skills/writing-tests/
├── SKILL.md           # Quick reference + TOC
├── reference.md       # Detailed patterns
├── anti-patterns.md   # What to avoid
└── python.md          # Python/pytest specifics
```

### JSON Schemas

64 JSON schemas define state contracts (all in `contracts/schemas/`):

**TDD/Spike schemas (21):**
- task.schema.json, task-classification.schema.json
- test-config.schema.json, human-guidance.schema.json
- scenarios.schema.json, tests.schema.json, current-batch.schema.json
- test-state.schema.json, code-state.schema.json
- issues.schema.json, files-changed.schema.json
- coverage-report.schema.json, all-tests-results.schema.json, commit-result.schema.json
- spike-config.schema.json, spike-questions.schema.json, spike-findings.schema.json
- spike-summary.schema.json, current-unit.schema.json
- doc-config.schema.json, docs-updated.schema.json

**Workflow schemas (25):**
- ledger.schema.json, unit.schema.json, git-config.schema.json
- lens-result.schema.json, light-review-result.schema.json, refuter-verdict.schema.json
- synthesis-result.schema.json, course-verdict.schema.json, runner-result.schema.json
- classify-task-result.schema.json, scope-refactoring-result.schema.json
- apply-config-change-result.schema.json, create-test-placeholders-result.schema.json
- enumerate-scenarios-and-test-cases-result.schema.json, explore-spike-unit-result.schema.json
- document-spike-result.schema.json, draft-pull-request-result.schema.json
- identify-code-issues-result.schema.json, identify-test-issues-result.schema.json
- implement-code-result.schema.json, implement-tests-result.schema.json
- refactor-code-result.schema.json, refactor-tests-result.schema.json
- update-documentation-result.schema.json, verify-test-coverage-result.schema.json

**Planning schemas (4):**
- plan-config.schema.json, plan-requirements.schema.json
- plan-architecture.schema.json, plan-tracer-bullets.schema.json

**Design UX schemas (14):**
- domain-spec.schema.json, design-direction.schema.json, design-brief.schema.json
- design-decisions.schema.json, design-critique.schema.json, design-validation.schema.json
- design-session.schema.json, design-system-config.schema.json
- design-experience-config.schema.json, design-artifacts.schema.json
- tokens-generated.schema.json, exploration-status.schema.json
- gallery-output.schema.json, brand.schema.json

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

**Planned skills:**
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

**Focus Warning:** All 36 agents include a "laser-focused" warning in their Instructions section to prevent agents from anticipating next steps or doing work that belongs to other agents. This warning is defined canonically in `agent-config.yaml` and tested for verbatim presence.

**Human Review Checkpoints:** Fourteen TDD/spike/planning agents pause for human review before proceeding (design-ux agents use orchestrator-level human interaction instead):
1. curate-guidance
2. enumerate-scenarios-and-test-cases
3. create-test-placeholders
4. identify-test-issues
5. identify-code-issues
6. verify-test-coverage
7. scope-refactoring
8. update-documentation
9. setup-spike
10. explore-spike-unit
11. brainstorm-requirements
12. solidify-architecture
13. decompose-tracer-bullets
14. sequence-tasks

**Workflow Pattern (Step 1-4):**

All agents with human review follow an explicit 4-step workflow in their Instructions section:

| Step | Purpose |
|------|---------|
| **Step 1: Read Inputs** | Read all input JSON files, always including `human-guidance.json`. Apply prior guidance. |
| **Step 2: Main Work** | Agent-specific analysis (enumerate scenarios, identify issues, etc.) |
| **Step 3: Human Review** | Present findings, ask for approval. If feedback, go back to Step 2. |
| **Step 4: Output** | Write JSON output only after explicit approval. |

**Review Loop:**
1. Agent presents findings and asks for approval
2. If human provides feedback:
   - Agent **immediately** appends to `human-guidance.json`
   - Agent redoes Step 2 with the new guidance
   - Agent presents revised findings and asks again
3. Loop continues until human explicitly approves or terminates

**Critical:** Agents do NOT proceed to output after receiving feedback - they must redo their analysis and present again. This ensures human corrections are actually applied.

**Feedback persistence:** When the human provides corrections, agents append the feedback to `human-guidance.json`. All agents read this file as input (Step 1), so corrections given to one agent are visible to all subsequent agents. This prevents the human from having to repeat the same guidance across multiple agents.

### 6. State File Cleanup and Persistence

At the start of each task, the orchestrator runs `_cleanup_state_files()` to delete stale state from previous tasks. This happens after `curate_guidance`, which reads the just-completed task from `task.json`, and before the new task is written and `classify_task` reads it. None of it happens when a run is already open: the coding skill reports the run's next action instead.

**Files that persist across tasks:**
| File | Why It Persists |
|------|-----------------|
| `test-config.json` | Project-specific test runner configuration |
| `doc-config.json` | Documentation locations |
| `git-config.json` | Git rules for the run (D21); never overwritten once it exists |
| `human-guidance.json` | Persistent operational knowledge (entries with `persistent: true`) |
| `reports/` (folder) | HTML run reports written by the progress mod; kept across task cleanup |

**Unit record and unit open.** `shared-node/unit.mjs` owns `.pairingbuddy/run/unit.json` (schema: `contracts/schemas/unit.schema.json`), the record of the unit of work: type, slug, branch and the task records appended by `pb task end` (skipped when no unit is open). `pb unit open --type --slug` refuses a dirty tree, an open unit, and an existing, protected or invalid branch name; it fetches, branches from `pr.base_branch` or the remote default, and writes the record. `pb run open` on a protected branch points at `pb unit open`. **No confirm step.** `pb unit open` asks nobody to confirm: a plain call opens the template branch, and `--branch <name>` names another. `--yes` is refused as an unknown flag, so a stale caller learns. The gate has no rule for it, since only a fresh, unprotected, valid branch name can be created. **Git doctor.** `pb git doctor` (`shared-node/git-doctor.mjs`) makes read-only `gh` calls with a 10s timeout and only warns, never blocks: squash merges must use the PR title and body (`squash_merge_commit_title`/`_message` set to `PR_TITLE`/`PR_BODY`), and the default branch should be protected; it notes when `gh` is unavailable or protection can't be read, and `pb unit open` shows the same warnings.

**Git configuration (D21).** `shared-node/gitconf.mjs` reads and bootstraps `.pairingbuddy/git-config.json` (schema: `contracts/schemas/git-config.schema.json`). `pb run open` writes it with defaults when it is missing, never overwrites an existing one, and refuses to open a run when it is malformed. Protected branches are the configured ones plus the remote's default branch; the hard-coded `main`/`master` are gone, and `pr.base_branch` falls back to the default branch. The file's hash is recorded in the ledger as `gitConfigHash`; each gate check compares it, so editing the file mid-run stops the next gate check.

**PR draft.** The `pr-draft` stage (`workflows-src/stages/pr-draft.mjs`, built to `workflows/pr-draft.js`) runs the `draft-pull-request` agent (Sonnet, with the `creating-pull-requests` skill) to write a stand-alone PR body meant for main's log; notes that only matter while the PR is open go to a coordination comment instead. The tap writes the body to `.pairingbuddy/run/pr-body.md`. After the writer, the stage runs `pb pr lint`, a model-free check of the title and body (title form and length, a size budget that grows with the diff, attribution trailers and tool footers, hype, file inventories, expiring text, a word cap, stock AI phrases) against `contracts/pr-lint.json`, extended or overridden by git-config `pr.lint` (lists extend, numbers replace). It writes `run/pr-lint.json` with the body hash. **Claims and permanence (Task 84b).** The stage runs the lint before any lens: `pb snapshot`, then `pb pr lint`. A lint relay that is not a readable verdict stops the stage as step-failed. A failed lint spawns no lens: its failures become findings (`lint-<n>`, where `pr-body.md`) for the fix loop in artifact mode, where `draft-pull-request` redrafts the last good draft (role `fix`, given its path as `draft`) and each redraft is linted again; the lint alone judges a lint redraft, with no course checker. Once the lint passes, the two Sonnet lenses of the pr-draft row run with no refuters (the row's `wiresAll` wires both, and each lens's `brief` reaches its prompt): `claims` checks the title and body against the unit diff and the recorded runs in `unit.json`, and `permanence` reads them as `git log` on main a year from now. Their subject is the paths of `run/pr-body.md`, the last good draft, `run/unit.json` and `run/subject.diff`. A lens finding's redraft is linted, then course-checked. A failed lint or a bad verdict runs `pb rollback --artifact`, which on pr-draft accepts a failed lint for that redraft's own body in place of a verdict and puts the last good draft's body back in `run/pr-body.md`. Both loops share the stage's cap of 5 rolled-back attempts (counted from the snapshot's `rolledBack`), its note, its fix-key rounds and its agent budget; at the cap the stage stops with `attempt-cap` before `G:publish`. The closing runner re-runs `pb pr lint` and `pb stage finish`, so `run/pr-lint.json` speaks for the body that stands. The tap files a redraft like the first draft and writes its body to `run/pr-body.md`; `pb pr lint`, gate eval and the publish binding read the newest standing draft. The stage is wired into the `publish` task-type graph (see below).

**Lens attack (T5a).** `contracts/lenses.json` maps each stage row to its lenses, each naming a bare model alias (`sonnet` or `opus`); a contract test checks it. `lensAttack` (`workflows-src/shared/lens-attack.mjs`) starts one read-only `lens` agent per wired lens at that lens's model. Each call carries the lens-result schema and its own key, so the tap files the return. One pure merge (`shared-node/lens-merge.mjs`), used by both the workflow and the stage report, orders findings by lens order then finding order and gives ids `<lens>-<n>`. A finding with no rule is kept but non-blocking (`low`). A lens with no return goes to `uncovered`, which makes the gate ask even under `auto`. Findings carry a kind (`fix-here`, `risk`, `drift`) and rank by kind, then severity, ties in lens then finding order. Each stage's lens row names `refute`, `maxRefuters` and `maxFindingsPerLens` (positive integers, checked by the contract test). Each lens keeps its top `maxFindingsPerLens` findings (the rest are trimmed and logged). Only the top `maxRefuters` findings get a read-only refuter (Opus for high severity, Sonnet otherwise); each verdict is filed under the finding's key and accepted only for the finding it was sent, and refuted findings move to `refuted`. Findings past the cap, with no verdict, or skipped by the agent budget are unrefuted: logged, never blocking, but an unrefuted high-severity finding makes the gate ask even under `auto`. The stage passes `lensAttack` an agent budget of its `maxAgents` minus the agents it already spawned and the runner. One shared merge serves the workflow and the stage report, and tests check both reach the same result. The fix loop, with its attempts and lessons, is described below. **Read confinement.** The gate confines the `lens`, `refuter`, `synthesizer` and `course-checker` agents to reading inside the run's repo toplevel (a linked worktree's own toplevel; the run is found through the session binding, else the folder's repo). Read `file_path`, Grep `path` (or the working folder) and Glob `path` plus its pattern root (braces, `~` and `..` resolved) are checked by their real path, so symlinks and `..` cannot escape. Session transcripts are outside and denied; an unknown toplevel denies. These agents may use only Read, Grep, Glob and StructuredOutput. It applies with or without a run; other agents and the main session are unaffected, and the main session's no-run path loads nothing new. The scenarios stage runs its first lens (necessity) after the enumerator. A row may carry `taskTypes`; `wiredLensConfig(lensMap, stage, taskType)` picks the row by the ledger's task type and wires all its lenses (scenarios still wires only its first). The three `code-safety-net` rows carry `taskTypes`, so `buildReport` merges the row for `ledger.taskType`, and a safety-net lens that returned nothing is uncovered and the gate asks under `auto`. The `lens` agent is stage-only (`newPathAgents`).

**Safety net stage.** `workflows-src/stages/code-safety-net.mjs` (built to `workflows/code-safety-net.js`) runs `pb snapshot` first, then a lens round through `lensAttack` with the lenses, models and refuter cap of the row for the task type (the agent budget reserves the snapshot runner, the docs agent and the finishing runner), then the docs step, then the finishing runner (checkpoint docs, `test --full`, `pb stage finish`). Findings that survive go through the fix loop (see Fix loop below) before the docs step. `pb stage finish` on a safety-net stage writes `ledger.lenses["safety-net"]` = `{stage, attempt, lenses:[{name,model}], survivors, refuted, unrefuted, uncovered}`: counts and lens names only, no finding content. `pb task end` copies `lenses` into the task record in `unit.json`.

**Course checker (T5c).** The read-only `course-checker` agent (Sonnet; Read, Grep, Glob) checks one fix group's result and opens with the evidence-not-instructions block. It returns the `course-verdict` schema: `verdict` (`better`, `wrong-direction`, `broke-something`), `finding_id`, `mistake` (pinned list: `none`, `missed-finding`, `changed-behaviour`, `out-of-scope`, `weakened-tests`, `new-defect`, `other`) and `what_went_wrong`. Fix groups are named `g<n>`, and the fix agent's key and label role is `fix`; neither appears on the lens round. `courseCheck` (`workflows-src/shared/course-check.mjs`) makes one call per fix group: Opus on `plan-` stages or after the stage's first rollback, Sonnet otherwise. It takes one verdict for the whole group (worst wins) and keeps it only when its `finding_id` names one of the group's findings; otherwise the verdict is null and logged. The gate confines its reads like the lens, refuter and synthesizer, with or without a run, and the harness rejects a checker call without its `agentType`. It is stage-only (`newPathAgents`). The fix loop runs it (see Fix loop below).

**pb rollback (T5c).** `pb rollback --from <fix key>` and `pb rollback --artifact --from <key>` (runner verbs; the gate auto-allows exactly those two forms, D17 denies are unchanged) undo one rejected fix group. A committed fix keeps the rejected commit plus any dirty group paths under `refs/pairingbuddy/<branch>/rollback/<stage>/<n>` (next free n, create-only), restores the group's paths, runs `git reset --keep` to the parent and drops the sha from the ledger's commits. A red fix (needs a failed `tests.checkpoint` run) saves its listed paths as a commit on top of HEAD through a throwaway index, then restores them and removes new files; HEAD is unchanged. `--artifact` moves the artifact to `run/task/rejected/`. Rollback kinds are `commit`, `red`, `artifact` and `repeated` (a refused repeated approach, no checker verdict needed). Each rollback appends a `## Rollback <n>: <key>` entry to `run/task/notes/<stage>.md` (the checker's `what_went_wrong`, or the failing runs' output tails) and a `{key, kind, ref, sha, base}` record to `fixes.rollbacks`. It refuses a non-fix key, a stop, a key that is not current or already rolled back, a newer fix group, a fix commit that is not HEAD, a dirty tree outside the group, a protected branch or detached HEAD, a missing or `better` verdict, no red run, nothing changed, or a path outside the repo. The refs sit under the unit prefix: `pb publish` deletes them, abandon and a stop keep them, and no push carries them.

**PR refresh (Task 85a).** `pb pr refresh` regenerates an open PR's title and body after review fixes are pushed. The verb is main-context. It refuses when a unit or run is open, the branch is protected or detached, the tree is dirty, no open PR comes from this branch, or the PR head is not HEAD. It reads the PR with `gh pr view` and opens a `refresh` run with no unit record; `run/refresh.json` and the old body stand in for it. The diff base is the merge-base with the remote-tracking base, else the local base. The drafter and the claims lens read `run/refresh.json` and `run/refresh-body.md`. The stage runs the same lint, lenses and fix loop, and `G:publish` asks a human even under auto. Approval runs `gh pr edit --title --body-file` and posts new coordination text as a comment; nothing is pushed and labels and draft state stay as they are. The next action names `pb pr refresh` once the refresh is approved or kept local.

**Fix loop (Task 84).** `lensAttack` takes an optional `fix` config and runs `workflows-src/shared/fix-loop.mjs` on the surviving findings: one fix agent per lens group (`g<n>`), one group at a time, each checked by the course checker. Commit mode (safety net): the agent is `refactor-code` or `refactor-tests` by lens; `pb checkpoint --step fix` runs the full suite and writes `run/fix.diff`. Red tests are rolled back with no checker call; otherwise a bad verdict runs `pb rollback` and the group retries with the `what_went_wrong` notes (`shared-node/fix-notes.mjs` parses them; `relayed-json.mjs` reads the relayed returns). Artifact mode (scenarios): the enumerator revises the artifact at the given path from the findings and notes, a bad verdict runs `pb rollback --artifact`, and `pb tdd state` hands on the kept revision. Artifact mode also serves pr-draft (see PR draft above), where `fix.lint` lints each redraft first. The tap lets each stage's assigned fixers file under a fix key (`refactor-code` and `refactor-tests` on the safety net, the enumerator on scenarios, `draft-pull-request` on pr-draft); any other agent is refused. **Repeated-mistake check.** A mistake key (rule, file, mistake; `tests-red` for red tests) seen before in the stage sets `mustChangeApproach` on the retry, and the fix returns its `approach`. A repeated normalized approach is refused by code before any checkpoint or checker, rolled back as kind `repeated` by `pb rollback` (decided from its own record: the fix artifacts of earlier rollbacks of the same stage and group), and counts toward the cap of 5; only the cap stops the loop. The ledger caps rolled-back attempts per stage at `maxAttempts` (5, in `contracts/lenses.json`). `pb rollback` prints `note`, `failedAttempts`, `maxAttempts` and `stopped`; at the cap it records the `attempt-cap` stop and the stage report, and when the CLI did not confirm, the stage records `stage stop attempt-cap` itself. No verdict, another refusal, a refused rollback or a failed fix call stops the stage as step-failed. The loop checks the agent budget has room first. The report and `pb status` carry a `fixes` block `{attempts, rolledBack, maxAttempts, lessons}`, and `unit.json`'s task record keeps the lessons.

**Snapshot and corpus.** `pb snapshot` (runner verb, needs an open unit) writes `run/subject.diff` (`git diff baseSha..HEAD`, no external diff tools), `run/changed.json` (`[{path,status}]`, sorted) and `run/corpus.json` (`{paths}`) at once. The corpus holds the existing `in_repo_docs`, the `git-config` commit and pr conventions, `CLAUDE.md`, and the tracked files nearest each changed path (same folder then parents, closest first, 5 per changed path, 200 total), only paths inside the repo (symlinks checked by their real target), sorted, so the same input gives byte-identical files. The scenarios and safety-net stages' runners run it before the lens round and the lenses get the corpus. It also prints the run ledger's `taskType` (null with no run ledger). It also prints `rolledBack`, the active stage's rollback count from the ledger (0 with no run ledger), which both stages pass to lensAttack as `priorRollbacks`, so the fix loop's count (and the Opus checker after a rollback) starts from the stage's earlier rollbacks on a re-run. A lens marked `needsCorpus` in `contracts/lenses.json` goes to `uncovered` when the corpus is empty, so it can never report clean, in both the workflow and the stage report. Lens names are kebab-case, checked by the contract.

**Refactor-scope stage (Task 88).** `workflows-src/stages/code-refactor-scope.mjs` (built to `workflows/code-refactor-scope.js`) opens the `refactoring` graph: it runs the full suite first and stops with `tests-red` when it is not green, then `scope-refactoring` under the one input rule (result schema `contracts/schemas/scope-refactoring-result.schema.json`), then one `scope-serves-intent` lens with a brief and no refuters or fix loop. `G:scope` follows and asks whenever a scope finding stands that is not marked non-blocking. `refactoring` is now in `migratedTypes` (the flip, Task 89), so a refactoring task runs the graph `code-refactor-scope`, `code-refactor-apply`, `code-safety-net` (`G:task-end`); the safety net's lens row adds a refactoring lens and behaviour-preservation runs at Opus.

**Refactor-apply stage (Task 89).** `workflows-src/stages/code-refactor-apply.mjs` (built to `workflows/code-refactor-apply.js`) applies the scope one step at a time. `pb refactor state` (refactoring tasks only, needs an active stage) reads the standing scope return and lists its issues as numbered steps (`step1`, `step2`, ...), code issues first, then test issues, each with its role (`refactor-code` or `refactor-tests`). Each step runs its fixer, then `pb checkpoint --step refactor-step`: one fix group, typed by its paths (`refactor` or `test`, never `feat` or `fix`), committed only when the full suite is green; a `refactor-tests` step may touch only test directories. `refactor-step` is a checkpoint step for `refactoring` tasks, beside `refactor` (per-cycle, new_feature only). Smoke S5 (`tests/smoke/s5.mjs`) covers the run.

**Spike-unit stage (Task 90).** The `setting-up-spike` skill guides `setup-spike`; `pb spike setup` (Task 92) records the spike setup in `run/task/spike.json` (goal, units, code location) and refuses a setup that is missing or malformed; it runs only after `G:type` has passed. `pb spike state` (spike tasks only, needs an active stage) lists the units and the next one to run. `workflows-src/stages/code-spike-unit.mjs` (built to `workflows/code-spike-unit.js`) explores one unit with `explore-spike-unit` under the one input rule (result schema `contracts/schemas/explore-spike-unit-result.schema.json`), then `pb checkpoint --step spike-unit` commits that unit's changes. The spike graph repeats `G:unit` per unit (`shared-node/repeat.mjs`). Spike is now in `migratedTypes` (Task 91), so a spike task runs `setting-up-spike` in main, `code-spike-unit` (repeating `G:unit`), `code-spike-document`, then `G:task-end`.

**Intake stage and conditional G:type (Task 92).** Every task path in `contracts/stages.json` now starts with `intake` (gate `G:type`, class `conditional`, evidence `artifact:classify-task`); a run opened with no task type takes the default type's graph, so it starts there too. `workflows-src/stages/intake.mjs` (built to `workflows/intake.js`) runs `classify-task` under the one input rule (result schema `contracts/schemas/classify-task-result.schema.json`: task type, confidence `certain | likely | unsure`, rationale). With no `<paths>` block the agent keeps its legacy behaviour and writes `task-classification.json` for the plan and Solo paths. The tap sets the ledger's `taskType` from a filed intake return whose type is in `migratedTypes`. `pb run open` no longer reads `task-classification.json`: `taskType` is null at open and the next action is `intake`. `G:type` passes under `auto` only when the standing intake return says `certain` and a `taskType` is set; otherwise it asks. It also asks, under every policy, when the classified type needs test selection and a runner has no `selector_template` (the check moved here from `pb run open`). For a spike, `nextAction` then names the `setting-up-spike` skill and `pb spike setup`. **Task 92a:** intake runs one Sonnet classification lens with no refuters; a finding re-runs `classify-task` with the note through the course-checked fix loop (artifact rollback, cap 5). `G:type` also asks while a blocking classification finding stands with no kept fix. The run's type follows the kept classification, and an artifact rollback at intake puts the kept type back.

**Spike-document stage and close (Task 91).** `workflows-src/stages/code-spike-document.mjs` (built to `workflows/code-spike-document.js`) runs `document-spike` under the one input rule (result schema `contracts/schemas/document-spike-result.schema.json`), then one Sonnet claims-against-recorded-evidence lens with a brief, and a course-checked artifact-mode fix loop capped at 5. `pb spike write` commits the standing write-up to `doc_path` as a `docs:` commit under the `spike-doc` checkpoint; `pb checkpoint` does not take `spike-doc`. `pb spike state` also prints the findings. After `G:task-end`, `pb task end` closes the unit kept-local, with no publish stage. Smoke S5 covers the spike half.

**Light review (new-path tdd refactor).** The old prose orchestrator above still uses the `identify-*` finders. On the new path, each new_feature cycle of `workflows-src/stages/code-tdd.mjs` (built to `workflows/code-tdd.js`) refactors after its accepted GREEN like this: the runner runs `pb snapshot` for the corpus, then one light review runs (`workflows-src/shared/light-review.mjs`, one Sonnet `lens` agent, `lightReview` in `contracts/lenses.json`, result schema `light-review-result`). The focus rule reads only the files that cycle's RED and GREEN changed, classed as tests by the runners `pb tdd state` relays (`testRunners`, each runner's `test_directory` and `file_pattern`; the state refuses with no test config). A review that returns no findings array is uncovered: it runs again at the next round and, after the stage's tries, the stage stops `step-failed`. Findings under `test-quality` or `test-level` go to `refactor-tests`, all others to `refactor-code`, tests first, as a `<findings>` prompt block instead of an issues path; a side with no findings spawns no fixer, and the CLI commits each fix group through `pb checkpoint --step refactor` only while every closed test passes. No refuter, lens round or course checker runs, and the reviewer counts against the stage's agent cap. The stage return lists one record per cycle (`lightReviews`: item, focuses, findings count). `buildReport` counts only returns of lenses the stage's row wires as a lens round, so a light review leaves "no lens round ran" in the code-tdd report and adds no findings to it.

**G:publish gate.** The `publish` task-type graph (`contracts/stages.json`) has one node, `pr-draft`, whose gate `G:publish` is a `continue` gate. Gate eval shows the PR title, body, lint result, coordination comment, commits (flagging any not in the unit record, which `pb task end` now fills), base, HEAD SHA and test command, and stores the HEAD it showed. Answers are `publish`, `keep local` or `redo`. A `publish` answer binds `headSha`, `bodyHash`, `title`, `labels`, `base` and `target`, re-runs the lint, and is refused if HEAD moved since the question. A new commit or a body edit voids the approval: the gate moves to the ledger's `voidedGates` with the reason. A failed, missing or stale lint asks under every policy, and a human approval records the failure. Under the `auto` policy `G:publish` passes by itself only when every task record in `run/unit.json` has a safety-net lens record and the lint passes at the body hash; the auto pass records the same binding a human approval does (HEAD, base, target, body hash, title hash, labels, coordination hash). Without lens records, or with a failing, stale or missing lint, or after a void, the gate asks a human. The publish run's own ledger lenses do not count. `keep local` closes the unit and keeps commits, branch and refs. A unit with no commits past `baseSha` skips the gate. Hooks no longer bootstrap `git-config.json` on this path.

**pb publish.** `pb publish` (main-class verb) acts on the approved `G:publish`. `publishSteps` in `shared-node/publish.mjs` is a pure planner that returns the steps; the CLI executes them. A stop refuses. No commits past `baseSha` closes the unit (skip) when no code task is open and config hashes are unchanged. `pr.publish` none closes the unit locally after the same fresh human approval and config check. Otherwise every D17 evidence item is checked and all failures reported: a task record per unit task (plan boxes under the unit heading when a plan exists), safety-net finished, valid gate sources, the last task's full suite green at HEAD (`pb task end` records `fullSuite`), a clean tree, no blocking findings, unchanged config hashes, no stop, a `G:publish` approval (human, or an auto pass under the `auto` policy) bound to HEAD, body, title, labels, base and target (a stale or unbound auto pass is voided like a human one, and the lens records and the lint are re-checked at the body it sends), and every commit in the unit record. The branch must be checked out at HEAD, valid and not protected. It pushes exactly the approved SHA (never force, never merge), opens the PR with `gh pr create` from a snapshot of the bound body (`--draft` when the ledger policy is auto, labels passed through), records the PR url in the unit, then writes `PR: <url> branch: <branch>` under the unit heading in the plan. After the PR opens it posts the draft's coordination text as a PR comment from `.pairingbuddy/pr-comments/<n>.md` (deleted on success) and records it in the unit so a retry doesn't repost; null coordination posts nothing, and the text never goes in the body. A failed comment is a warning: the PR stands, the `PR:` line is written, the unit closes, the file is kept, and the output gives `pendingComment` plus the `gh` command to post it by hand. The `G:publish` binding also covers the coordination text, so an edit voids the approval. Task-start cleanup removes only `*.json` in `.pairingbuddy/`, so `pr-comments/` survives it and a kept comment file stays available for the manual post. A retry adopts an existing PR only after `gh pr view` confirms head and base. It deletes only this unit's `refs/pairingbuddy/<branch>/` refs in one transaction, never pushes them, and closes the unit. `pb publish` refuses outside a publish run and ends the publish run when it closes the unit. Keep local is finished by `pb publish` (result `kept-local`) if the tap's cleanup left anything. The ledger records kind `publish` if and only if the taskType is `publish`.

**Coding router on the new path.** `/code` opens a unit first: `pb unit open --type feat|fix|refactor|chore --slug <slug>`. Outside plan tasks and Solo the router no longer runs `classify_task` before the run: the branch type is the main session's guess from the task (it only names the branch), and the `intake` stage and `G:type` classify it after `pb run open`. The model runs only the command a refusal prints for it; otherwise the human confirms the branch. An open, empty unit on its branch is resumed. After `pb task end` it opens a publish run with `pb run open --kind publish`, which is refused unless every unit task has a record, no task run is open and no publish run exists. It then follows `pb status --action` through `pr-draft` and `G:publish`. On approval (a human answer, or an auto pass), or when there is nothing to publish, it runs `pb publish` and reports the url, warnings and `pendingComment`. `pb task end` refuses inside a publish run.

**Abandon and config-change approval.** `pb human abandon` (human-only) removes the unit and task state under `.pairingbuddy/run` and keeps commits, the branch and the working tree; it works after a stop. `pb task end` refuses a `config_change` whose diff (no rename detection, from the unit's last task head or base) touches files outside the git-config `config_globs` (`shared-node/glob-match.mjs`). With empty `config_globs` it asks the human to type `pb human approve-config` (human-only, per task). **Trust boundary.** Human-only ledger fields (gate answers, `configApproval`) are protected by the gate denying human verbs and ledger edits from tool calls, but the ledger sha is an unkeyed hash, so a model running arbitrary node code could forge them. This is a known limitation to address separately.
| `plan/plan-config.json` | Plan name, output path, existing docs (persists across plans) |

**All other files are deleted:**
- `task.json`, `task-classification.json`
- `scenarios.json`, `tests.json`, `current-batch.json`
- `test-state.json`, `code-state.json`
- `test-issues.json`, `code-issues.json`, `files-changed.json`
- `coverage-report.json`, `all-tests-results.json`, `commit-result.json`
- `spike-config.json`, `spike-questions.json`, `spike-findings.json`, `spike-summary.json`, `current-unit.json`
- `docs-updated.json`

**Why this matters:**
- Stale state from previous tasks can cause incorrect behavior (e.g., old spike files causing confusion)
- Test configuration is project-specific, not task-specific - human validates once, reuses many times
- Human guidance with `persistent: true` captures operational knowledge that applies across tasks

---

## Solo Mode

Solo Buddy is an autonomous execution mode where Pairing Buddy executes a pre-established plan without human interaction.

### Entry Point

`scripts/solo-buddy.sh` launches a `claude -p` session with `PAIRINGBUDDY_SOLO=true`. The script unsets `ANTHROPIC_API_KEY` by default to prevent unexpected API billing (use `--use-api-key` to opt in). The prompt tells Claude to use `/pairingbuddy:code` to execute the plan.

### How It Works

Four components are Solo-aware:

1. **Shell script** (`scripts/solo-buddy.sh`) — Sets env var, invokes `claude -p --dangerously-skip-permissions --output-format json`. On success, creates a GitHub PR via `gh pr create` using the sanitized branch name as the title and `SOLO_BUDDY_REPORT.md` as the body when present
2. **Guardian hook** (`hooks/guardian.mjs`) — Detects `PAIRINGBUDDY_SOLO`, injects Solo constraint prompt on SessionStart, uses halved injection interval (2.5 min) and short Solo reminder for PostToolUse
3. **15 agents** — Agents with AskUserQuestion (Step 3 Human Review) check `PAIRINGBUDDY_SOLO` and skip review, assuming approval
4. **Coding orchestrator** (`skills/coding/SKILL.md`) — `_ask_human` auto-returns `true` in Solo mode. Solo Mode section defines strict scope, sequential execution, resource exhaustion before stopping, bug handling, quality compliance, report generation, and push-to-remote

### Report

Solo sessions produce `.pairingbuddy/SOLO_BUDDY_REPORT.md` incrementally — header at session start, task entry after each completion, stopped entry when blocked. The `_update_solo_report` function in the workflow pseudocode ensures report generation is a first-class workflow step.

### Observability

Solo sessions run unattended, so real-time progress visibility is essential. Two mechanisms provide observability:

**Guardian-based tracking (primary, reliable):**
- The guardian hook (`hooks/guardian.mjs`) writes agent info to its session file (`.pairingbuddy/hooks/{sessionId}.json`) on every PostToolUse call: `lastTool`, `lastAgent`, `lastDescription`
- The terminal renderer reads this file directly to show the current agent

**Progress hook (secondary, append-only log):**
- `hooks/solo-progress.mjs` filters for Agent tool invocations and appends timestamped entries to `.pairingbuddy/solo-progress.log` for post-session analysis
- This hook can be unreliable (PostToolUse hooks may stop firing after screen lock or VPN disruption), so the terminal display does not depend on it

**Terminal renderer:**
- `solo-buddy.sh` starts a background process that builds the display by reading source-of-truth files directly:
  - Plan MD file → checkbox count for progress bar and task list
  - `.pairingbuddy/task.json` → current task description
  - Guardian session file → current agent name and proof of life
- Renders a styled display with colored progress bar, task list (✓ done, → current, ○ pending), spinner on active task, and agent name
- Output is written to `/dev/tty` so it remains visible even when `claude -p` stdout is captured
- The renderer cleans up gracefully when the solo session ends (no orphan processes)
- On completion, displays final status with 100% progress bar and PR/report links

**Design constraints:**
- Terminal display is independent of the solo-progress hook — it reads source files directly via the shell renderer
- Guardian file write is wrapped in try/catch to never affect prompt injection reliability
- No-op when `PAIRINGBUDDY_SOLO` is not set (zero impact on interactive sessions)

### Progress mod

`mod/register.tsx` adds a band and a pane that show where a workflow run is. The mod never writes run state or the ledger, and its only writes are two paths: the `.pairingbuddy/reports/` folder (the pane's report button writes `<timestamp>-<slug>.html` and opens it) and `human-guidance.json` (the pane's suggestion input appends an entry with `task_scoped: true`, which the next agent spawn reads and `curate-guidance` drops; the pane shows it pending, then delivered, and a corrupt or unreadable file is never overwritten, the pane saying "suggestion not saved"). It never denies a call, and it is isolated from the shell hooks. It polls `ledger.json` and counts `agent.spawn` events for live agents. The band draws a dim rule above its text line so it does not merge with the transcript. The report decides sign-off with `isPassed` from `shared-node/gate-passed.mjs`, the same rule the CLI uses, so an auto-passed task-end gate needs no sign-off. Labels come from `shared-node/labels.mjs` and plain names from `shared-node/plain-names.mjs`. It shows "unknown" where data does not exist yet and never invents a value. `shared-node/stages-contract.mjs`, which the mod and the report import, is generated by `scripts/build-workflows.mjs`, and `--check` reports drift. The design source is `docs/design/progress-mod/DIRECTION.md`.

The pane's "now building" block is built by the pure helpers in `shared-node/now-building.mjs` (progress row, test names, cycle marker, step age, looping tries, active and unknown agents, legend), drawn by `mod/view.ts` and `mod/pane.tsx`. The mod's `turn.complete` hook marks the turn's agents finished, and each spawn carries `startedAt` and `agentId`, so the block counts active agents and ages the current step. The poller reads `tests.json` and `scenarios.json` into a names map (test id to scenario description, falling back to the id), and the test list uses `tests.json` when it lists every test the ledger has seen. The cycle marker drops REFACTOR for task types outside `REFACTOR_TASK_TYPES` in `shared-node/labels.mjs`, the same rule `shared-node/checkpoint.mjs` uses.
The mod also alerts when the run stops or needs a human (`mod/alert.ts`, `mod/pane-open.ts`): it plays the bundled `mod/assets/alert.wav` (configurable through the `alertSound` userConfig), sets the status line and opens the pane. Each event alerts once, tracked through `$.store` keyed by run id, kind and event seq. The ledger carries a `runId`, written by `pb run open`, and a stop carries a `stop.code` from `STOP_CODES` in `shared-node/stop-codes.mjs`; every code has a plain name in `shared-node/plain-names.mjs`. Alerts stay read-only: they never write run state. Platform rule: the platform places an unasked pane only from 144 columns (110 once the person has opened it). On a narrower terminal the alert still beeps and sets the status line, but the pane stays undrawn; the alert logs this through `$.ui.log` and never claims the pane opened, and the person opens details with `/pb` or the band's details button. The band budgets for the platform's `[-]` control and drops whole segments rather than wrapping.

The mod keeps a snapshot of the last run in `$.state`, so after `pb task end` removes `.pairingbuddy/run/task` the pane still shows "last run finished" and its report button works. `/pb` is a registered command that answers and opens the pane.

The first-pane smoke (Task 59) has a lab (`tests/smoke/t4a-lab.mjs`) and a broken-copy helper (`tests/smoke/broken-plugin.mjs`, `makeBrokenCopy` with `load` and `render` modes). `s2.mjs --plugin-dir` runs S2 against a broken copy, and `tests/smoke/T4A-RUNBOOK.md` guides the human session.

### macOS Sleep Prevention

Solo Buddy uses `caffeinate -s` to prevent macOS from suspending the process when the screen locks. Without it, macOS App Nap freezes the terminal process entirely. Claude Code's built-in `caffeinate -i` only prevents idle sleep, not display/system sleep triggered by screen lock. The caffeinate process is cleaned up via the exit trap.

### Operational Notes

- **macOS only** — Solo Buddy currently only works on macOS (caffeinate, /dev/tty assumptions)
- **VPN interference** — VPN causes sessions to terminate after 1-4 tasks due to connection timeouts. Disable VPN before running. Without VPN, 29-task plans complete in a single session
- **Output format** — Must use `--output-format json`. The `text` format causes early session termination after 1 task
- **API key safety** — The script unsets `ANTHROPIC_API_KEY` by default. If present in the environment, it silently overrides Max/Pro subscription billing. Use `--use-api-key` only for explicit API billing
- **Session resumability** — Plan MD checkboxes are the durable state. Restarting the script picks up from the first unchecked task. The report preserves entries from previous sessions and reconciles against the current plan

### Key Design Properties

- **No workflow pseudocode changes** — Solo behavior comes from `_ask_human` auto-yes and the Solo Mode instructions section
- **Sequential execution** — on task failure, the session stops (no skip-ahead)
- **No revert on stop** — uncommitted changes stay as-is for human review
- **Never pushes to main/master** — only pushes to the branch the human set up

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
