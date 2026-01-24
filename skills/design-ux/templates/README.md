# Design UX Templates

This directory contains HTML templates for generating design system previews and experience prototypes.

## Templates

| Template | Purpose |
|----------|---------|
| `preview-template.html` | Design system visualization (colors, typography, components) - minimal HTML with placeholders |
| `preview-styles.css` | Static CSS for preview template (base styles, layout, component classes) |
| `prototype-template.html` | Experience prototype (clickable state machine with navigation) |
| `index-template.html` | Navigation page for web-hosted exploration output |
| `comparison-template.html` | Side-by-side comparison page using screenshots |

## Preview Template (Split Structure)

The preview template is split into two files to stay within Claude Code's token limits:

1. **`preview-template.html`** - Minimal HTML structure with placeholders (~190 lines)
2. **`preview-styles.css`** - Static CSS classes and base styles (~980 lines)

**Structure:**
- Header: Name, description, version, dark mode toggle
- Tabs: Colors | Typography | Spacing | Motion | Components
- Each tab has sections with examples using CSS classes from preview-styles.css

**When generating preview.html:**
1. Start with preview-template.html structure
2. Read preview-styles.css and embed it via `{{PREVIEW_STYLES}}` placeholder
3. Replace `{{CSS_VARIABLES}}` with generated design tokens
4. Replace `{{COMPONENT_STYLES}}` with generated component CSS
5. Replace content placeholders (`{{BRAND_COLORS}}`, `{{TYPOGRAPHY}}`, etc.) with generated HTML
6. Replace metadata placeholders (`{{DS_NAME}}`, `{{DS_DESCRIPTION}}`, `{{DS_VERSION}}`)

**The CSS classes in preview-styles.css** provide consistent styling:
- `.color-scale`, `.color-swatch-row` - for brand color display
- `.semantic-card`, `.semantic-preview` - for semantic tokens
- `.type-specimen`, `.type-5xl` through `.type-xs` - for typography
- Component classes: `.btn`, `.input`, `.card`, `.badge`, `.toast`, etc.

## Template Placeholders

### Metadata Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{DS_NAME}}` | Design system name | `my-app-ds` |
| `{{DS_VERSION}}` | Version number | `1` |
| `{{DS_DESCRIPTION}}` | Brief description | `Design system for SaaS app` |

### Style Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{CSS_VARIABLES}}` | Generated design tokens CSS (see Dark Mode structure below) |
| `{{PREVIEW_STYLES}}` | Static CSS from preview-styles.css (embed the entire file) |
| `{{COMPONENT_STYLES}}` | Generated CSS for components (buttons, inputs, etc.) |

### Token Placeholders

| Placeholder | Description |
|-------------|-------------|
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
| `{{CORE_COMPONENTS}}` | HTML for core components (always rendered) |
| `{{PACK_COMPONENTS}}` | HTML for domain pack components (conditional) |

## CSS_VARIABLES Structure (Dark Mode)

The `{{CSS_VARIABLES}}` placeholder must include both light and dark mode tokens:

```css
:root {
  /* Transitions */
  --radius: 0.5rem;
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);

  /* Brand colors (don't change between modes) */
  --purple-50: 270 100% 98%;
  --purple-100: 269 100% 95%;
  /* ... full scale 50-900 ... */
  --neutral-50: 0 0% 98%;
  --neutral-900: 240 6% 10%;
  /* ... other color scales ... */

  /* Semantic tokens - Light mode (default) */
  --background: var(--neutral-50);
  --foreground: var(--neutral-900);
  --primary: var(--purple-600);
  --muted: var(--neutral-100);
  --muted-foreground: var(--neutral-500);
  --border: var(--neutral-200);
  --card: 0 0% 100%;
  --card-foreground: var(--neutral-900);
  /* ... etc ... */
}

.dark {
  /* Semantic tokens - Dark mode (reversed) */
  --background: var(--neutral-900);
  --foreground: var(--neutral-50);
  --primary: var(--purple-600);  /* stays same */
  --muted: var(--neutral-800);
  --muted-foreground: var(--neutral-400);
  --border: var(--neutral-700);
  --card: var(--neutral-800);
  --card-foreground: var(--neutral-50);
  /* ... etc ... */
}
```

**Key points:**
- Brand color scales (50-900) go in `:root` and don't change
- Semantic tokens reference brand colors via `var(--color-name)`
- Light mode tokens go in `:root`
- Dark mode tokens go in `.dark` class
- Colors use HSL format for flexibility: `270 100% 98%` (used as `hsl(var(--purple-50))`)

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

---

# Index Template

The `index-template.html` is the navigation page for web-hosted exploration output. It provides a card-based overview of all design systems in an exploration.

## Index Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{PROJECT_NAME}}` | Project or exploration name | `Acme Design Systems` |
| `{{PROJECT_DESCRIPTION}}` | Brief description | `5 design directions for SaaS platform` |
| `{{DESIGN_SYSTEM_CARDS}}` | HTML for all design system cards | See example below |

## Card HTML Structure

Each design system card follows this structure:

```html
<div class="card">
  <div class="card-header">
    <div>
      <h2>01 Bold</h2>
      <p class="theme">Confident Modern</p>
    </div>
  </div>
  <div class="links">
    <a href="01-bold/preview.html" class="preview">Design Tokens</a>
    <a href="01-bold/example.html" class="example">Live Example</a>
  </div>
</div>
```

---

# Comparison Template

The `comparison-template.html` shows side-by-side comparison of all design systems using screenshots (not iframes - they don't work reliably across hosts).

## Comparison Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{PROJECT_NAME}}` | Project name | `Acme Design Systems` |
| `{{PROJECT_DESCRIPTION}}` | Description | `5 distinct visual directions for SaaS platform` |
| `{{PROJECT_CONTEXT}}` | Footer context | `Created for enterprise SaaS` |
| `{{NAVIGATION_LINKS}}` | Quick-jump anchor links | See example below |
| `{{COMPARISON_CARDS}}` | HTML for all comparison cards | See example below |
| `{{SUMMARY_ROWS}}` | Table rows for summary | See example below |

## Navigation Links HTML

```html
<a href="#bold">01 Bold</a>
<a href="#minimal">02 Minimal</a>
<a href="#playful">03 Playful</a>
```

## Comparison Card HTML

```html
<article id="bold" class="card" style="--card-primary: #2563eb;">
  <img src="screenshots/01-bold.png" alt="Bold Preview" class="card-image">
  <div class="card-content">
    <div class="card-header">
      <div>
        <span class="card-number">01</span>
        <h2>Bold</h2>
        <p class="theme">Confident Modern</p>
      </div>
      <div class="color-swatches">
        <span class="swatch" style="background: #2563eb" title="Primary Blue"></span>
        <span class="swatch" style="background: #1e293b" title="Dark Slate"></span>
        <span class="swatch" style="background: #10b981" title="Accent Green"></span>
      </div>
    </div>
    <p class="card-description">
      Strong color contrast with confident typography and bold action elements.
    </p>
    <div class="card-links">
      <a href="01-bold/example.html" class="primary">View Landing Page</a>
      <a href="01-bold/preview.html" class="secondary">View Components</a>
    </div>
  </div>
</article>
```

## Summary Table Rows HTML

```html
<tr>
  <td>01 Bold</td>
  <td>Confident, modern</td>
  <td><span class="color-cell"><span class="color-dot" style="background: #2563eb"></span>Primary Blue</span></td>
  <td>Inter</td>
</tr>
```

## Screenshot Requirements

Screenshots must be:
- Captured using Playwright during exploration
- Stored in screenshots folder at exploration root
- Named by folder (e.g., 01-bold.png for the 01-bold/ exploration)
- Captured at 1200x800px for consistency
- PNG format for quality
