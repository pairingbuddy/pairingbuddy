---
name: design-ux
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

**Iteration routing:**
- Strategic issues → Re-run from Architect
- Tactical issues → Re-run Visual Builder only

## Parallel Exploration

For multiple explorations, spawn separate agent loops with `run_in_background: true`. Track in session.json with status: `exploring`, `building`, `validating`, `critiquing`, `complete`.


## How to Execute This Workflow

Each function call in the workflow translates to a Task tool invocation:

```
Task tool:
  subagent_type: pairingbuddy:design-ux-<agent-name>
```

Agents are self-contained - they know what to read, what to do, and what to write.

## Workflow

```python
# Setup
name = _ask_exploration_name()
output_path = _ask_output_path()
_setup_exploration(name, output_path, brief)  # Creates folders, session.json, direction.json

# Domain exploration (runs first)
explore_domain(name, output_path)

# Generation loop
while iteration < max_iterations:
    # First iteration or strategic issues: run full pipeline
    if first_iteration or _has_strategic_issues(critique):
        architect_design(name, output_path)
        generate_tokens(name, output_path)

    # Always run visual builder
    build_visuals(name, output_path)

    # Validation
    validate_artifacts(name, output_path)
    if not validation.ready_for_critique:
        continue

    # Critique
    critique_design(name, output_path)

    # Human checkpoint
    response = _ask_human("Continue, adjust, or done?")
    if response == "done":
        break
```

### Orchestrator Functions

| Function | Behavior |
|----------|----------|
| `_setup_exploration(name, output_path, brief)` | Create state folder, session.json entry, direction.json, output folder |
| `_has_strategic_issues(critique)` | Check if any priority_issues have `change_level: "strategic"` |
| `_ask_human(question)` | Present question to human, return response |

## Orchestrator Behavior

### State File Management

- State files: `.pairingbuddy/design-ux/{name}/`
- Artifacts: `{output_path}/`
- Agents receive `{name}` and `{output_path}` parameters

### Human Checkpoints

Pause for human review after each iteration cycle.

### Playwright

Check for Playwright MCP at start. If unavailable, explain the human operator how to install it, and offer generation-only mode if they prefer not to use it. See [playwright-setup.md](./playwright-setup.md) for server configuration.

**Screenshot capture:** After each exploration completes, capture screenshot of example.html (viewport 1200x800) for comparison.html.

### Error Handling

- If agents fail: report to human, ask how to proceed
- If color produces poor contrast: warn human, suggest alternatives
- If brand colors conflict with accessibility: show conflict, propose adjusted colors, let human decide

## Web Hosting Output

After explorations complete, generate web-hostable output. **This is orchestrator responsibility - agents do NOT generate these.**

### Steps

1. **Verify** all explorations complete (session.json status: "complete")
2. **Capture screenshots** (if Playwright available) - viewport 1200x800, save to `{output_path}/screenshots/`
3. **Generate index.html** using [index-template.html](./templates/index-template.html)
4. **Generate comparison.html** using [comparison-template.html](./templates/comparison-template.html)
5. **Generate robots.txt** - `User-agent: *\nDisallow: /`
6. **Announce** to user: "Web output ready. Deploy by copying folder to any static host."

### Path Requirements

All paths must be **relative** for portability:
```html
<a href="01-bold/example.html">View</a>  <!-- Correct -->
<a href="/01-bold/example.html">View</a> <!-- Wrong -->
```

## Skill Evolution

**This skill will evolve.** During use:
1. Note what doesn't work well
2. Propose improvements
3. Update this SKILL.md as needed
