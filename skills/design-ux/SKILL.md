---
name: design-ux
description: Creates, iterates, and manages production-ready design systems with three-tiered token architecture, Tailwind CSS output, and visual critique via Playwright MCP.
---

# Design UX Skill

## Overview

Creates, iterates, and manages production-ready design systems. Generates three-tiered token architecture (brand, alias, mapped), interactive HTML visualization, and Tailwind CSS configuration.

**Announce at start:** "I'm using the design-ux skill to [create/iterate on] your design system."

### Mandatory First Steps

Before ANY generation work:

1. **Check Playwright MCP** - Look for Playwright tools. If unavailable, inform user and offer generation-only mode.
2. **Read the templates** - Read [preview template](./templates/preview-template.html) and [prototype template](./templates/prototype-template.html) before generating any HTML.
3. **Read web hosting templates** - Read [index template](./templates/index-template.html) and [comparison template](./templates/comparison-template.html) for generating navigation pages.

### Mandatory Template Usage

**NEVER generate preview.html from scratch.** Always:
1. Read the template file first
2. Replace placeholders with generated content
3. Keep the template structure intact

This ensures consistent, comparable output across all design systems.

### Output Files

Each design system produces:
- `preview.html` - **MUST use template** - Standard design system preview (tokens, typography, components)
- `example.html` - Optional contextual page showing the design system in use for the specific business/context

## Design Principles

All work must follow design principles from reference skills:
- **applying-design-principles** - Core UX principles (Rams, Norman, Laws of UX)
- **critiquing-designs** - 6-pass critique framework
- **building-components** - Component patterns and domain packs
- **differentiating-designs** - Craft knowledge for intentionally differentiated designs

**Key requirements:**
- Touch targets: 48x48px minimum
- Color contrast: 4.5:1 for text (WCAG AA)
- Spacing: 8px base scale only
- Apply Laws of UX (Fitts, Hick, Miller, Jakob, Von Restorff)

**Craft requirements (from differentiating-designs):**
- Establish domain grounding before generation
- Reject obvious defaults explicitly
- Use product-specific token names (e.g., `--ink` not `--gray-700`)
- Pass the four pre-delivery tests: swap, squint, signature, token

## Agents

This skill coordinates three specialized agents:

**Explorer Agent** (`design-ux-explorer`) - NEW, MANDATORY
- Establishes domain grounding and design intent before any generation
- Produces `domain-spec.json` with intent, domain concepts, signature, defaults to reject
- Must run FIRST before builder or critic
- Skills: differentiating-designs

**Builder Agent** (`design-ux-builder`)
- Creates and iterates on design systems and experiences
- Reads `domain-spec.json` to apply domain grounding during generation
- Generates tokens, components, and states
- Uses Playwright for visual feedback
- Skills: applying-design-principles, building-components

**Critic Agent** (`design-ux-critic`)
- Evaluates designs using 6-pass framework plus craft tests
- Reads `domain-spec.json` to check domain alignment
- Checks design principle compliance
- Runs four craft tests: swap, squint, signature, token
- Provides structured, prioritized critique
- Uses Playwright for visual analysis
- Skills: differentiating-designs, critiquing-designs, applying-design-principles

## Conversational Interface

The skill provides a conversational interface for design work. See Commands section below for available operations.

## Parallel Exploration

The design-ux orchestrator can spawn multiple builder-critic loops to explore different design directions simultaneously.

### Launching Parallel Explorations

When the human requests multiple explorations:

1. Create exploration parent folder (e.g., `onboarding-explorations/`)
2. Create `.pairingbuddy/` in parent folder for shared session state
3. Write `brief.json` and `status.json` to parent's `.pairingbuddy/`:
```json
// .pairingbuddy/status.json
{
  "created": "2026-01-24T10:00:00Z",
  "agents": [
    {"id": "v1-minimal", "status": "running", "iterations": 0, "port": 8001},
    {"id": "v2-playful", "status": "running", "iterations": 0, "port": 8002}
  ]
}
```
4. Create subfolder for each exploration (v1-minimal/, v2-playful/, etc.)
5. Create `.pairingbuddy/` in each subfolder for isolated session state
6. Write `direction.json` in each subfolder's `.pairingbuddy/` (from brief + specific angle)
7. Spawn builder-critic agents with `run_in_background: true` for each exploration
8. Update parent's `.pairingbuddy/status.json` as each agent progresses

### Monitoring Progress

The orchestrator polls running explorations using TaskOutput tool:
- Check status of background agents
- Update `.pairingbuddy/status.json` with iterations completed
- Present completed explorations to human for review
- Continue polling for still-running agents

### Status Updates

`.pairingbuddy/status.json` tracks exploration state:
- `running` - Agent is actively iterating
- `completed` - Agent finished requested iterations
- `killed` - Human terminated this exploration

## Agent Management Commands

During parallel explorations, the human can control running agents:

### kill

Stop an underperforming exploration:
```
Human: "Kill v3-bold, it's too aggressive"
```

Orchestrator:
1. Updates `.pairingbuddy/status.json`: `{"id": "v3-bold", "status": "killed", "iterations": 2, "reason": "Too aggressive"}`
2. Stops polling that agent (agent continues in background but is ignored)
3. Preserves artifacts in v3-bold/ folder for reference

### continue

Extend an interesting exploration:
```
Human: "v7 is interesting. Continue 4 more iterations, but make the CTAs more prominent."
```

Orchestrator:
1. Appends to v7's `.pairingbuddy/direction.json` with new guidance
2. Spawns new builder-critic loop with updated direction and run_in_background: true
3. Updates parent's `.pairingbuddy/status.json` to track new iterations

### converge

Focus on a single winner:
```
Human: "v7 is the winner. Let's refine it."
```

Orchestrator:
1. Updates `.pairingbuddy/status.json`: marks v7 as `running`, others as `killed` or `completed`
2. Switches to tight human-in-the-loop iteration on v7 only
3. No more background agents, full conversational control

## Component Promotion

During experience design, new component patterns emerge. The promotion flow moves them from local drafts to the design system.

### Discovery

The Critic agent identifies repeated patterns:
```
Critic notices: "team-card pattern used in 3 places (team-setup.html,
team-setup--empty.html, complete.html)"
```

### Draft Stage

Extract to local-components/ within the experience:
```
experience/
├── local-components/
│   └── team-card.html          # Extracted, local to this experience
├── states/
│   ├── team-setup.html         # Now references local-components/team-card.html
│   └── ...
```

### Promotion

Human requests promotion to design system:
```
Human: "Promote team-card to the design system"
```

Orchestrator:
1. Copies the component from local-components to design-system/components/
2. Updates `experience.json` to note the promotion
3. Asks: "Update source design system? This would become acme-ds v4"

Human decides whether to update the source of truth or keep it local.

## Custom Design Principles

Human operators can provide custom design principles that override or extend the defaults.

### Providing Custom Principles

Custom principles can be specified:
- In the initial direction when starting an exploration
- As a dedicated `principles.md` file in the exploration folder
- Inline during iteration feedback

### Format

```markdown
# Custom Design Principles

## Overrides
- Spacing: Use 4px base scale (overrides default 8px)
- Touch targets: 44x44px minimum (overrides default 48px)

## Extensions
- Brand voice: Playful and casual, use informal language
- Animations: Prefer spring physics, avoid linear easing
- Icons: Use outlined style only, 24px standard size
```

### Application

The orchestrator:
1. Reads default principles from reference files
2. Merges custom principles (overrides take precedence)
3. Passes combined principles to Builder and Critic agents
4. Agents apply merged principles in their work

## Version History

Every design system maintains a version history for auditability and rollback.

### History Structure

```
design-system/
├── config.json              # Current version metadata
├── tailwind.config.js       # /* acme-ds v3 - 2026-01-24 */
├── tokens.css               # /* acme-ds v3 - 2026-01-24 */
└── history/
    ├── v1.json              # Full snapshot of v1
    ├── v2.json              # Full snapshot of v2
    └── v3.json              # Full snapshot of v3
```

### Version Comments

Generated files include version comments for auditability:
```javascript
/* acme-ds v3 - 2026-01-24 */
module.exports = {
  // ...
}
```

### Creating Versions

On each iteration that produces changes:
1. Increment version in config.json
2. Save full snapshot to history/ folder
3. Update version comments in generated files

### Rollback

Use `/design-ux:rollback` to restore a previous version:
```
/design-ux:rollback my-app-ds v2
```

Orchestrator:
1. Loads the requested version snapshot from history/
2. Replaces current config.json
3. Regenerates all artifacts from that version's state
4. Creates a new version (current + 1) as the "rolled back" version

## State File Mappings

State files are organized to support parallel explorations without race conditions:

### Session State (in `.pairingbuddy/` folders - ephemeral, gitignored)

| File | Location | Purpose | Writer |
|------|----------|---------|--------|
| `brief.json` | `parent/.pairingbuddy/` | Shared requirements across parallel explorations | Orchestrator (write-once) |
| `status.json` | `parent/.pairingbuddy/` | Parallel exploration tracking | Orchestrator only |
| `direction.json` | `exploration/.pairingbuddy/` | Human's brief, constraints, feedback for THIS exploration | Orchestrator |
| `critique.json` | `exploration/.pairingbuddy/` | Latest critique findings for THIS exploration | Critic agent |

### Artifacts (in exploration folder - persistent, committed)

| File | Location | Purpose | Writer |
|------|----------|---------|--------|
| `domain-spec.json` | `exploration/` | Domain grounding from explorer agent | Explorer agent |
| `config.json` | `exploration/` | Design system metadata and version | Builder agent |
| `experience.json` | `exploration/` | Experience metadata | Builder agent |
| `tokens/`, `preview.html` | `exploration/` | Generated design artifacts | Builder agent |

### Folder Structure Example

```
explorations/
├── .pairingbuddy/                    # Parent session state (shared)
│   ├── brief.json                    # Write-once, read by all
│   └── status.json                   # Single writer (orchestrator)
│
├── v1-minimal/
│   ├── .pairingbuddy/                # v1's session state (isolated)
│   │   ├── direction.json            # v1's brief + feedback
│   │   └── critique.json             # v1's critique
│   ├── domain-spec.json              # v1's domain grounding
│   ├── config.json                   # v1's design system
│   └── tokens/
│
└── v2-playful/
    ├── .pairingbuddy/                # v2's session state (isolated)
    │   ├── direction.json            # v2's brief + feedback
    │   └── critique.json             # v2's critique
    ├── domain-spec.json              # v2's domain grounding
    ├── config.json                   # v2's design system
    └── tokens/
```

### Concurrency Safety

| File | Writer | Readers | Safe? |
|------|--------|---------|-------|
| `brief.json` | Orchestrator (once) | All agents | ✓ Write-once |
| `status.json` | Orchestrator only | Orchestrator | ✓ Single writer |
| `direction.json` | Orchestrator per-exploration | That exploration's agents | ✓ Isolated |
| `critique.json` | Critic per-exploration | Builder in same exploration | ✓ Isolated |

## How to Execute This Workflow

The design-ux workflow is conversational and human-driven, not pseudocode-based like the coding orchestrator. The orchestrator responds to human commands and spawns agents as needed.

### Reading the Pseudocode

Not applicable - design-ux uses a conversational interface instead of pseudocode workflow.

### Agent Invocation

Agents are invoked via the Task tool as needed:

```
Task tool:
  subagent_type: pairingbuddy:design-ux-builder
```

or

```
Task tool:
  subagent_type: pairingbuddy:design-ux-critic
```

### Control Flow

The orchestrator manages the builder-critic loop based on human direction rather than hardcoded control flow.

## Workflow

```python
def design_ux_workflow():
    """
    Conversational workflow for design work.

    Key principle: Each exploration has its own .pairingbuddy/ folder
    for isolated session state. Agents receive the exploration_path
    as a parameter to know where to read/write files.
    """
    # 1. Establish what we're working on
    target = _get_target()  # new DS, existing DS, new experience, etc.
    exploration_path = _get_or_create_exploration_path(target)

    # 2. Create .pairingbuddy/ in exploration folder and write direction.json
    Write(f"{exploration_path}/.pairingbuddy/direction.json", {
        "brief": human_input,
        "constraints": [],
        "feedback_history": []
    })

    # 3. EXPLORER PHASE (MANDATORY - runs first)
    # Pass exploration_path so agent knows where to read/write
    _invoke_explorer_agent(exploration_path)
    # Reads: {exploration_path}/.pairingbuddy/direction.json (optional)
    # Writes: {exploration_path}/domain-spec.json

    # 4. Set exploration parameters
    params = _get_exploration_params()
    # - iterations_before_checkpoint
    # - parallel_directions (1..N)
    # - max_iterations

    # 5. For parallel explorations: create parent .pairingbuddy/ with shared state
    if params.parallel_directions > 1:
        parent_path = _get_parent_path(exploration_path)
        Write(f"{parent_path}/.pairingbuddy/brief.json", {
            "title": target,
            "requirements": shared_requirements,
            "constraints": [],
            "created": now()
        })
        Write(f"{parent_path}/.pairingbuddy/status.json", {
            "created": now(),
            "agents": [{"id": dir_id, "status": "running", ...} for dir_id in params.directions]
        })

        # Create isolated .pairingbuddy/ for each exploration
        for direction in params.directions:
            exp_path = f"{parent_path}/{direction.id}"
            Write(f"{exp_path}/.pairingbuddy/direction.json", {
                "brief": Read(f"{parent_path}/.pairingbuddy/brief.json")["requirements"],
                "angle": direction.specific_angle,
                "constraints": [],
                "feedback_history": []
            })

    # 6. Spawn explorations (parallel if N > 1)
    for direction in params.directions:
        exp_path = f"{parent_path}/{direction.id}" if params.parallel_directions > 1 else exploration_path
        _run_exploration(exp_path, params, run_in_background=(params.parallel_directions > 1))

    # 7. Poll and present completions, handle human commands
    if params.parallel_directions > 1:
        _monitor_and_respond(parent_path)


def _run_exploration(exploration_path, params, run_in_background=False):
    """
    Single exploration loop: builder-critic cycle until done.

    All file paths are relative to exploration_path:
    - Session state: {exploration_path}/.pairingbuddy/
    - Artifacts: {exploration_path}/

    This ensures parallel explorations don't conflict.
    """
    iterations = 0
    while iterations < params.max_iterations:
        # Builder agent receives exploration_path
        # Reads:
        #   {exploration_path}/.pairingbuddy/direction.json
        #   {exploration_path}/domain-spec.json
        #   {exploration_path}/.pairingbuddy/critique.json (optional)
        #   {exploration_path}/config.json or experience.json
        # Writes:
        #   {exploration_path}/tokens/, components/, preview.html, etc.
        _invoke_builder_agent(exploration_path)

        # Critic agent receives exploration_path
        # Reads:
        #   {exploration_path}/.pairingbuddy/direction.json
        #   {exploration_path}/domain-spec.json
        #   {exploration_path}/config.json or experience.json
        #   {exploration_path}/preview.html (artifacts)
        # Writes:
        #   {exploration_path}/.pairingbuddy/critique.json
        _invoke_critic_agent(exploration_path)

        iterations += 1

        if iterations % params.iterations_before_checkpoint == 0:
            _present_to_human()
            response = _get_human_response()  # feedback, kill, continue
            if response == "kill":
                return
            if response.has_feedback:
                # Append to THIS exploration's direction.json
                direction_file = f"{exploration_path}/.pairingbuddy/direction.json"
                direction_data = Read(direction_file)
                direction_data["feedback_history"].append({
                    "iteration": iterations,
                    "feedback": response.feedback,
                    "timestamp": now()
                })
                Write(direction_file, direction_data)
```

## Orchestrator Behavior

### Bootstrap test-config.json

Not applicable - design-ux does not use test-config.json.

### State File Management

The orchestrator manages state files with isolation for parallel safety:

**Per-exploration `.pairingbuddy/` folder:**
- Creates `{exploration_path}/.pairingbuddy/` on first run
- Writes `direction.json` from human input (isolated per exploration)
- Passes `critique.json` between builder and critic (isolated per exploration)

**Per-exploration artifacts:**
- Writes `domain-spec.json` from explorer agent
- Maintains version history in `config.json`

**Parent `.pairingbuddy/` folder (parallel explorations only):**
- Writes `brief.json` with shared requirements (write-once)
- Writes `status.json` to track all explorations (single writer)

**Path passing:** Agents receive `exploration_path` parameter to know where to read/write files. This enables parallel explorations without race conditions.

### Human Checkpoints

The orchestrator pauses for human review after:
- Builder completes initial generation
- Critic completes analysis
- Each iteration cycle

### Error Handling

If agents fail or produce invalid output:
- Report the error to the human
- Ask how to proceed
- Do not attempt automatic recovery

## Prerequisites

### Playwright MCP Check

At skill start, check for Playwright MCP availability:

1. Look for Playwright MCP in available tools
2. If unavailable:
   - Inform user: "Playwright MCP not detected. Visual critique/iteration requires it. Install from [Playwright MCP](https://github.com/anthropics/anthropic-cookbook/tree/main/misc/mcp_playwright)"
   - Offer: "Continue in generation-only mode? (No visual feedback)"
3. If available: proceed with full capabilities

### Local Server for Playwright

**Playwright cannot access file:// URLs directly.** Serve design systems over localhost:

**Start server** (from design system output directory):
```bash
python -m http.server 8000
```

Alternative options:
```bash
npx serve -p 8000        # if npm available
php -S localhost:8000    # if PHP available
```

**Use localhost URLs** in Playwright:
```
Instead of: file:///path/to/preview.html
Use:        http://localhost:8000/preview.html
```

**Server lifecycle:**
1. Start server before first Playwright operation
2. Keep running during all builder-critic iterations
3. Stop when exploration completes or user exits

**For parallel explorations - explicit port mapping:**

Each exploration gets its own port. Track in status.json:
```json
{
  "created": "2026-01-24T10:00:00Z",
  "agents": [
    {"id": "v1-minimal", "status": "running", "iterations": 0, "port": 8001},
    {"id": "v2-playful", "status": "running", "iterations": 0, "port": 8002},
    {"id": "v3-bold", "status": "running", "iterations": 0, "port": 8003}
  ]
}
```

Start servers for each:
```bash
cd v1-minimal && python -m http.server 8001 &
cd v2-playful && python -m http.server 8002 &
cd v3-bold && python -m http.server 8003 &
```

**Always use the correct port for each exploration** - never navigate to the wrong port or you'll critique the wrong design system.

### Reference Skills

**Agents automatically load their assigned skills. The skills contain:**

1. **applying-design-principles** - Core UX principles (Rams, Norman, Laws of UX)
2. **critiquing-designs** - 6-pass critique framework
3. **building-components** - Component patterns and domain packs
4. **differentiating-designs** - Craft knowledge for intentional differentiation

**For additional context, optionally read:**
- External design notes if user provides paths
- Existing design systems in target project for consistency

## Commands

### /design-ux:create

Create a new design system from description or structured input.

**Usage:**
```
/design-ux:create "Modern, minimalist, trustworthy, blue as primary"
/design-ux:create --from design-brief.yaml
```

**Workflow:**
1. Parse input (free-form or structured)
2. Normalize to structured config
3. Ask: "What are you building?" (select component packs)
4. Ask: "Where to create the design system folder?"
5. Show config summary, confirm
6. Generate tokens (brand → alias → mapped)
7. Generate artifacts (tailwind.config.js, tokens.css, preview.html using templates)
8. Run critique (if Playwright available)
9. Present findings, iterate until approved

### /design-ux:iterate

Modify an existing design system.

**Usage:**
```
/design-ux:iterate my-app-ds "Make it warmer, reduce contrast"
/design-ux:iterate my-app-ds "Add data table component"
```

**Workflow:**
1. Load config.json from design system folder
2. Show current state summary
3. Apply requested changes
4. Create new version (v+1)
5. Regenerate artifacts using templates
6. Run critique
7. Present findings, iterate until approved

### /design-ux:critique

Run critique passes on existing design system.

**Usage:**
```
/design-ux:critique my-app-ds
```

### /design-ux:compare

Generate and compare multiple variations.

**Usage:**
```
/design-ux:compare my-app-ds --variations 3 "Try blue, green, purple"
```

### /design-ux:select

Select a variation as the main design system.

**Usage:**
```
/design-ux:select my-app-ds --variation green
```

### /design-ux:view

Open the preview.html in browser.

**Usage:**
```
/design-ux:view my-app-ds
```

### /design-ux:rollback

Rollback to a previous version.

**Usage:**
```
/design-ux:rollback my-app-ds v2
```

## Input Processing

### Free-form Description

Extract and normalize:
- Personality keywords → influence token choices
- Color mentions → primary/secondary colors
- Target audience → density, formality
- Style keywords → typography choices

### Structured Format (YAML/JSON)

```yaml
name: my-app-ds
description: Design system for professional SaaS app

brand:
  personality: [modern, minimalist, trustworthy]
  primary_color: blue        # name, hex, or "generate"
  secondary_color: neutral

typography:
  style: clean               # clean, classic, friendly, technical
  scale: minor-third

spacing:
  base: 8                    # 4 or 8
  density: comfortable       # compact, comfortable, spacious

constraints:
  accessibility: AA          # AA or AAA
  dark_mode: true

inspiration: []              # URLs or brand references
```

## Output Structure

Each design system lives in its own self-contained folder:

```
<design-system-name>/
├── config.json           # Full config + metadata
├── tokens/
│   ├── brand.json        # Tier 1: Raw values
│   ├── alias.json        # Tier 2: Semantic mapping
│   └── mapped.json       # Tier 3: Application tokens
├── tailwind.config.js    # Ready-to-use Tailwind v3
├── tokens.css            # CSS variables
├── preview.html          # MUST use template - design system preview
├── example.html          # Optional - contextual usage example
├── variations/           # When comparing
│   ├── blue/
│   ├── green/
│   └── purple/
├── compare.html          # Tabbed comparison view
└── history/              # Version snapshots
    ├── v1.json
    ├── v2.json
    └── v3.json
```

## Token Generation

### Tier 1: Brand Collection

Generate raw color scales using the opacity blending technique:

1. **Position brand color at 500**
2. **Lighter shades (50-400):** Brand color on white, reduce opacity (10%-80%), sample
3. **Darker shades (600-900):** Brand color on black, reduce opacity (80%-40%), sample
4. **Name scale:** 50, 100, 200, 300, 400, 500, 600, 700, 800, 900

**Minimum scales:**
- Primary (brand color)
- Neutral (gray)
- Error (red)
- Success (green)
- Warning (amber)
- Info (blue, if not primary)

**Also generate:**
- Foundation: black, white
- Typography: families, weights
- Numeric scale: 0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900 (used for spacing, radius, sizing)

### Tier 2: Alias Collection

Map semantic names to brand values:

```json
{
  "colors": {
    "primary": { "ref": "blue", "default": "600" },
    "neutral": { "ref": "neutral", "default": "500" },
    "error": { "ref": "red", "default": "600" },
    "success": { "ref": "green", "default": "600" },
    "warning": { "ref": "amber", "default": "500" }
  },
  "border": {
    "width": { "none": "0", "sm": "100", "md": "200", "lg": "300" },
    "radius": { "none": "0", "sm": "100", "md": "200", "lg": "300", "full": "9999" }
  }
}
```

**Note:** Names are examples. Adapt based on project needs.

### Tier 3: Mapped Collection

Application-level tokens for actual use:

```json
{
  "light": {
    "text": {
      "heading": "neutral.900",
      "body": "neutral.700",
      "muted": "neutral.500"
    },
    "surface": {
      "page": "white",
      "primary": "neutral.50"
    }
  },
  "dark": {
    "text": {
      "heading": "neutral.50",
      "body": "neutral.300",
      "muted": "neutral.400"
    },
    "surface": {
      "page": "neutral.900",
      "primary": "neutral.800"
    }
  }
}
```

### Dark Mode Generation

**Approach:** Reverse the color scale values between light and dark mode.

**Light mode** uses lighter values (50-400):
- Text: neutral.900, neutral.700, neutral.500
- Surfaces: white, neutral.50, neutral.100

**Dark mode** uses darker values (600-900), reversed:
- Text: neutral.50, neutral.300, neutral.400
- Surfaces: neutral.900, neutral.800, neutral.700

**Color reversal pattern:**
| Light | Dark |
|-------|------|
| 50 | 900 |
| 100 | 800 |
| 200 | 700 |
| 300 | 600 |
| 400 | 500 |
| 500 | 400 |
| 600 | 300 |
| 700 | 200 |
| 800 | 100 |
| 900 | 50 |

**Fixed colors:** Some colors should NOT change between modes. Use `-fixed` suffix in alias names to indicate this:
- Primary action colors (buttons) often stay the same
- Brand accent colors may stay fixed
- Example: `primary.500-fixed` stays `primary.500` in both modes

**CSS output structure (three-tier architecture):**

```css
:root {
  /* ============================================
     TIER 1: BRAND - Raw values
     These are the foundation, never change between modes
     ============================================ */

  /* Color scales (50-900) */
  --color-primary-50: #eff6ff;
  --color-primary-500: #2563eb;
  --color-primary-900: #1e3a8a;
  --color-neutral-50: #fafafa;
  --color-neutral-500: #737373;
  --color-neutral-900: #171717;
  /* ... full scales 50-900 for each color ... */

  /* Numeric scale - used for spacing, sizing, radius, etc. */
  --scale-0: 0;
  --scale-25: 1px;      /* edge case */
  --scale-50: 2px;      /* edge case */
  --scale-100: 4px;
  --scale-200: 8px;
  --scale-300: 12px;
  --scale-400: 16px;
  --scale-500: 20px;
  --scale-600: 24px;
  --scale-700: 28px;
  --scale-800: 32px;
  --scale-900: 36px;

  /* Shadow raw values */
  --shadow-raw-100: 0 1px 2px hsl(0 0% 0% / 0.05);
  --shadow-raw-200: 0 2px 4px hsl(0 0% 0% / 0.08);
  --shadow-raw-300: 0 4px 12px hsl(0 0% 0% / 0.1);
  --shadow-raw-400: 0 8px 24px hsl(0 0% 0% / 0.15);
  --shadow-raw-500: 0 16px 48px hsl(0 0% 0% / 0.2);

  /* Duration raw values */
  --duration-100: 100ms;
  --duration-200: 150ms;
  --duration-300: 300ms;
  --duration-400: 500ms;

  /* Easing raw values */
  --easing-default: cubic-bezier(0.4, 0, 0.2, 1);
  --easing-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* ============================================
     TIER 2: ALIAS - Semantic names referencing brand
     Give meaning to the raw scale values
     ============================================ */

  /* Spacing (references numeric scale) */
  --spacing-xs: var(--scale-100);      /* 4px */
  --spacing-sm: var(--scale-200);      /* 8px */
  --spacing-md: var(--scale-300);      /* 12px */
  --spacing-lg: var(--scale-400);      /* 16px */
  --spacing-xl: var(--scale-600);      /* 24px */
  --spacing-2xl: var(--scale-800);     /* 32px */

  /* Radius (references same numeric scale) */
  --radius-sm: var(--scale-100);       /* 4px */
  --radius-md: var(--scale-200);       /* 8px */
  --radius-lg: var(--scale-300);       /* 12px */
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: var(--shadow-raw-100);
  --shadow-md: var(--shadow-raw-300);
  --shadow-lg: var(--shadow-raw-400);

  /* Transitions */
  --transition-fast: var(--duration-200) var(--easing-default);
  --transition-smooth: var(--duration-300) var(--easing-default);
  --transition-spring: var(--duration-400) var(--easing-spring);

  /* Border widths (references numeric scale) */
  --border-thin: var(--scale-25);      /* 1px */
  --border-medium: var(--scale-50);    /* 2px */

  /* Touch target (accessibility) */
  --touch-target: 48px;

  /* ============================================
     TIER 3: MAPPED - Application tokens (Light mode)
     Component-specific, references aliases
     ============================================ */

  /* Text colors */
  --text-heading: var(--color-neutral-900);
  --text-body: var(--color-neutral-700);
  --text-muted: var(--color-neutral-500);

  /* Surface colors */
  --surface-page: white;
  --surface-card: var(--color-neutral-50);
  --surface-action: var(--color-primary-500);

  /* Border colors */
  --border-default: var(--color-neutral-200);
  --border-focus: var(--color-primary-500);

  /* Component tokens - using aliases */
  --button-padding-x: var(--spacing-lg);
  --button-padding-y: var(--spacing-sm);
  --button-radius: var(--radius-md);
  --card-padding: var(--spacing-xl);
  --card-radius: var(--radius-lg);
  --card-shadow: var(--shadow-md);
  --input-padding: var(--spacing-sm) var(--spacing-md);
  --input-radius: var(--radius-md);
}

.dark {
  /* ============================================
     TIER 3: MAPPED - Application tokens (Dark mode)
     Only semantic/mapped tokens change, brand stays same
     ============================================ */

  /* Text colors - reversed */
  --text-heading: var(--color-neutral-50);
  --text-body: var(--color-neutral-300);
  --text-muted: var(--color-neutral-400);

  /* Surface colors - reversed */
  --surface-page: var(--color-neutral-900);
  --surface-card: var(--color-neutral-800);
  --surface-action: var(--color-primary-500);  /* stays same */

  /* Border colors - reversed */
  --border-default: var(--color-neutral-700);
  --border-focus: var(--color-primary-400);
}
```

**The chain of references:**
```
Brand (raw)  →  Alias (semantic)  →  Mapped (application)
--scale-400     --spacing-lg         --button-padding-x
    16px    →      16px         →        16px
```

The same `--scale-400` can be used for both spacing and radius:
```
--scale-400 → --spacing-lg  → --button-padding-x
--scale-400 → --radius-lg   → --card-radius
```

**CRITICAL: Components use MAPPED tokens, not brand or alias directly:**
```css
.button {
  padding: var(--button-padding-y) var(--button-padding-x);
  border-radius: var(--button-radius);
}

.card {
  padding: var(--card-padding);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
```

This allows changing a button's padding globally by updating `--button-padding-x` once.

## Template System

**CRITICAL**: Templates ensure consistent, comparable output. Never skip them.

### Preview Generation (Design Systems)

**MANDATORY** - When generating preview.html:
1. Read [preview template](./templates/preview-template.html) first
2. Replace placeholders with generated content
3. Never generate preview.html from scratch

### Example Page Generation

**OPTIONAL** - When context suggests a specific use case (e.g., "design system for a farming insurance company"):
1. Generate `example.html` using the [example template](./templates/example-template.html)
2. Include the dark mode toggle (built into template)
3. Should demonstrate real-world application of the tokens/components

**Template placeholders:**
- `{{DS_NAME}}` - Design system name
- `{{CSS_VARIABLES}}` - Generated design tokens (same as preview.html)
- `{{EXAMPLE_TITLE}}` - Page title (e.g., "Acme Landing Page")
- `{{EXAMPLE_STYLES}}` - Page-specific CSS for the example
- `{{EXAMPLE_CONTENT}}` - Main page HTML content

### Prototype Generation (Experiences)

When generating prototype.html, use the [prototype template](./templates/prototype-template.html).

The template uses placeholder markers that get replaced with actual data:

- `{{DS_NAME}}` - Design system name
- `{{DS_VERSION}}` - Version number
- `{{DS_DESCRIPTION}}` - Description
- `{{BRAND_COLORS}}` - Generated brand color HTML
- `{{SEMANTIC_COLORS}}` - Generated semantic token HTML
- `{{TYPOGRAPHY}}` - Typography specimens
- `{{SPACING}}` - Spacing scale visualization
- `{{COMPONENTS}}` - Component examples based on selected packs
- `{{CSS_VARIABLES}}` - Embedded CSS from tokens

### Component Rendering

For each component pack selected:
1. The builder agent loads the **building-components** skill automatically
2. Generate HTML for each component with all states
3. Insert into the Components tab section

### Dynamic Sections

The template includes conditional sections:
- SaaS components (if `saas` pack selected)
- E-commerce components (if `ecommerce` pack selected)
- Marketing components (if `marketing` pack selected)
- Forms components (if `forms` pack selected)
- Mobile components (if `mobile` pack selected)

## Generated Files

**Per design system folder:**

| File | Purpose |
|------|---------|
| `config.json` | Design system metadata (name, version, settings) |
| `tokens.css` | CSS variables - all three tiers, light + dark mode |
| `tailwind.config.js` | Tailwind v3 config - references CSS vars |
| `tailwind.v4.css` | Tailwind v4 config - uses @theme directive |
| `preview.html` | Component visualization - uses Tailwind classes |
| `example.html` | Contextual demo - uses Tailwind classes |

**At exploration root (for parallel explorations):**

| File | Purpose |
|------|---------|
| `index.html` | Navigation linking to all design systems |
| `comparison.html` | Side-by-side comparison with screenshots |
| `screenshots/` | PNG screenshots for comparison |
| `robots.txt` | Prevent indexing |

**Why both v3 and v4 configs?**
- v3 for compatibility with existing projects
- v4 for newer projects using CSS-native approach
- Same visual output, different config formats

## Tailwind Generation

### tailwind.config.js (v3)

```javascript
module.exports = {
  content: ['./*.html'],
  darkMode: 'class',
  theme: {
    extend: {
      // TIER 1: Brand - raw color scales
      colors: {
        primary: {
          50: 'hsl(var(--color-primary-50))',
          500: 'hsl(var(--color-primary-500))',
          900: 'hsl(var(--color-primary-900))',
          // ... full scale ...
        },
        neutral: { /* same pattern */ },
      },

      // TIER 2: Alias - semantic tokens
      spacing: {
        'xs': 'var(--spacing-xs)',
        'sm': 'var(--spacing-sm)',
        'md': 'var(--spacing-md)',
        'lg': 'var(--spacing-lg)',
        'xl': 'var(--spacing-xl)',
      },
      borderRadius: {
        'sm': 'var(--radius-sm)',
        'md': 'var(--radius-md)',
        'lg': 'var(--radius-lg)',
        'full': 'var(--radius-full)',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
      },

      // TIER 3: Mapped - component tokens
      textColor: {
        'heading': 'hsl(var(--text-heading))',
        'body': 'hsl(var(--text-body))',
        'muted': 'hsl(var(--text-muted))',
      },
      backgroundColor: {
        'page': 'hsl(var(--surface-page))',
        'card': 'hsl(var(--surface-card))',
        'action': 'hsl(var(--surface-action))',
      },
    },
  },
}
```

### tailwind.v4.css

```css
@import "tailwindcss";
@import "./tokens.css";

@theme {
  /* Colors reference tokens.css variables */
  --color-primary-50: hsl(var(--color-primary-50));
  --color-primary-500: hsl(var(--color-primary-500));
  /* ... */

  /* Spacing */
  --spacing-xs: var(--spacing-xs);
  --spacing-sm: var(--spacing-sm);
  --spacing-lg: var(--spacing-lg);
  /* ... */
}
```

## HTML Files Use Tailwind Classes

**CRITICAL:** preview.html and example.html must:
1. Link to tokens.css (not embed styles inline)
2. Use Tailwind CDN with inline config
3. Use Tailwind utility classes (not custom CSS)

This allows editing tokens.css and seeing changes on refresh.

### HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{DS_NAME}} Preview</title>

  <!-- 1. Link to tokens (editable) -->
  <link href="tokens.css" rel="stylesheet">

  <!-- 2. Tailwind CDN with inline config -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          // Same config as tailwind.config.js
          spacing: {
            'xs': 'var(--spacing-xs)',
            'sm': 'var(--spacing-sm)',
            'lg': 'var(--spacing-lg)',
          },
          // ... etc
        }
      }
    }
  </script>
</head>
<body class="bg-page text-body">
  <!-- 3. Use Tailwind classes -->
  <button class="px-lg py-sm bg-action text-white rounded-md shadow-md">
    Click me
  </button>
</body>
</html>
```

### Benefits

- **Editable**: Change tokens.css → refresh → see results
- **Real patterns**: Shows actual Tailwind usage
- **Copy-paste ready**: Classes work in your project
- **No inline CSS mess**: Clean, readable HTML
```

### Generated Files Summary

| File | Purpose |
|------|---------|
| `tokens/brand.json` | Tier 1: Raw values (scales, colors) |
| `tokens/alias.json` | Tier 2: Semantic mappings |
| `tokens/mapped.json` | Tier 3: Application tokens |
| `tokens.css` | CSS variables (all three tiers) |
| `tailwind.config.js` | Tailwind config referencing CSS vars |
| `preview.html` | Interactive visualization |
| `example.html` | Optional contextual demo |

## Critique Framework (6 Passes)

When Playwright is available, run visual critique after generation. The critic agent loads the **critiquing-designs** skill which contains the full 6-pass framework.

### Pass Summary
1. **Mental Model** - Do token names communicate intent?
2. **Information Architecture** - Are tokens logically organized?
3. **Affordances** - Do interactive elements signal action?
4. **Cognitive Load** - Are there too many similar options?
5. **State Design** - Are all states covered and distinct?
6. **Flow Integrity** - Does the system work cohesively?

## Playwright Integration

**Important:** Playwright accesses files via localhost, not file:// URLs. See "Local Server for Playwright" in Prerequisites.

### Starting a Viewing Session

Before any Playwright operations:
1. Start local server in design system folder:
   ```bash
   python -m http.server 8000
   ```
2. Navigate Playwright to the localhost URL (e.g., port 8000, path /preview.html)
3. For parallel explorations, use different ports or serve parent folder

### Screenshot Capture for Web Output

**Mandatory:** After each exploration completes, capture screenshots for the comparison page:

1. Navigate to the example.html page (not preview.html) at localhost
2. Set viewport to 1200x800px
3. Screenshot the full page
4. Save to screenshots folder, naming by exploration folder (01-bold becomes 01-bold.png)

These screenshots are used in comparison.html instead of iframes (which don't work reliably across hosts).

### Screenshot + Critique (Default Mode)

1. Navigate to the localhost URL for preview.html
2. Screenshot key sections (data-testid targets)
3. Analyze screenshots against principles
4. Present findings to human
5. Human approves/rejects/modifies
6. Apply changes, repeat

### Autonomous Iteration (Delegated Mode)

When human says "iterate until X":
1. Set stopping conditions from human input
2. Run critique loop autonomously
3. Log each iteration to history/
4. Stop when conditions met OR max 5 iterations
5. Return summary of changes made

### Stopping the Server

When exploration completes:
1. Stop the local server (Ctrl+C or kill the process)
2. Inform user that viewing session has ended

## Error Handling

### Color Doesn't Work
If provided color produces poor contrast or accessibility issues:
1. Warn human
2. Suggest alternatives
3. Ask how to proceed

### Accessibility Conflict
If brand colors conflict with AA/AAA requirements:
1. Show the conflict
2. Propose adjusted colors that meet requirements
3. Human decides: adjust or accept compromise

## Web Hosting Output

Design explorations produce web-hostable output that can be copied directly to any web server.

### Output Structure

After explorations complete, the folder is ready to deploy:

```
explorations/
├── index.html              # Navigation page with cards for each DS
├── comparison.html         # Side-by-side screenshot comparison
├── robots.txt              # Blocks indexing (noindex, nofollow)
├── screenshots/            # Auto-captured during exploration
│   ├── 01-jordbruk.png
│   ├── 02-satellite.png
│   └── ...
├── 01-jordbruk/
│   ├── preview.html        # Design system tokens/components
│   ├── example.html        # Contextual landing page
│   └── tokens.css
├── 02-satellite-view/
│   └── ...
└── ...
```

### Generating Web Output

When explorations complete, generate navigation pages using templates:

1. Read [index template](./templates/index-template.html)
2. Read [comparison template](./templates/comparison-template.html)
3. Replace placeholders with exploration data
4. Write `index.html`, `comparison.html`, and `robots.txt` to exploration root
5. Ensure all screenshots are captured to `screenshots/` folder

### robots.txt

Always generate to prevent search engine indexing:

```
User-agent: *
Disallow: /
```

### index.html (Navigation Page)

Generate from [index-template.html](./templates/index-template.html) with cards for each design system:

**Card structure:**
- Number and name (e.g., "01 Bold")
- Theme subtitle (e.g., "Confident Modern")
- Links: "Design Tokens" → preview.html, "Live Example" → example.html

**Styling requirements:**
- Self-contained CSS (no external dependencies for portability)
- Responsive grid layout
- Clean, neutral styling that doesn't compete with the design systems
- Link to comparison.html at bottom

### comparison.html (Side-by-Side View)

Generate from [comparison-template.html](./templates/comparison-template.html) using **screenshots** (not iframes - they don't work reliably across hosts):

**Structure:**
- Header with title and description
- Quick navigation anchors to each design system
- Cards showing screenshot + metadata + links
- Summary table comparing all systems

**Screenshots:**
- Captured automatically using Playwright during exploration
- Stored in screenshots/ folder
- Named by design system folder (e.g., 01-jordbruk.png)
- Captured at 1200x800px for consistency

**Card content:**
- Screenshot image
- Name, theme, personality description
- Color palette swatches
- Primary CTA linking to example.html
- Secondary CTA linking to preview.html (components)

### Path Requirements

**Critical:** All paths must be relative for portability:

```html
<!-- CORRECT - relative paths -->
<a href="01-bold/example.html">View Landing Page</a>
<img src="screenshots/01-bold.png">

<!-- WRONG - absolute paths won't work on subfolder deploys -->
<a href="/01-bold/example.html">View Landing Page</a>
```

### Deployment

The output folder can be deployed to:
- Vercel (drag & drop or git)
- Netlify
- GitHub Pages
- Any static web server
- NextJS public folder

Simply copy the entire explorations/ folder to the hosting destination.

### Sharing Link

After deployment, share the URL to:
- index.html for the navigation view
- comparison.html for side-by-side comparison
- Individual example.html pages for specific designs

## Skill Evolution

**This skill will evolve.** During use:
1. Note what doesn't work well
2. Propose improvements
3. Update this SKILL.md as needed
