---
name: designing-ux
description: Creates, iterates, and manages production-ready design systems with three-tiered token architecture, Tailwind CSS output, and visual critique via Playwright MCP.
---

# Design UX Skill

## State File Mappings

State files live in `.pairingbuddy/design-ux/` at the git root of the target project.

| Variable | File | Schema |
|----------|------|--------|
| session | .pairingbuddy/design-ux/session.json | design-session.schema.json |
| direction | .pairingbuddy/design-ux/{name}/direction.json | design-direction.schema.json |
| domain_spec | .pairingbuddy/design-ux/{name}/domain-spec.json | domain-spec.schema.json |
| design_decisions | .pairingbuddy/design-ux/{name}/design-decisions.json | design-decisions.schema.json |
| tokens_generated | .pairingbuddy/design-ux/{name}/tokens-generated.json | tokens-generated.schema.json |
| config | .pairingbuddy/design-ux/{name}/config.json | design-system-config.schema.json |
| experience | .pairingbuddy/design-ux/{name}/experience.json | design-experience-config.schema.json |
| validation | .pairingbuddy/design-ux/{name}/validation.json | design-validation.schema.json |
| critique | .pairingbuddy/design-ux/{name}/critique.json | design-critique.schema.json |

Where `{name}` is the exploration name (e.g., "horizon", "aurora").

**Artifacts** (tokens/, preview.html, etc.) go to `{output_path}` which is stored in session.json and specified by the user.

## Folder Structure

```
project-root/
├── .pairingbuddy/
│   └── design-ux/
│       ├── session.json              # Tracks all explorations
│       ├── horizon/                  # State for "horizon" exploration
│       │   ├── direction.json
│       │   ├── domain-spec.json
│       │   ├── design-decisions.json
│       │   ├── tokens-generated.json
│       │   ├── config.json
│       │   ├── validation.json
│       │   └── critique.json
│       └── aurora/                   # State for "aurora" exploration
│           └── ...
└── {output_path}/                    # User-specified artifact location
    └── horizon/                      # Artifacts for "horizon"
        ├── tokens/
        │   ├── brand.json
        │   ├── alias.json
        │   └── mapped.json
        ├── tokens.css
        ├── tailwind.config.js
        ├── preview.html
        └── example.html
```

## Critical Rules

### 1. ONE agent per exploration

```
WRONG:
- Spawn 1 visual-builder agent to create 2 design systems

CORRECT:
- Run full pipeline for "horizon", wait for completion
- Run full pipeline for "aurora", wait for completion
(Or run them in parallel with separate {name} parameters)
```

### 2. Create state folders BEFORE invoking agents

```
WRONG:
1. Invoke explorer agent
2. Agent tries to mkdir state folder

CORRECT:
1. Orchestrator creates .pairingbuddy/design-ux/{name}/
2. Orchestrator writes direction.json
3. THEN invoke explorer agent with {name} parameter
```

### 3. Ask user for output_path ONCE

At session start, ask user where artifacts should go. Store in session.json. All explorations in that session use the same base output path.

---

## Overview

Creates, iterates, and manages production-ready design systems. Generates three-tiered token architecture (brand, alias, mapped), interactive HTML visualization, and Tailwind CSS configuration.

## Agents

**Workflow:** Explorer → Architect → Token Generator → Visual Builder → Validator → Critic

| Agent | Output | Purpose |
|-------|--------|---------|
| `design-ux-explorer` | domain-spec.json | Domain grounding |
| `design-ux-architect` | design-decisions.json | Strategic design decisions |
| `design-ux-token-generator` | tokens/, tokens.css, tailwind.config.js | Token architecture |
| `design-ux-visual-builder` | preview.html, example.html | HTML artifacts |
| `design-ux-validator` | validation.json | Structural validation |
| `design-ux-critic` | critique.json | UX critique with change_level |
| `design-ux-gallery-generator` | index.html, comparison.html, screenshots/ | Web gallery output |

**Iteration routing:**
- Strategic issues → Re-run from Architect
- Tactical issues → Re-run Visual Builder only

## Parallel Exploration

For multiple explorations, spawn separate agent loops with `run_in_background: true`. Track in session.json with status: `exploring`, `building`, `validating`, `critiquing`, `complete`.


## How to Execute This Workflow

The Workflow section below contains Python pseudocode - a specification, not executable code. This section explains how to interpret and execute it.

### Reading the Pseudocode

- **Function calls** map to agent invocations
- **Variable names** map to JSON file paths (see State File Mappings)
- **Underscores** in function names become **hyphens** in agent names
  - `design_ux_explorer()` → agent `design-ux-explorer`

### Agent Invocation

Each function call translates to a Task tool invocation:

```
Task tool:
  subagent_type: pairingbuddy:<agent-name>
```

Agents are self-contained - they know what to read (Input section), what to do (Instructions), and what to write (Output section). No prompt needed.

### Control Flow

Interpret control flow statements as orchestration logic:

- `validation = design_ux_validator(...)` then `if not validation.ready_for_critique:` → Invoke agent, then check if validation.json has `ready_for_critique: false`
- `critique = design_ux_critic(...)` then `if _has_strategic_issues(critique):` → Invoke agent, then check if critique.json has any priority_issues with `change_level: "strategic"`
- `while iteration < max_iterations:` → Loop until iteration limit reached

### Orchestrator Functions

Functions prefixed with `_` are **orchestrator logic**, not agent calls. The orchestrator implements these directly:

| Function | Behavior |
|----------|----------|
| `_setup_exploration(name, output_path, brief)` | Create state folder, session.json entry, direction.json, output folder |
| `_has_strategic_issues(critique)` | Check if any priority_issues have `change_level: "strategic"` |
| `_ask_human(question)` | Present question to human, return response |

## Workflow

```python
# Setup
name = _ask_exploration_name()
output_path = _ask_output_path()
_setup_exploration(name, output_path, brief)  # Creates folders, session.json, direction.json

# Domain exploration (runs first)
domain_spec = design_ux_explorer(name, output_path)

# Generation loop
while iteration < max_iterations:
    # First iteration or strategic issues: run full pipeline
    if first_iteration or _has_strategic_issues(critique):
        design_decisions = design_ux_architect(name, output_path)
        tokens_generated = design_ux_token_generator(name, output_path)

    # Always run visual builder
    config = design_ux_visual_builder(name, output_path)

    # Validation
    validation = design_ux_validator(name, output_path)
    if not validation.ready_for_critique:
        continue

    # Critique
    critique = design_ux_critic(name, output_path)

    # Human checkpoint
    response = _ask_human("Continue, adjust, or done?")
    if response == "done":
        break

# After all explorations complete
gallery_output = design_ux_gallery_generator(output_path)
```

## Orchestrator Behavior

### State File Management

- State files: `.pairingbuddy/design-ux/{name}/`
- Artifacts: `{output_path}/`
- Agents receive `{name}` and `{output_path}` parameters

### Human Checkpoints

Pause for human review after each iteration cycle.

### Playwright

Check for Playwright MCP at start. If unavailable, offer generation-only mode. See [playwright-setup.md](./playwright-setup.md) for server configuration.

### Error Handling

- If agents fail: report to human, ask how to proceed
- If color produces poor contrast: warn human, suggest alternatives
- If brand colors conflict with accessibility: show conflict, propose adjusted colors, let human decide

## Skill Evolution

**This skill will evolve.** During use:
1. Note what doesn't work well
2. Propose improvements
3. Update this SKILL.md as needed
