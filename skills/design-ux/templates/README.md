# Preview Templates

This directory contains HTML templates for generating design system previews.

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

## Test IDs for Playwright

The template includes `data-testid` attributes for visual testing:

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
