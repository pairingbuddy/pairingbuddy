---
name: generating-design-previews
description: Generates preview.html and example.html for design system explorations. Provides templates with Tailwind CDN integration.
---

# Generating Design Previews

Creates interactive HTML previews for design system explorations.

## Templates

- [preview-template.html](./templates/preview-template.html) - Tabbed design system showcase
- [example-template.html](./templates/example-template.html) - Domain-specific example page

## Output Files

| File | Purpose |
|------|---------|
| `preview.html` | Tabbed UI showing colors, typography, spacing, motion, components |
| `example.html` | Domain-specific page demonstrating the design system in context |

## Template Placeholders

### preview-template.html

| Placeholder | Value |
|-------------|-------|
| `{{DS_NAME}}` | Design system name |
| `{{DS_DESCRIPTION}}` | Design system description |
| `{{DS_VERSION}}` | Version number |
| `{{TAILWIND_CONFIG}}` | Inline Tailwind config object |
| `{{BRAND_COLORS}}` | Color swatch HTML (architecture-aware) |
| `{{SEMANTIC_COLORS}}` | Semantic token visualizations |
| `{{TYPOGRAPHY}}` | Type specimens |
| `{{TYPOGRAPHY_DESCRIPTION}}` | Typography rationale |
| `{{MONO_FONT}}` | Monospace font name |
| `{{SPACING}}` | Spacing scale demos |
| `{{SPACING_BASE}}` | Base spacing value |
| `{{SPACING_DENSITY}}` | Density setting |
| `{{RADIUS}}` | Border radius examples |
| `{{SHADOWS}}` | Shadow examples |
| `{{TRANSITIONS}}` | Transition demos |
| `{{ANIMATIONS}}` | Animation demos |
| `{{CORE_COMPONENTS}}` | Core component examples |
| `{{PACK_COMPONENTS}}` | Domain pack component examples |

### example-template.html

| Placeholder | Value |
|-------------|-------|
| `{{DS_NAME}}` | Design system name |
| `{{EXAMPLE_TITLE}}` | Page title (e.g., "Acme Landing Page") |
| `{{TAILWIND_CONFIG}}` | Inline Tailwind config object |
| `{{EXAMPLE_CONTENT}}` | Main page content HTML using Tailwind classes |

## Usage

Templates use Tailwind CDN v3 + linked tokens.css. Generated files can be opened directly in browser.
