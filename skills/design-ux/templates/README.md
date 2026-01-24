# Design UX Templates

HTML templates for design system previews and prototypes. All templates use **Tailwind CDN + linked tokens.css** so you can edit tokens and see changes on refresh.

## Templates

| Template | Purpose |
|----------|---------|
| `preview-template.html` | Design system visualization (colors, typography, components) |
| `example-template.html` | Contextual example page (landing page, dashboard) |
| `prototype-template.html` | Experience prototype (clickable state machine) |
| `index-template.html` | Navigation page for exploration output |
| `comparison-template.html` | Side-by-side comparison with screenshots |

## How Templates Work

All templates follow the same pattern:

```html
<!-- 1. Link to editable tokens -->
<link href="tokens.css" rel="stylesheet">

<!-- 2. Tailwind CDN with inline config -->
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = {{TAILWIND_CONFIG}}</script>

<!-- 3. Content uses Tailwind classes -->
<button class="px-lg py-sm bg-action text-white rounded-md">
  Click me
</button>
```

**Benefits:**
- Edit `tokens.css` → refresh → see changes
- Real Tailwind class patterns you can copy
- No embedded CSS mess

## Generated Files

Each design system folder contains:

| File | Purpose |
|------|---------|
| `tokens.css` | CSS variables (edit this to tweak design) |
| `tailwind.config.js` | Tailwind v3 config |
| `tailwind.v4.css` | Tailwind v4 config with @theme |
| `preview.html` | Component visualization |
| `example.html` | Contextual demo page |
| `config.json` | Design system metadata |

---

## Preview Template

Visualizes the design system with tabs: Colors, Typography, Spacing, Motion, Components.

### Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{DS_NAME}}` | Design system name |
| `{{DS_VERSION}}` | Version number |
| `{{DS_DESCRIPTION}}` | Brief description |
| `{{TAILWIND_CONFIG}}` | Inline Tailwind config object |
| `{{BRAND_COLORS}}` | Brand color swatches HTML |
| `{{SEMANTIC_COLORS}}` | Semantic token cards HTML |
| `{{TYPOGRAPHY}}` | Type scale specimens |
| `{{TYPOGRAPHY_DESCRIPTION}}` | Font description |
| `{{MONO_FONT}}` | Monospace font name |
| `{{SPACING}}` | Spacing scale blocks |
| `{{SPACING_BASE}}` | Base unit (4 or 8) |
| `{{SPACING_DENSITY}}` | Density level |
| `{{RADIUS}}` | Border radius examples |
| `{{SHADOWS}}` | Shadow examples |
| `{{TRANSITIONS}}` | Transition demos |
| `{{ANIMATIONS}}` | Animation demos |
| `{{CORE_COMPONENTS}}` | Core components HTML |
| `{{PACK_COMPONENTS}}` | Pack-specific components |

### Example: Brand Colors HTML

```html
<div class="color-scale">
  <h3 class="text-sm font-medium text-heading mb-sm">Primary</h3>
  <div class="color-swatch bg-primary-50" onclick="copyValue('--color-primary-50')">
    <span>50</span>
    <span class="font-mono text-xs">#eff6ff</span>
  </div>
  <div class="color-swatch bg-primary-500 text-white" onclick="copyValue('--color-primary-500')">
    <span>500</span>
    <span class="font-mono text-xs">#2563eb</span>
  </div>
  <!-- ... more swatches ... -->
</div>
```

### Example: Component HTML

Components use Tailwind classes from the config:

```html
<!-- Button component -->
<button class="px-lg py-sm bg-action text-white font-medium rounded-md shadow-sm hover:shadow-md transition-smooth">
  Primary Button
</button>

<!-- Card component -->
<div class="bg-card p-lg rounded-lg shadow-md border border-default">
  <h3 class="text-heading font-semibold mb-sm">Card Title</h3>
  <p class="text-muted">Card description text.</p>
</div>
```

---

## Example Template

Contextual demo page (landing page, dashboard, etc.) that shows the design system in real-world use.

### Placeholders

| Placeholder | Description |
|-------------|-------------|
| `{{DS_NAME}}` | Design system name |
| `{{EXAMPLE_TITLE}}` | Page title |
| `{{TAILWIND_CONFIG}}` | Inline Tailwind config |
| `{{EXAMPLE_CONTENT}}` | Main page HTML |

### Example Content

```html
{{EXAMPLE_CONTENT}}
<header class="bg-card border-b border-default">
  <nav class="max-w-7xl mx-auto px-lg py-md flex justify-between items-center">
    <span class="text-heading font-semibold text-xl">Acme</span>
    <div class="flex gap-md">
      <a href="#" class="text-muted hover:text-heading">Features</a>
      <a href="#" class="text-muted hover:text-heading">Pricing</a>
      <button class="px-lg py-sm bg-action text-white rounded-md">Get Started</button>
    </div>
  </nav>
</header>

<main class="max-w-7xl mx-auto px-lg py-xl">
  <h1 class="text-5xl font-bold text-heading mb-md">Build faster with Acme</h1>
  <p class="text-xl text-muted mb-lg max-w-2xl">The all-in-one platform for modern teams.</p>
  <button class="px-xl py-md bg-action text-white text-lg rounded-lg shadow-lg">
    Start Free Trial
  </button>
</main>
```

---

## Tailwind Config Placeholder

The `{{TAILWIND_CONFIG}}` placeholder should be replaced with:

```javascript
{
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'hsl(var(--color-primary-50))',
          500: 'hsl(var(--color-primary-500))',
          // ... full scale
        }
      },
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
      borderColor: {
        'default': 'hsl(var(--border-default))',
      },
    }
  }
}
```

---

## Dark Mode

All templates include a dark mode toggle that:
- Adds/removes `.dark` class on `<html>`
- Persists preference to localStorage
- Respects system preference on first visit

The tokens.css file must include both light and dark mode tokens:

```css
:root {
  --text-heading: var(--color-neutral-900);
  --surface-page: white;
}

.dark {
  --text-heading: var(--color-neutral-50);
  --surface-page: var(--color-neutral-900);
}
```

---

## Prototype Template

See separate section - used for experience prototypes with state machines.

## Index & Comparison Templates

See separate section - used for exploration navigation and comparison views.
