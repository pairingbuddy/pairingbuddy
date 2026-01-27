---
name: generating-exploration-gallery
description: Generates web-hostable gallery for comparing design explorations. Provides templates for index page and side-by-side comparison.
---

# Generating Exploration Gallery

Creates a deployable website for showcasing and comparing design system explorations.

## Templates

- [index-template.html](./templates/index-template.html) - Navigation page with cards
- [comparison-template.html](./templates/comparison-template.html) - Side-by-side screenshot comparison

## Output Files

| File | Purpose |
|------|---------|
| `index.html` | Navigation page with cards for each exploration |
| `comparison.html` | Side-by-side screenshot comparison |
| `robots.txt` | Prevents search indexing (`User-agent: *\nDisallow: /`) |
| `screenshots/*.png` | Captured at 1200x800 viewport |

## Template Placeholders

### index-template.html

| Placeholder | Value |
|-------------|-------|
| `{{PROJECT_NAME}}` | Project name from session |
| `{{PROJECT_DESCRIPTION}}` | Project description |
| `{{DESIGN_SYSTEM_CARDS}}` | Generated card HTML for each exploration |

### comparison-template.html

| Placeholder | Value |
|-------------|-------|
| `{{PROJECT_NAME}}` | Project name |
| `{{PROJECT_DESCRIPTION}}` | Project description |
| `{{NAVIGATION_LINKS}}` | Anchor links to each exploration |
| `{{COMPARISON_CARDS}}` | Cards with screenshots |
| `{{SUMMARY_ROWS}}` | Table rows comparing all systems |
| `{{PROJECT_CONTEXT}}` | Additional context |

## Card HTML Structure

### Index Card

```html
<div class="card">
  <div class="card-header">
    <div>
      <h2>{name}</h2>
      <span class="theme">{personality}</span>
    </div>
  </div>
  <div class="links">
    <a href="{name}/preview.html" class="preview">Design Tokens</a>
    <a href="{name}/example.html" class="example">Live Example</a>
  </div>
</div>
```

### Comparison Card

```html
<div class="card" id="{name}">
  <img src="screenshots/{name}.png" alt="{name}" class="card-image">
  <div class="card-content">
    <div class="card-header">
      <div>
        <h2>{name}</h2>
        <span class="theme">{personality}</span>
      </div>
    </div>
    <p class="card-description">{description}</p>
    <div class="card-links">
      <a href="{name}/example.html" class="primary" style="--card-primary: {primary_color}">View Example</a>
      <a href="{name}/preview.html" class="secondary">View Components</a>
    </div>
  </div>
</div>
```

## Screenshot Capture

If Playwright available:

1. Start server: `python -m http.server {port} &` (store PID)
2. For each exploration:
   - Navigate to localhost on the port, path `/{name}/example.html`
   - Set viewport 1200x800
   - Take full-page screenshot
   - Save to `screenshots/{name}.png`
3. Stop server: `kill {PID}`

## Path Requirements

All paths must be **relative** for portability.
