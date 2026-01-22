---
name: design-ux
description: Creates, iterates, and manages production-ready design systems with three-tiered token architecture, Tailwind CSS output, and visual critique via Playwright MCP.
---

# Design UX Skill

Creates, iterates, and manages production-ready design systems. Generates three-tiered token architecture (brand, alias, mapped), interactive HTML visualization, and Tailwind CSS configuration.

**Announce at start:** "I'm using the design-ux skill to [create/iterate on] your design system."

## Prerequisites

### Playwright MCP Check

At skill start, check for Playwright MCP availability:

1. Look for Playwright MCP in available tools
2. If unavailable:
   - Inform user: "Playwright MCP not detected. Visual critique/iteration requires it. Install from: https://github.com/anthropics/anthropic-cookbook/tree/main/misc/mcp_playwright"
   - Offer: "Continue in generation-only mode? (No visual feedback)"
3. If available: proceed with full capabilities

### Reference Files

**Before generating or critiquing, read these skill reference files:**

1. `reference/design-principles.md` - Core UX principles (Rams, Norman, Laws of UX)
2. `reference/ux-passes.md` - 6-pass critique framework
3. `reference/component-specs.md` - Component patterns and domain packs

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
├── preview.html          # Interactive visualization (from template)
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
- Spacing scale: 0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900

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

## Template System

### Preview Generation

When generating preview.html, use the template at `templates/preview-template.html`.

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
1. Read component specs from `reference/component-specs.md`
2. Generate HTML for each component with all states
3. Insert into the Components tab section

### Dynamic Sections

The template includes conditional sections:
- SaaS components (if `saas` pack selected)
- E-commerce components (if `ecommerce` pack selected)
- Marketing components (if `marketing` pack selected)
- Forms components (if `forms` pack selected)
- Mobile components (if `mobile` pack selected)

## Tailwind Generation

### tailwind.config.js

```javascript
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Brand tier - raw scales
      colors: {
        blue: { 50: '...', /* ... */ 900: '...' },
        neutral: { /* ... */ },
      },

      // Mapped tier - semantic tokens via CSS vars
      textColor: {
        heading: 'var(--text-heading)',
        body: 'var(--text-body)',
      },
      backgroundColor: {
        page: 'var(--surface-page)',
        action: 'var(--surface-action)',
      },

      // Border radius with calc() for single source of truth
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },

      keyframes: { /* ... */ },
      animation: { /* ... */ },
    },
  },
  plugins: [],
}
```

## Critique Framework (6 Passes)

When Playwright is available, run visual critique after generation. See `reference/ux-passes.md` for full details.

### Pass Summary
1. **Mental Model** - Do token names communicate intent?
2. **Information Architecture** - Are tokens logically organized?
3. **Affordances** - Do interactive elements signal action?
4. **Cognitive Load** - Are there too many similar options?
5. **State Design** - Are all states covered and distinct?
6. **Flow Integrity** - Does the system work cohesively?

## Playwright Integration

### Screenshot + Critique (Default Mode)

1. Open preview.html in Playwright
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

## Skill Evolution

**This skill will evolve.** During use:
1. Note what doesn't work well
2. Propose improvements
3. Update this SKILL.md as needed
