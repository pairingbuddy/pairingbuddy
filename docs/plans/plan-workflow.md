# Plan: `/pairingbuddy:plan` Workflow

> Takes a rough idea or feature request and produces a sequenced, TDD-ready task list using tracer bullet methodology.

## Design Decisions

- **Output path:** Human-specified (like spikes)
- **Architecture docs:** Create if missing, update if existing (human decides per doc: in-place vs companion)
- **Interaction depth:** Adaptive — always at least one validation round unless human explicitly opts out. Full Socratic when needed.
- **Task format:** Rich, self-contained markdown task descriptions with links to arch/design/spike docs. Flows into `/code` via `task.json` as-is.
- **Plan MD format:** Tasks use checkboxes (`- [ ]` / `- [x]`) so progress is trackable in the document itself.
- **Progress tracking:** MD checkboxes are the source of truth. Claude Code Tasks provide in-session visibility. No JSON bookmark — codebase re-analysis determines what's done on resume.
- **Plan state isolation:** Plan state files live in `.pairingbuddy/plan/` subdirectory, isolated from `/code`'s cleanup of `.pairingbuddy/*.json`.
- **Resumability:** Re-analyze codebase + read MD checkboxes. No bookmark to drift.
- **TB boundaries:** Collaborative — agent proposes, human reviews/adjusts.
- **TB verification:** Each tracer bullet ends with a verification task (a first-class `/code` task).
- **Inline spikes:** Plan can include spike tasks when unknowns are identified.
- **Doc discovery:** Human tells us where relevant docs live (stored in plan-config.json).
- **Plan execution:** The `/code` orchestrator gains plan-awareness — when executing from a plan MD, it reads the next unchecked task, creates Claude Code Tasks for visibility, runs the TDD workflow, and updates the checkbox on completion.

## Architecture

### New Components

**Command:** `commands/plan.md`
**Orchestrator skill:** `skills/planning/SKILL.md` (category: orchestrator)

**Agents (4):**

| Agent | Phase | Purpose | Skills |
|-------|-------|---------|--------|
| brainstorm-requirements | DISCOVER | Adaptive Socratic exploration. Reads existing docs. Validates and probes blind spots. | decomposing-tracer-bullets |
| solidify-architecture | STRUCTURE | Reads/creates/updates arch docs. Human decides per doc. | — |
| decompose-tracer-bullets | DECOMPOSE | Proposes thin E2E slices collaboratively. Includes verification tasks and inline spikes. | decomposing-tracer-bullets |
| sequence-tasks | SEQUENCE | Breaks each TB into rich, self-contained `/code` tasks. Writes MD plan with checkboxes. | sequencing-tasks |

**Reference skills (2):**

| Skill | Purpose |
|-------|---------|
| decomposing-tracer-bullets | Tracer bullet methodology, thin E2E slice patterns, YAGNI alignment |
| sequencing-tasks | Task ordering for TDD, rich task description format, dependency patterns |

**Schemas (4):**

| Schema | Purpose | Location |
|--------|---------|----------|
| plan-config.schema.json | Paths to existing docs, output path | .pairingbuddy/plan/plan-config.json (persists) |
| plan-requirements.schema.json | Structured requirements from brainstorming | .pairingbuddy/plan/plan-requirements.json |
| plan-architecture.schema.json | Architectural context summary | .pairingbuddy/plan/plan-architecture.json |
| plan-tracer-bullets.schema.json | Approved TB decomposition with slices | .pairingbuddy/plan/plan-tracer-bullets.json |

### State Isolation

Plan state lives in `.pairingbuddy/plan/`, not `.pairingbuddy/`. This means:
- `/code`'s `_cleanup_state_files()` (which targets `.pairingbuddy/*.json`) never touches plan state
- Consistent with how design-ux uses `.pairingbuddy/design-ux/{name}/`
- `plan-config.json` persists across plans (like `test-config.json` persists across tasks)
- `plan-requirements.json`, `plan-architecture.json`, `plan-tracer-bullets.json` are cleaned when starting a fresh plan

### Flow

```
/pairingbuddy:plan
    |
brainstorm-requirements (adaptive depth, reads existing docs)
    | [human checkpoint]
solidify-architecture (create/update arch docs, human decides per doc)
    | [human checkpoint]
decompose-tracer-bullets (collaborative TB slicing, inline spikes)
    | [human checkpoint]
sequence-tasks (rich task descriptions, writes MD plan with checkboxes)
    | [human checkpoint]
Plan complete -> human points /code at the plan MD for execution
```

### Integration with `/code`

The coding orchestrator (`skills/coding/SKILL.md`) gains plan-awareness:

1. **Plan detection:** When the human provides a plan MD file path, `/code` enters plan execution mode.
2. **Task reading:** Read the plan MD, find the first unchecked task (`- [ ]`), use its description for `task.json`.
3. **Claude Code Task visibility:** Create Claude Code Tasks (via TaskCreate) for all plan tasks. Mark completed ones. This gives the human a visible progress view within the session.
4. **TDD workflow:** Run the normal TDD workflow for the current task.
5. **Checkbox update:** After successful completion (tests pass, committed), update the MD: `- [ ]` becomes `- [x]`.
6. **Task advancement:** Update the Claude Code Task to completed. Report status and move to next unchecked task.
7. **Human checkpoint between tasks:** After each task, pause for human to review and confirm continuing.

**Cross-session recovery:**
- New session: human says "continue executing plan at docs/plans/feature-x.md"
- `/code` reads the MD — checkboxes show what's done
- Optionally re-analyzes codebase to confirm checkboxes match reality
- Hydrates Claude Code Tasks from the MD (checked = done, unchecked = remaining)
- Continues from first unchecked task

**No JSON bookmark needed.** The MD checkboxes + codebase analysis provide complete recovery.

---

## Tracer Bullets

### TB1: Minimal End-to-End — Brainstorm Agent + Orchestrator

**Goal:** Run `/pairingbuddy:plan`, interact with brainstorm-requirements agent, get structured requirements output.

**After this TB:** You can invoke `/pairingbuddy:plan`, it brainstorms with you, and writes `plan-requirements.json`. The pipeline works end-to-end for one agent.

---

#### Task 1: Create plan-config and plan-requirements schemas

Add the two JSON schemas needed for the brainstorm-requirements agent.

**What to build:**
- `contracts/schemas/plan-config.schema.json` — Schema for plan configuration. Properties:
  - `existing_docs`: array of objects with `path` (string) and `type` (enum: "requirements", "architecture", "design", "spike", "other") and `description` (string)
  - `output_path`: string — where to write the plan markdown document
  - `plan_name`: string — human-readable name for this plan
- `contracts/schemas/plan-requirements.schema.json` — Schema for structured requirements output. Properties:
  - `summary`: string — one-paragraph summary of what we're building
  - `requirements`: array of objects with `id` (string), `description` (string), `priority` (enum: "must", "should", "could"), `source` (string — where this requirement came from)
  - `constraints`: array of strings — technical or business constraints identified
  - `unknowns`: array of objects with `id` (string), `description` (string), `suggested_action` (enum: "spike", "ask_stakeholder", "defer")
- Register both schemas in the `schemas` list in `contracts/agent-config.yaml`

**Acceptance criteria:**
- Both schema files exist in `contracts/schemas/`
- Both are valid JSON Schema (draft-07)
- Both are listed in `agent-config.yaml` schemas list
- `uv run pytest tests/agents/test_agent_schemas.py -v` passes

---

#### Task 2: Add brainstorm-requirements agent

Create the first planning agent. It reads existing docs (from plan-config), explores requirements with the human using adaptive Socratic method, and outputs structured requirements.

**What to build:**
- Add `brainstorm-requirements` agent definition to `contracts/agent-config.yaml`:
  - color: cyan
  - model: opus
  - skills: [decomposing-tracer-bullets] — NOTE: this skill doesn't exist yet. For TB1, set skills to `[]` and update in TB3 when the skill is created.
  - inputs: plan_config (plan-config.schema.json, .pairingbuddy/plan/plan-config.json), human_guidance (human-guidance.schema.json, .pairingbuddy/human-guidance.json, optional)
  - outputs: plan_requirements (plan-requirements.schema.json, .pairingbuddy/plan/plan-requirements.json)
  - sections: Purpose, Input, Instructions (with focus_warning), Step 1: Read Inputs (workflow_read_inputs), Step 2: Main Work, Step 3: Human Review (workflow_step3_human_review), Step 4: Output (workflow_step4_output), Output
- Create `agents/brainstorm-requirements.md` following the section structure
  - Purpose: Analyze a planning request and explore requirements through adaptive Socratic questioning
  - Step 2 instructions:
    1. Read all documents referenced in plan-config.json (existing requirements, arch docs, spike findings, etc.)
    2. Assess clarity: is the request clear and specific, or vague and open-ended?
    3. If clear: validate understanding, probe for blind spots (unstated assumptions, edge cases, non-functional requirements, constraints). Minimum one round.
    4. If vague: full Socratic exploration — ask about goals, users, constraints, alternatives, priorities
    5. If human says "skip" or "I've told you everything": respect that and proceed
    6. Identify unknowns that may need spikes
    7. Structure findings into requirements with priorities
- Register in `.claude-plugin/plugin.json`

**Acceptance criteria:**
- Agent file exists at `agents/brainstorm-requirements.md`
- Agent is registered in `plugin.json`
- Agent definition in `agent-config.yaml` matches the file
- `uv run pytest tests/agents/ -v` passes (structure, frontmatter, sections, schema sync)

---

#### Task 3: Create planning orchestrator skill and command

Create the orchestrator skill that drives the plan workflow, and the command entry point. For TB1, the orchestrator only calls brainstorm-requirements.

**What to build:**
- Add `planning` skill to `contracts/skill-config.yaml`:
  - category: orchestrator
  - sections: follow the same pattern as `coding` orchestrator (State File Mappings, How to Execute This Workflow with subsections Reading the Pseudocode / Agent Invocation / Control Flow, Workflow with requires_python_code_block, Orchestrator Behavior with subsections Bootstrap plan-config.json / State File Management / Human Checkpoints / Error Handling)
- Create `skills/planning/SKILL.md`:
  - Frontmatter: name: planning, description about orchestrating plan workflow
  - State File Mappings table (plan_config, plan_requirements, human_guidance for now)
  - How to Execute: same conventions as coding (function names map to agents, underscores to hyphens)
  - Workflow pseudocode (TB1 — minimal):
    ```python
    # Bootstrap plan-config.json (ask human for doc paths and output path)
    # Curate guidance
    human_guidance = curate_guidance(human_guidance, task)
    _cleanup_plan_state_files()

    # Brainstorm requirements
    plan_requirements = brainstorm_requirements(plan_config)
    ```
  - Orchestrator Behavior:
    - Bootstrap plan-config.json: ask human for paths to existing docs and output path
    - State File Management: plan-config.json persists; others cleaned per plan. Plan state lives in `.pairingbuddy/plan/`.
    - Human Checkpoints: after each agent
    - Error Handling: same pattern as coding
- Create `commands/plan.md`:
  - Frontmatter: name: plan, description about planning workflow
  - Body: "Use and follow the planning skill exactly as written"
- Register skill and command in `.claude-plugin/plugin.json`

**Acceptance criteria:**
- Skill file exists at `skills/planning/SKILL.md`
- Command file exists at `commands/plan.md`
- Both registered in `plugin.json`
- Skill definition in `skill-config.yaml` matches the file
- Workflow pseudocode is valid Python
- Workflow references resolve to registered agents (curate_guidance already exists, brainstorm_requirements is new)
- `uv run pytest tests/ -v` passes

**Architecture docs:** See [ARCHITECTURE.md](../../ARCHITECTURE.md) for orchestrator-agent pattern details.

---

#### Task 4: TB1 Verification

Verify the minimal end-to-end flow works.

**What to verify:**
- Full test suite passes: `uv run pytest -v`
- `/pairingbuddy:plan` can be invoked
- The orchestrator asks for plan-config (doc paths, output path)
- brainstorm-requirements agent is invoked and interacts with the human
- `plan-requirements.json` is written to `.pairingbuddy/plan/`
- No regressions in existing `/code` or `/design-ux` workflows

**If automated tests make sense:** Consider adding a structural test that verifies the planning orchestrator's workflow references all resolve correctly (this should already be covered by existing parameterized tests if the skill-config is set up correctly).

---

### TB2: Architecture Handling

**Goal:** After brainstorming, the workflow reads/creates/updates architecture documents.

**After this TB:** `/pairingbuddy:plan` brainstorms requirements AND ensures architecture docs are solid.

---

#### Task 5: Add plan-architecture schema and solidify-architecture agent

Create the schema for architectural context output and the agent that manages architecture documents.

**What to build:**
- `contracts/schemas/plan-architecture.schema.json` — Schema for architectural context. Properties:
  - `existing_docs_analyzed`: array of objects with `path` (string), `status` (enum: "sufficient", "needs_update", "missing")
  - `docs_created`: array of objects with `path` (string), `description` (string)
  - `docs_updated`: array of objects with `path` (string), `changes` (string)
  - `architectural_context`: string — summary of how the planned feature fits into the existing architecture
  - `key_decisions`: array of objects with `decision` (string), `rationale` (string)
  - `affected_components`: array of strings — which parts of the codebase will be affected
- Register schema in `agent-config.yaml` schemas list
- Add `solidify-architecture` agent definition to `contracts/agent-config.yaml`:
  - color: magenta
  - model: opus
  - skills: []
  - inputs: plan_requirements (plan-requirements.schema.json, .pairingbuddy/plan/plan-requirements.json), plan_config (plan-config.schema.json, .pairingbuddy/plan/plan-config.json), human_guidance (optional)
  - outputs: plan_architecture (plan-architecture.schema.json, .pairingbuddy/plan/plan-architecture.json)
  - sections: Purpose, Input, Instructions (focus_warning), Step 1-4 (human review workflow), Output
- Create `agents/solidify-architecture.md`:
  - Purpose: Analyze existing architecture docs, create if missing, update if needed. Ensure the architectural foundation is solid before decomposition.
  - Step 2 instructions:
    1. Read all docs referenced in plan-config.json, focusing on architecture-related ones
    2. Read the codebase structure to understand existing architecture
    3. Assess: do arch docs exist? Are they sufficient for the planned work?
    4. If missing: draft architecture documentation
    5. If existing but incomplete: identify gaps relative to planned requirements
    6. If sufficient: validate and summarize
    7. For each doc that needs creating/updating, ask human: update in-place or create companion doc?
    8. Write/update docs as directed
    9. Summarize architectural context: how the feature fits, key decisions, affected components
- Register in `plugin.json`

**Acceptance criteria:**
- Schema file exists and is valid JSON Schema
- Agent file exists with correct structure
- Registered in `plugin.json` and `agent-config.yaml`
- `uv run pytest tests/ -v` passes

---

#### Task 6: Update planning orchestrator for brainstorm + solidify flow

Extend the orchestrator to call solidify-architecture after brainstorm-requirements.

**What to build:**
- Update `skills/planning/SKILL.md`:
  - Add plan_architecture to State File Mappings table
  - Update Workflow pseudocode:
    ```python
    human_guidance = curate_guidance(human_guidance, task)
    _cleanup_plan_state_files()

    plan_requirements = brainstorm_requirements(plan_config)
    plan_architecture = solidify_architecture(plan_requirements, plan_config)
    ```
- No new schema or agent files needed — just orchestrator update

**Acceptance criteria:**
- Workflow pseudocode is valid Python
- `solidify_architecture` reference resolves to registered agent
- `uv run pytest tests/ -v` passes

---

#### Task 7: TB2 Verification

Verify architecture handling works end-to-end.

**What to verify:**
- Full test suite passes
- After brainstorming, solidify-architecture agent is invoked
- Agent reads existing docs, identifies gaps, proposes actions
- Human is asked about in-place vs companion for each doc
- `plan-architecture.json` is written to `.pairingbuddy/plan/`
- Architecture docs are created/updated as directed

---

### TB3: Tracer Bullet Decomposition

**Goal:** Workflow decomposes requirements into thin end-to-end slices using tracer bullet methodology.

**After this TB:** Full flow through brainstorm, architecture, TB decomposition with collaborative review.

---

#### Task 8: Create decomposing-tracer-bullets reference skill

Create the reference skill that provides tracer bullet methodology guidance to agents.

**What to build:**
- Add `decomposing-tracer-bullets` to `contracts/skill-config.yaml`:
  - category: reference
  - sections: Contents, Quick Reference (following existing reference skill pattern)
- Create `skills/decomposing-tracer-bullets/SKILL.md`:
  - Frontmatter: name, description (min 20 chars)
  - Contents section linking to reference.md
  - Quick Reference with key principles
- Create `skills/decomposing-tracer-bullets/reference.md`:
  - **What is a tracer bullet:** A thin end-to-end slice that delivers working functionality. Named after the military concept — fire a visible round to see if it hits the target before committing full ammunition.
  - **Core principles:**
    - Each TB delivers something that works end-to-end
    - Minimal increment — the thinnest useful slice
    - YAGNI — you can stop after any TB and have something useful
    - Each TB ends with a verification task
    - Learning flows forward — what you learn in TB1 informs TB2
  - **How to identify TB boundaries:**
    - Start with the simplest possible end-to-end path (happy path, single item, no error handling)
    - Each subsequent TB adds one dimension: error handling, multiple items, parallelism, edge cases
    - TB boundaries align with natural deployment points
    - Each TB should be independently valuable
  - **Patterns:**
    - Single item before collection
    - Happy path before error handling
    - Synchronous before asynchronous
    - Read before write
    - Core before extensions
    - Manual before automated
  - **Anti-patterns:**
    - Horizontal slicing (all models, then all controllers, then all views) — this is NOT tracer bullet
    - Building infrastructure before features
    - Gold-plating early TBs
    - TBs that can't be verified independently
  - **Inline spikes:** When a TB depends on an unknown, insert a spike task before the implementation tasks. The spike answers the question, then implementation proceeds.
  - **Relationship to TDD:** Each task within a TB is designed for RED-GREEN-REFACTOR. The TB verification task may include e2e tests, integration tests, or manual verification — determined during `/code` execution.
- Register skill directory in `plugin.json`

**Acceptance criteria:**
- Skill directory exists with SKILL.md and reference.md
- Registered in `skill-config.yaml` and `plugin.json`
- `uv run pytest tests/skills/ -v` passes

---

#### Task 9: Add plan-tracer-bullets schema and decompose-tracer-bullets agent

Create the schema for TB decomposition and the agent that proposes slices.

**What to build:**
- `contracts/schemas/plan-tracer-bullets.schema.json` — Properties:
  - `tracer_bullets`: array of objects with:
    - `id`: string
    - `name`: string — short descriptive name
    - `goal`: string — what this TB delivers when complete
    - `verification`: string — how to verify this TB works end-to-end
    - `depends_on`: array of strings (TB ids) — which prior TBs must be complete
    - `tasks_summary`: array of strings — high-level task descriptions (details come from sequence-tasks agent)
    - `includes_spike`: boolean — whether this TB includes a spike task
    - `spike_description`: string (optional) — what the spike needs to answer
- Register in `agent-config.yaml` schemas list
- Add `decompose-tracer-bullets` agent to `agent-config.yaml`:
  - color: yellow
  - model: opus
  - skills: [decomposing-tracer-bullets]
  - inputs: plan_requirements (.pairingbuddy/plan/plan-requirements.json), plan_architecture (.pairingbuddy/plan/plan-architecture.json), plan_config (.pairingbuddy/plan/plan-config.json), human_guidance (optional)
  - outputs: plan_tracer_bullets (plan-tracer-bullets.schema.json, .pairingbuddy/plan/plan-tracer-bullets.json)
  - sections: Purpose, Input, Instructions (focus_warning), Step 1-4, Output
- Create `agents/decompose-tracer-bullets.md`:
  - Purpose: Decompose requirements into thin end-to-end slices using tracer bullet methodology
  - Step 2 instructions:
    1. Read requirements, architectural context, and existing docs
    2. Identify the simplest possible end-to-end path (TB1 candidate)
    3. Build subsequent TBs by adding one dimension at a time
    4. For each unknown, mark the TB as including a spike
    5. Ensure each TB ends with a clear verification description
    6. Ensure each TB is independently valuable (YAGNI)
    7. Present decomposition to human for collaborative review
  - Step 3: Human can merge, split, reorder, add, or remove TBs
- Register in `plugin.json`
- Update brainstorm-requirements agent in `agent-config.yaml` to add skills: [decomposing-tracer-bullets] (now that the skill exists)

**Acceptance criteria:**
- Schema file exists and is valid
- Agent file exists with correct structure
- Skill reference resolves to existing skill directory
- brainstorm-requirements agent updated with skill reference
- `uv run pytest tests/ -v` passes

---

#### Task 10: Update planning orchestrator for decomposition flow

Extend the orchestrator to include tracer bullet decomposition.

**What to build:**
- Update `skills/planning/SKILL.md`:
  - Add plan_tracer_bullets to State File Mappings
  - Update Workflow:
    ```python
    human_guidance = curate_guidance(human_guidance, task)
    _cleanup_plan_state_files()

    plan_requirements = brainstorm_requirements(plan_config)
    plan_architecture = solidify_architecture(plan_requirements, plan_config)
    plan_tracer_bullets = decompose_tracer_bullets(plan_requirements, plan_architecture, plan_config)
    ```

**Acceptance criteria:**
- Workflow references resolve
- `uv run pytest tests/ -v` passes

---

#### Task 11: TB3 Verification

Verify tracer bullet decomposition works end-to-end.

**What to verify:**
- Full test suite passes
- After architecture, decompose-tracer-bullets agent proposes slices
- Human can review, merge/split/reorder TBs
- Each TB has a verification description
- Unknowns are flagged with inline spike markers
- `plan-tracer-bullets.json` is written to `.pairingbuddy/plan/`

---

### TB4: Task Sequencing + Plan Output

**Goal:** Complete workflow that produces the final markdown plan document with rich, self-contained task descriptions and checkboxes.

**After this TB:** Full `/pairingbuddy:plan` workflow produces a plan document ready for `/code` consumption.

---

#### Task 12: Create sequencing-tasks reference skill

Create the reference skill for task sequencing principles.

**What to build:**
- Add `sequencing-tasks` to `contracts/skill-config.yaml`:
  - category: reference
  - sections: Contents, Quick Reference
- Create `skills/sequencing-tasks/SKILL.md` and `skills/sequencing-tasks/reference.md`:
  - **Task sequencing for TDD:**
    - Order tasks so each builds naturally on the previous (test infrastructure before features)
    - First task in a TB often sets up the basic structure/interface
    - Subsequent tasks add behavior one test case at a time
    - Verification task is always last
  - **Rich task description format:**
    - Goal: one sentence, what this task delivers
    - Acceptance criteria: specific, testable conditions
    - Context: links to relevant arch docs, design docs, spike findings
    - Relevant context: specific information this task needs (API quirks, library patterns, etc.)
    - Files likely involved: guidance, not prescription (enumerate agent decides)
    - Prior task output: what the previous task built that this one builds on
  - **Plan MD format:**
    - Tasks use checkboxes: `- [ ] **Task N: Title**` followed by rich description
    - Completed tasks: `- [x] **Task N: Title**`
    - TBs are markdown headings with goal and verification criteria
    - Each task is self-contained — can be copied to `/code` as-is
  - **Task sizing:**
    - Each task should be one `/code` session (one TDD cycle)
    - If a task has more than ~5-7 test cases, consider splitting
    - Spike tasks are standalone — one question, one answer
  - **Dependency patterns:**
    - Within a TB: sequential ordering is sufficient (top to bottom)
    - Between TBs: explicit dependency via TB ids
    - Verification tasks depend on all prior tasks in the TB
- Register in `plugin.json`

**Acceptance criteria:**
- Skill directory exists with correct structure
- `uv run pytest tests/skills/ -v` passes

---

#### Task 13: Add sequence-tasks agent

Create the agent that produces the final plan document.

**What to build:**
- Add `sequence-tasks` agent to `agent-config.yaml`:
  - color: green
  - model: opus
  - skills: [sequencing-tasks]
  - inputs: plan_tracer_bullets (.pairingbuddy/plan/plan-tracer-bullets.json), plan_requirements (.pairingbuddy/plan/plan-requirements.json), plan_architecture (.pairingbuddy/plan/plan-architecture.json), plan_config (.pairingbuddy/plan/plan-config.json), human_guidance (optional)
  - outputs: plan_config (plan-config.schema.json, .pairingbuddy/plan/plan-config.json) — updated with final output_path confirmation
  - sections: Purpose, Input, Instructions (focus_warning), Step 1-4, Output
- Create `agents/sequence-tasks.md`:
  - Purpose: Break approved tracer bullets into sequenced, self-contained tasks and write the plan document
  - Step 2 instructions:
    1. Read tracer bullets, requirements, architectural context
    2. For each tracer bullet, in order:
       a. If TB includes a spike: create a spike task first with clear question and exploration scope
       b. Break the TB goal into individual tasks, each suitable for one `/code` session
       c. Order tasks for natural TDD progression
       d. Write rich task descriptions: goal, acceptance criteria, context links, relevant specifics
       e. Append a verification task describing what "working end-to-end" means for this TB
    3. Write the complete plan as a markdown document to the path specified in plan-config.json
       - Use checkboxes for each task: `- [ ] **Task N: Title**`
       - Group tasks under TB headings with goal and verification criteria
       - Each task description is self-contained and ready for `/code`
    4. The MD file on disk IS the output — the agent writes it directly
  - Note: This agent writes to the human-specified output_path (a markdown file), not just to `.pairingbuddy/plan/`. This is similar to how document-spike writes to a human-specified location.
- Register in `plugin.json`

**Acceptance criteria:**
- Agent file exists with correct structure
- Skill references resolve
- `uv run pytest tests/ -v` passes

---

#### Task 14: Update planning orchestrator with complete workflow

Complete the orchestrator with full workflow including all 4 agents and plan output.

**What to build:**
- Update `skills/planning/SKILL.md`:
  - Add all state file mappings (plan_tracer_bullets)
  - Complete Workflow pseudocode:
    ```python
    # Bootstrap plan-config.json (ask human for doc paths and output path)

    # Curate guidance
    human_guidance = curate_guidance(human_guidance, task)
    _cleanup_plan_state_files()

    # Phase 1: Discover
    plan_requirements = brainstorm_requirements(plan_config)

    # Phase 2: Structure
    plan_architecture = solidify_architecture(plan_requirements, plan_config)

    # Phase 3: Decompose
    plan_tracer_bullets = decompose_tracer_bullets(plan_requirements, plan_architecture, plan_config)

    # Phase 4: Sequence and write plan
    sequence_tasks(plan_tracer_bullets, plan_requirements, plan_architecture, plan_config)

    _stop("Plan complete. Find your plan at: " + plan_config.output_path)
    ```
  - Update Orchestrator Behavior:
    - Bootstrap plan-config.json: ask human for existing doc paths, output path, plan name
    - State File Management: plan-config.json persists in `.pairingbuddy/plan/`; plan-requirements, plan-architecture, plan-tracer-bullets cleaned when starting a fresh plan
    - _cleanup_plan_state_files() deletes: `.pairingbuddy/plan/plan-requirements.json`, `.pairingbuddy/plan/plan-architecture.json`, `.pairingbuddy/plan/plan-tracer-bullets.json`
    - Human Checkpoints: after each agent, human reviews and approves

**Acceptance criteria:**
- Workflow is valid Python
- All references resolve to registered agents
- `uv run pytest tests/ -v` passes

---

#### Task 15: TB4 Verification

Verify the complete plan workflow produces a usable plan document.

**What to verify:**
- Full test suite passes
- Complete flow: brainstorm -> solidify -> decompose -> sequence
- Markdown plan document is written to human-specified path
- Tasks use checkbox format (`- [ ]`)
- Each task in the plan is self-contained with goal, criteria, context links
- Each TB ends with a verification task
- Inline spike tasks appear where unknowns were identified
- Task descriptions are rich enough to pass directly to `/code`

---

### TB5: `/code` Plan-Awareness

**Goal:** The coding orchestrator can execute tasks from a plan MD, with Claude Code Task visibility and automatic checkbox updates.

**After this TB:** Human points `/code` at a plan MD, and it iterates through tasks with visible progress and automatic tracking.

---

#### Task 16: Add plan execution logic to coding orchestrator

Update the coding orchestrator to detect and execute plan-based tasks.

**What to build:**
- Update `skills/coding/SKILL.md`:
  - Add a "Plan Execution Mode" section to Orchestrator Behavior describing the plan-aware flow
  - Add orchestrator functions:
    - `_detect_plan_file(task)`: Check if the task description references a plan MD file path
    - `_read_plan_tasks(plan_path)`: Parse the plan MD, extract tasks with their checkbox state
    - `_next_unchecked_task(plan_tasks)`: Return the first unchecked task
    - `_mark_task_complete(plan_path, task_index)`: Update `- [ ]` to `- [x]` in the MD file
    - `_hydrate_claude_tasks(plan_tasks)`: Create Claude Code Tasks (TaskCreate) for visibility, marking completed ones
    - `_update_claude_task(task_id)`: Mark a Claude Code Task as completed (TaskUpdate)
  - Update the Workflow pseudocode to add plan execution at the top:
    ```python
    # Plan execution mode
    if _detect_plan_file(task):
        plan_path = task.plan_file
        plan_tasks = _read_plan_tasks(plan_path)
        _hydrate_claude_tasks(plan_tasks)

        for plan_task in plan_tasks:
            if plan_task.checked:
                continue

            # Write task.json with the rich task description
            task = {"description": plan_task.description, "context": plan_task.context}

            # Run normal TDD workflow for this task
            # (curate_guidance, _cleanup_state_files, classify_task, etc.)
            # ... existing workflow ...

            # After successful completion:
            _mark_task_complete(plan_path, plan_task.index)
            _update_claude_task(plan_task.task_id)

            # Human checkpoint between tasks
            if not _ask_human(f"Task {plan_task.index} complete. Continue to next task?"):
                break

        _stop("Plan execution paused/complete.")

    # Normal (non-plan) execution continues below...
    ```

**Acceptance criteria:**
- Workflow pseudocode is valid Python
- All references resolve
- Existing non-plan `/code` workflow is unchanged
- `uv run pytest tests/ -v` passes

**Context:** See [ARCHITECTURE.md](../../ARCHITECTURE.md) for coding orchestrator structure. The plan execution wraps the existing workflow — it doesn't replace it.

---

#### Task 17: TB5 Verification

Verify plan-aware `/code` execution works end-to-end.

**What to verify:**
- Full test suite passes
- When given a plan MD file, `/code` enters plan execution mode
- Claude Code Tasks are created and visible for all plan tasks
- First unchecked task is automatically loaded
- After completing a task, the MD checkbox is updated (`- [ ]` -> `- [x]`)
- Claude Code Task is marked completed
- Human is prompted between tasks
- On session resume with same plan file, completed checkboxes are respected
- Non-plan `/code` invocations still work normally

---

### TB6: Resumability

**Goal:** `/plan` can resume and update an existing plan based on what was actually built.

**After this TB:** Invoking `/plan` on an existing plan re-analyzes the codebase and can re-plan remaining work.

---

#### Task 18: Add resume logic to planning orchestrator

Implement plan resumability — detect existing plan, re-analyze, update.

**What to build:**
- Update `skills/planning/SKILL.md` orchestrator workflow:
  - At start, check if plan-config.json exists in `.pairingbuddy/plan/` AND if the output_path MD file exists
  - If both exist:
    - Read the plan MD to see progress (checkboxes)
    - Re-analyze the codebase to understand what was actually built
    - Ask human: "Found existing plan '{plan_name}' — N/M tasks complete. Resume, re-plan remaining, or start fresh?"
    - If resume as-is: no action needed (human continues with `/code`)
    - If re-plan remaining: run decompose_tracer_bullets and sequence_tasks for remaining work, informed by codebase analysis. Update the MD (preserve completed tasks, rewrite remaining).
    - If start fresh: clean all plan state and run normal flow
  - Update pseudocode with resume branch:
    ```python
    # Check for existing plan
    if _plan_exists():
        plan_md = _read_plan_md(plan_config.output_path)
        completed = _count_completed(plan_md)
        total = _count_total(plan_md)

        choice = _ask_human(f"Existing plan: {completed}/{total} tasks done. Resume, re-plan remaining, or start fresh?")

        if choice == "resume":
            _stop("Plan unchanged. Use /code to continue execution.")
        elif choice == "re-plan":
            # Re-analyze codebase
            plan_architecture = solidify_architecture(plan_requirements, plan_config)
            plan_tracer_bullets = decompose_tracer_bullets(plan_requirements, plan_architecture, plan_config)
            sequence_tasks(plan_tracer_bullets, plan_requirements, plan_architecture, plan_config)
            _stop("Plan updated at: " + plan_config.output_path)
        # else: fall through to fresh plan

    # Fresh plan flow
    human_guidance = curate_guidance(human_guidance, task)
    _cleanup_plan_state_files()
    # ... rest of workflow
    ```

**Acceptance criteria:**
- Workflow pseudocode is valid Python
- All references resolve
- `uv run pytest tests/ -v` passes

---

#### Task 19: TB6 Verification

Verify resumability works.

**What to verify:**
- Full test suite passes
- When plan-config.json and plan MD exist, human is offered resume/re-plan/fresh options
- On re-plan, codebase is re-analyzed (not just reading old state)
- Updated plan preserves completed task checkboxes
- Start fresh cleans all plan state

---

### TB7: Documentation

**Goal:** Update all project documentation to reflect the new `/plan` workflow and `/code` plan-awareness.

**After this TB:** ARCHITECTURE.md, CHANGELOG.md, and any other relevant docs are up to date.

---

#### Task 20: Update ARCHITECTURE.md

Add the plan workflow and `/code` plan-awareness to the project architecture documentation.

**What to build:**
- Add plan workflow to the Components section (agents, skills, command, schemas)
- Add Plan Flow diagram (alongside existing TDD Flow, Spike Flow, Design UX Flow)
- Add Plan Execution Flow diagram showing `/code` iterating through plan tasks
- Update agent table with 4 new agents
- Update skill table with 2 new reference skills + planning orchestrator
- Update schema count and list (4 new schemas)
- Add `.pairingbuddy/plan/` state files to State Management table
- Note plan-config.json as persisting file
- Document the plan execution mode in `/code`
- Update "What is Implemented" counts

**Acceptance criteria:**
- ARCHITECTURE.md accurately reflects all new components
- No broken internal links
- Existing documentation unchanged except for additions

---

#### Task 21: Update CHANGELOG.md

Add the plan workflow feature to the changelog.

**What to build:**
- Add entry to `[Unreleased]` section:
  - Added: `/pairingbuddy:plan` command for tracer bullet planning
  - Added: 4 planning agents (brainstorm-requirements, solidify-architecture, decompose-tracer-bullets, sequence-tasks)
  - Added: 2 reference skills (decomposing-tracer-bullets, sequencing-tasks)
  - Added: Planning orchestrator skill with adaptive brainstorming, architecture management, and task sequencing
  - Added: 4 new JSON schemas for plan state management
  - Added: `/code` plan execution mode with Claude Code Task visibility and MD checkbox tracking
  - Added: Plan resumability with codebase re-analysis

**Acceptance criteria:**
- CHANGELOG.md follows Keep a Changelog format
- Entry is in `[Unreleased]` section

---

#### Task 22: TB7 Verification

Verify all documentation is complete and accurate.

**What to verify:**
- Full test suite passes (including any tests that validate doc links)
- ARCHITECTURE.md is consistent with actual implementation
- CHANGELOG.md entries are accurate
- No broken links in documentation
- `uv run pytest -v` passes with no regressions
