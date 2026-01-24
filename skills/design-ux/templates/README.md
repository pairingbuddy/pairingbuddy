# Design UX Templates

This directory contains HTML templates for generating design system previews and experience prototypes.

## Templates

| Template | Purpose |
|----------|---------|
| `preview-template.html` | Design system visualization (colors, typography, components) |
| `prototype-template.html` | Experience prototype (clickable state machine with navigation) |

## Template Placeholders

The `preview-template.html` file uses placeholder markers that get replaced with generated content.

### Metadata Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{DS_NAME}}` | Design system name | `my-app-ds` |
| `{{DS_VERSION}}` | Version number | `1` |
| `{{DS_DESCRIPTION}}` | Brief description | `Design system for SaaS app` |

### Token Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{CSS_VARIABLES}}` | Full CSS with all variables (brand, alias, mapped) for light/dark modes |
| `{{BRAND_COLORS}}` | HTML for brand color scale swatches |
| `{{SEMANTIC_COLORS}}` | HTML for semantic token cards |

### Typography Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{TYPOGRAPHY}}` | Type scale specimen HTML |
| `{{TYPOGRAPHY_DESCRIPTION}}` | e.g., "Inter for UI, JetBrains Mono for code. Minor third scale." |
| `{{MONO_FONT}}` | Monospace font name |

### Spacing Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{SPACING}}` | Spacing scale visualization HTML |
| `{{SPACING_BASE}}` | Base unit (4 or 8) |
| `{{SPACING_DENSITY}}` | Density level (compact, comfortable, spacious) |
| `{{RADIUS}}` | Border radius examples HTML |
| `{{SHADOWS}}` | Shadow examples HTML |

### Motion Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{TRANSITIONS}}` | Transition demo cards HTML |
| `{{ANIMATIONS}}` | Animation demo boxes HTML |

### Component Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{COMPONENT_STYLES}}` | CSS for all components (buttons, inputs, etc.) |
| `{{CORE_COMPONENTS}}` | HTML for core components (always rendered) |
| `{{PACK_COMPONENTS}}` | HTML for domain pack components (conditional) |

## How Placeholders Are Replaced

The skill reads the template, then performs string replacement for each placeholder with generated HTML/CSS based on:

1. **config.json** - Design system configuration
2. **tokens/brand.json** - Raw color values
3. **tokens/alias.json** - Semantic mappings
4. **tokens/mapped.json** - Application-level tokens

### Example: Brand Colors

```html
<!-- Template -->
<div class="color-grid" data-testid="brand-colors">
{{BRAND_COLORS}}
</div>

<!-- Generated -->
<div class="color-grid" data-testid="brand-colors">
  <div class="color-scale">
    <div class="color-scale-header">Purple (Primary)</div>
    <div class="color-swatch-row" onclick="copyValue('#faf5ff')">
      <div class="color-swatch" style="background: #faf5ff"></div>
      <div class="color-swatch-info">
        <span class="color-swatch-name">50</span>
        <span class="color-swatch-value">#faf5ff</span>
      </div>
    </div>
    <!-- ... more swatches ... -->
  </div>
</div>
```

## Conditional Sections

Pack components are only included when the pack is selected:

```html
<!-- If config.components.packs includes "saas" -->
{{PACK_COMPONENTS}} includes:
- Data Table
- Stat Cards
- Progress Bars
- etc.

<!-- If config.components.packs includes "forms" -->
{{PACK_COMPONENTS}} includes:
- Multi-step Form
- File Upload
- Date Picker
- etc.
```

## Adding New Components

1. Define the component in `reference/component-specs.md`
2. Add CSS styles in `{{COMPONENT_STYLES}}` generation
3. Add HTML in `{{CORE_COMPONENTS}}` or `{{PACK_COMPONENTS}}` generation
4. Include all states (default, hover, focus, disabled, etc.)
5. Add `data-testid` attributes for Playwright

## Test IDs for Playwright (Preview Template)

The preview template includes `data-testid` attributes for visual testing:

- `header` - Page header
- `theme-toggle` - Dark/light mode toggle
- `tabs` - Tab navigation
- `tab-colors`, `tab-typography`, etc. - Individual tabs
- `content-colors`, `content-typography`, etc. - Tab content areas
- `brand-colors` - Brand color swatches grid
- `semantic-colors` - Semantic token cards grid
- `type-scale` - Typography specimens
- `spacing-scale` - Spacing visualization
- `buttons`, `inputs`, etc. - Component sections

---

# Prototype Template

The `prototype-template.html` is used for experience prototypes - clickable walkthroughs of user flows.

## Prototype Placeholders

### Metadata Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{EXPERIENCE_NAME}}` | Experience name | `onboarding-flow` |
| `{{ITERATION}}` | Current iteration number | `3` |
| `{{DESIGN_SYSTEM}}` | Source design system name | `acme-ds` |
| `{{DS_VERSION}}` | Design system version | `3` |
| `{{TIMESTAMP}}` | Last update timestamp | `2026-01-24 14:30` |

### Content Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{EMBEDDED_CSS}}` | CSS tokens from the design system (copied from tokens.css) |
| `{{STATE_NAVIGATION}}` | Navigation buttons for each state |
| `{{STATES_CONTENT}}` | HTML content for all states |
| `{{FLOW_JSON}}` | JavaScript object defining state machine |

### State Navigation Example

```html
<!-- Generated {{STATE_NAVIGATION}} -->
<button class="prototype-nav-state active" data-state="welcome" onclick="showState('welcome')">Welcome</button>
<button class="prototype-nav-state" data-state="select-plan" onclick="showState('select-plan')">Select Plan</button>
<button class="prototype-nav-state error-state" data-state="select-plan--error" onclick="showState('select-plan--error')">Select Plan (Error)</button>
<button class="prototype-nav-state" data-state="team-setup" onclick="showState('team-setup')">Team Setup</button>
<button class="prototype-nav-state empty-state" data-state="team-setup--empty" onclick="showState('team-setup--empty')">Team Setup (Empty)</button>
<button class="prototype-nav-state" data-state="complete" onclick="showState('complete')">Complete</button>
```

### States Content Example

```html
<!-- Generated {{STATES_CONTENT}} -->
<div id="state-welcome" class="prototype-state active">
  <!-- Content from states/welcome.html -->
  <div class="welcome-screen">
    <h1>Welcome to Acme</h1>
    <p>Let's get you started</p>
    <button class="btn-primary" data-navigate="select-plan">Get Started</button>
  </div>
</div>

<div id="state-select-plan" class="prototype-state">
  <!-- Content from states/select-plan.html -->
</div>
<!-- ... more states ... -->
```

### Flow JSON Example

```javascript
// Generated {{FLOW_JSON}}
{
  "initial": "welcome",
  "states": {
    "welcome": {
      "transitions": { "next": "select-plan" }
    },
    "select-plan": {
      "transitions": { "next": "team-setup", "back": "welcome" },
      "error_state": "select-plan--error"
    },
    "team-setup": {
      "transitions": { "next": "complete", "back": "select-plan" },
      "empty_state": "team-setup--empty"
    },
    "complete": {
      "transitions": {}
    }
  }
}
```

## Prototype Features

### Hotspots

Add `data-navigate` attribute to any element to make it clickable:

```html
<button data-navigate="select-plan">Get Started</button>
<a data-navigate="welcome">Back</a>
```

### Keyboard Navigation

- `→` or `Space` - Go to next state (if defined in transitions)
- `←` or `Backspace` - Go to previous state (if defined)
- `Escape` - Return to initial state

### Viewport Modes

The prototype supports three viewport sizes:
- **Mobile** (375px) - iPhone-sized
- **Tablet** (768px) - iPad-sized
- **Desktop** (1200px) - Full-width

### Debug Mode

Click "Hotspots" button to highlight all clickable areas with a subtle border.

## Test IDs for Playwright (Prototype Template)

- `prototype-nav` - Navigation bar
- `state-navigation` - State button container
- `prototype-viewport` - Main content area
- `prototype-frame` - The frame containing states
- `prototype-meta` - Footer with metadata
- `viewport-mobile`, `viewport-tablet`, `viewport-desktop` - Viewport controls
- `toggle-debug` - Debug mode toggle
