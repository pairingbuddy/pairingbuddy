---
name: planning
description: Orchestrates planning workflow using tracer bullet methodology. Brainstorms requirements, solidifies architecture, decomposes into tracer bullets, and sequences TDD-ready tasks. Writes plan as markdown with checkboxes.
---

# Planning Orchestrator

Orchestrates the planning workflow by invoking specialized agents via the Task tool. Each agent reads input JSON, performs one operation, writes output JSON. The final output is a markdown plan document with rich, self-contained task descriptions ready for `/pairingbuddy:code`.

## CRITICAL: Follow the Workflow Exactly

**You MUST follow the workflow pseudocode exactly as specified.** Do not skip steps, reorder agents, or deviate from the sequence. The workflow exists because each agent depends on the output of prior agents.

If you think a step doesn't apply, you are probably wrong. The workflow handles edge cases. Follow it.

## State File Mappings

State files live in `.pairingbuddy/plan/` at the git root of the target project.

| Variable | File | Schema |
|----------|------|--------|
| plan_config | .pairingbuddy/plan/plan-config.json | plan-config.schema.json |
| plan_requirements | .pairingbuddy/plan/plan-requirements.json | plan-requirements.schema.json |
| plan_architecture | .pairingbuddy/plan/plan-architecture.json | plan-architecture.schema.json |
| plan_tracer_bullets | .pairingbuddy/plan/plan-tracer-bullets.json | plan-tracer-bullets.schema.json |
| human_guidance | .pairingbuddy/human-guidance.json | human-guidance.schema.json |

## How to Execute This Workflow

The Workflow section below contains Python pseudocode - a specification, not executable code. This section explains how to interpret and execute it.

### Reading the Pseudocode

- **Function calls** map to agent invocations
- **Variable names** map to JSON file paths (see State File Mappings)
- **Underscores** in function names become **hyphens** in agent names
  - `brainstorm_requirements()` → agent `brainstorm-requirements`

### Agent Invocation

Each function call translates to a Task tool invocation:

```
Task tool:
  subagent_type: pairingbuddy:<agent-name>
```

Agents are self-contained - they know what to read (Input section), what to do (Instructions), and what to write (Output section). No prompt needed.

### Control Flow

Interpret control flow statements as orchestration logic:

- `if condition:` → Check the condition and branch accordingly
- `_ask_human(question)` → Present question to human, return response

### Orchestrator Functions

Functions prefixed with `_` are **orchestrator logic**, not agent calls. The orchestrator implements these directly:

| Function | Behavior |
|----------|----------|
| `_cleanup_plan_state_files()` | **MANDATORY.** Delete all `.pairingbuddy/plan/*.json` files EXCEPT `plan-config.json`. This persists across plans. All other plan state files (plan-requirements.json, plan-architecture.json, plan-tracer-bullets.json) MUST be deleted to start fresh. |
| `_ask_human(question)` | Present question to human, return response |
| `_stop(message)` | Stop workflow execution and report message to human |
| `_plan_exists()` | Check if plan-config.json exists AND the output_path MD file exists on disk |
| `_read_plan_md(path)` | Read plan MD file and return parsed content |
| `_count_completed(plan_md)` | Count tasks with `- [x]` checkboxes |
| `_count_total(plan_md)` | Count total tasks (both `- [ ]` and `- [x]`) |

These functions handle coordination, human interaction, and control flow that doesn't belong in agents.

## Workflow

**Prerequisites:** Before starting, ensure `.pairingbuddy/plan/plan-config.json` exists. See "Bootstrap plan-config.json" in Orchestrator Behavior.

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
        # Re-analyze codebase and re-plan remaining work
        plan_architecture = solidify_architecture(plan_requirements, plan_config)
        plan_tracer_bullets = decompose_tracer_bullets(plan_requirements, plan_architecture, plan_config)
        plan_config = sequence_tasks(plan_tracer_bullets, plan_requirements, plan_architecture, plan_config)
        _stop("Plan updated at: " + plan_config.output_path)
    # else: fall through to fresh plan

# Fresh plan flow

# Curate guidance from previous session (always runs - handles review and bootstrap)
human_guidance = curate_guidance(human_guidance, task)

# Clean up stale plan state files (MANDATORY - do not skip)
_cleanup_plan_state_files()

# Phase 1: Discover
plan_requirements = brainstorm_requirements(plan_config)

# Phase 2: Structure
plan_architecture = solidify_architecture(plan_requirements, plan_config)

# Phase 3: Decompose
plan_tracer_bullets = decompose_tracer_bullets(plan_requirements, plan_architecture, plan_config)

# Phase 4: Sequence and write plan
plan_config = sequence_tasks(plan_tracer_bullets, plan_requirements, plan_architecture, plan_config)

_stop("Plan complete. Find your plan at: " + plan_config.output_path)
```

## Orchestrator Behavior

### Bootstrap plan-config.json

1. Ensure `.pairingbuddy/plan/` directory exists
2. Check if `.pairingbuddy/plan/plan-config.json` exists
3. If exists, ask human: "Use existing plan config?" (show current config)
4. If missing or human says no:
   a. Ask human for a plan name (human-readable identifier)
   b. Ask human where to write the plan document (output path)
   c. Ask human for paths to any existing relevant documents (requirements, architecture, spike findings, design docs)
   d. For each doc, ask what type it is (requirements, architecture, design, spike, other)
5. Write plan-config.json with the collected information
6. If unable to determine, ask human directly

### State File Management

1. At workflow start, verify `.pairingbuddy/` is in `.gitignore`
2. Invoke `curate_guidance` agent (before cleanup):
   - If `human-guidance.json` has entries: review/curate existing guidance
   - If empty or missing: offer to add new persistent guidance
3. Delete all `.pairingbuddy/plan/*.json` EXCEPT `plan-config.json`
4. Keep files after run for human review

**Note:** Plan state files live in `.pairingbuddy/plan/`, isolated from `/code`'s state in `.pairingbuddy/`. The two workflows do not interfere with each other's state.

### Human Checkpoints

After each agent:
1. Present results to human
2. Human decides: approve, provide feedback (agent redoes work), or stop
3. This is built into each agent's Step 3: Human Review workflow

### Error Handling

1. If agent returns error or invalid output → stop and report
2. If any step fails → ask human how to proceed
