---
name: differentiating-designs
description: Craft knowledge for creating intentionally differentiated designs that emerge from specific product domains rather than generic patterns. Covers intent-first framework, anti-default philosophy, and pre-delivery evaluation mandates.
---

# Differentiating Designs

Reference material for creating designs grounded in product domain rather than defaults.

## Contents

- [Quick Reference](#quick-reference) - Anti-default philosophy and core principles
- [Intent-First Framework](#intent-first-framework) - Required questions before designing
- [Product Domain Exploration](#product-domain-exploration) - Mandatory outputs
- [Where Defaults Hide](#where-defaults-hide) - Common pitfalls
- [Craft Principles](#craft-principles) - Surface, text, and color fundamentals
- [Pre-Delivery Mandates](#pre-delivery-mandates) - Required checks before presenting

## Quick Reference

### Anti-Default Philosophy

**Core thesis:** Generic output is the default risk. Thousands of patterns exist in training data, creating strong gravitational pull toward templates.

**Mandate:** Catch yourself before producing warm colors on cold structures or generic dashboards that look identical to competitors.

### The Four Mandates

Before presenting ANY design work, run these checks:

1. **Swap test:** Would swapping typeface/layout change perception? If not, you defaulted.
2. **Squint test:** Blur your eyes - does hierarchy persist without harsh jumps?
3. **Signature test:** Can you point to specific elements showing your signature?
4. **Visual test:** Does the OUTPUT look domain-specific, or like generic SaaS with different colors?

**Note on token naming:** Clear, systematic names (`--color-primary-500`, `--spacing-lg`) are fine. Differentiation comes from visual output, not clever variable names. Cute names like `--harvest` or `--soil` can make systems harder to maintain.

### Stop Rule

If you cannot answer "who, what, feel" with specifics, STOP. Ask the user. Do not guess. Do not default.

## Intent-First Framework

Answer three questions explicitly before designing:

### 1. Who is this human?

Not "users" - the specific person:
- Where are they?
- What's on their mind?
- What precedes and follows their use?

### 2. What must they accomplish?

The verb matters:
- Grade submissions
- Find broken deployments
- Approve payments
- Monitor livestock health

The answer determines hierarchy.

### 3. What should this feel like?

Avoid vague terms like "clean and modern."

Use specific descriptors:
- Warm as a notebook
- Cold as a terminal
- Dense like trading floors
- Calm like reading apps
- Grounded like farming tools
- Precise like medical instruments

## Product Domain Exploration

Four mandatory outputs BEFORE proposing direction:

### 1. Domain

Minimum 5 concepts, metaphors, vocabulary from the product's actual world - not features, but territory.

**Example (farming insurance):**
- Crop rotation cycles
- Weather patterns
- Soil quality indicators
- Seasonal rhythms
- Field boundaries

### 2. Color World

5+ natural colors from the product's physical or conceptual space.

Ask: If this were a physical space, what colors belong there but nowhere else?

**Example (farming insurance):**
- Soil browns
- Wheat golds
- Sky blues
- Crop greens
- Weathered wood tones

### 3. Signature

One element (visual, structural, or interaction) that could only exist for THIS product.

If unnamed, explore deeper.

**Example:**
- Field boundary visualization metaphor
- Seasonal color shifts
- Growth progression indicators

### 4. Defaults to Reject

Name 3 obvious choices for this interface type - visual AND structural - that you must consciously replace.

**Example:**
- Generic blue primary color → soil brown
- Standard card grid → field layout metaphor
- Linear progress bars → circular seasonal cycle

## Where Defaults Hide

Defaults disguise themselves as infrastructure:

### Typography

"Pick something readable, move on" ignores that fonts shape how products feel.

- Bakery tool: warm, handmade type
- Trading terminal: cold, precise monospace

**Don't:** Default to system fonts or Inter without considering feel.

### Navigation

Not scaffolding around the product - IT IS the product.

Navigation teaches how users think about the space.

- Hierarchical nav: categorization mindset
- Hub-and-spoke: central dashboard radiating to tools
- Linear flow: step-by-step process

### Data Presentation

A number isn't design - the question is what that number means to the viewer.

- Progress ring tells a story
- Label fills space

**Choose HOW to represent meaning**, not just show numbers.

### Design Tokens

CSS variables are design decisions - but differentiation comes from VALUES, not NAMES.

**Three-tier naming convention:**

| Tier | Purpose | Naming | Example |
|------|---------|--------|---------|
| Brand | Raw values, scales | Can have numbers | `--color-blue-500`, `--scale-400` |
| Alias | Semantic meaning | NO numbers | `--color-primary`, `--spacing-lg` |
| Mapped | Component-specific | NO numbers | `--button-bg`, `--card-border` |

**Good naming:**
```css
/* Brand - numbers OK for scales */
--color-blue-500: #3b82f6;

/* Alias - semantic, no numbers */
--color-primary: var(--color-blue-500);
--surface-page: var(--color-gray-50);

/* Mapped - component-specific, no numbers */
--button-bg: var(--color-primary);
```

**Bad naming:**
```css
/* Numbers in semantic tier - WRONG */
--color-primary-500: var(--color-blue-500);

/* Cute names that confuse maintainers - WRONG */
--harvest-glow: var(--color-amber-300);
```

Differentiation comes from what the design LOOKS like, not what tokens are called.

## Craft Principles

### Surface & Elevation

**Subtlety principle:** Surfaces must be barely different but still distinguishable.

Study: Vercel, Supabase, Linear for whisper-quiet elevation shifts.

**Dark mode specifics:**
- Border opacity: 0.05-0.12 alpha
- Surface lightness shifts: 7-12% variance across levels
- Same hue across surfaces, small percentage-point lightness changes

**Anti-patterns:**
- Harsh borders that dominate immediately
- Dramatic surface elevation jumps
- Different hues for different surfaces
- Thick decorative borders

### Text Hierarchy

Four consistent levels:
- **Primary:** Highest contrast (headings, key content)
- **Secondary:** Body text
- **Tertiary:** Metadata, labels
- **Muted:** Disabled, placeholder

Apply consistently across all text.

### Color Philosophy

**Gray builds structure**
- Layout scaffolding
- Surfaces and borders
- Neutral backgrounds

**Color communicates**
- Status (success, warning, error)
- Action (CTAs, links)
- Emphasis (highlights)
- Identity (brand)

**Unmotivated color becomes noise**

Avoid:
- Multiple accent colors (dilutes focus)
- Decorative gradients
- Pure white cards on colored backgrounds

### Depth Strategy

Choose ONE approach and commit:
- **Borders-only:** Clean, technical (Linear, Raycast)
- **Subtle shadows:** `0 1px 3px rgba(0,0,0,0.08)` - approachable
- **Layered shadows:** Multiple layers for premium feel (Stripe)

Don't mix strategies.

## Pre-Delivery Mandates

Run these four checks BEFORE presenting output:

### 1. Swap Test

Would swapping the typeface for a standard one matter?

Would switching to a standard dashboard template feel different?

**Places where swapping wouldn't matter = places you defaulted.**

### 2. Squint Test

Blur your eyes - can you perceive hierarchy?

Anything jumping harshly?

**Craft whispers; defaults shout.**

### 3. Signature Test

Can you point to five specific elements showing your signature?

Not overall feel, but actual components:
- Custom data visualization pattern
- Unique navigation structure
- Domain-specific iconography
- Signature color treatment
- Distinctive spacing rhythm

### 4. Visual Output Test

Look at the rendered output.

Does it look like THIS product's world, or a generic template with different colors?

**Good:** Layout, components, and interactions that reflect the domain
**Generic:** Standard card grid, generic buttons, same structure as every SaaS

**Note:** Token NAMES don't matter for differentiation. `--gray-700` is fine if the visual output is distinctive.

## Common AI Mistakes to Avoid

- Overly visible borders (solid gray vs. subtle rgba)
- Dramatic surface jumps rather than gradual shifts
- Different hues for different surfaces
- Harsh dividers instead of subtle borders
- Decorative gradients
- Multiple accent colors
- Pure white cards on colored backgrounds
- Generic token names (`--primary`, `--secondary`)
- Standard dashboard templates without domain grounding

## Infinite Expression

Same patterns have infinite executions.

A metric displays as:
- Hero number
- Sparkline
- Gauge
- Progress bar
- Delta indicator
- Something new

**Rule:** Never produce identical output. Same sidebar, same card grid, same metric boxes signal AI-generation.

Linear's cards don't look like Notion's - same concepts, infinite expressions.

## Key Mandate Statement

"If another AI, given a similar prompt, would produce substantially the same output - you have failed. This isn't about being different for its own sake. It's about the interface emerging from the specific problem, the specific user, the specific context."

## Implementation Guide (For Builders)

Token names are necessary but NOT sufficient. The VISUAL OUTPUT must also be differentiated. Having `--soil` instead of `--brown-500` means nothing if you still produce a standard card grid.

### Layout Differentiation

**NEVER use standard card grids without domain justification.**

| Domain | Layout Approach |
|--------|-----------------|
| Farming | Field-boundary divisions, horizon lines, seasonal sections |
| Finance | Dense data tables, trading-floor density, ticker-style updates |
| Healthcare | Clean clinical zones, clear visual separation, calming whitespace |
| Education | Notebook/journal feel, margins for notes, progressive disclosure |

**Ask:** What physical space does this domain inhabit? How is information arranged THERE?

**Example (farming insurance):**
```
WRONG - Standard SaaS layout:
┌─────────────────────────────────────┐
│ [Card] [Card] [Card]               │
│ [Card] [Card] [Card]               │
└─────────────────────────────────────┘

RIGHT - Field-inspired layout:
┌─────────────────────────────────────┐
│ ═══════════ Horizon Band ══════════ │
│ ┌─────────┐                        │
│ │ Field 1 │  Weather     Yield     │
│ └─────────┘  ~~~~~~~~    ▓▓▓▓░░░   │
│ ┌─────────┐                        │
│ │ Field 2 │  ~~~~~~~~    ▓▓▓▓▓░   │
│ └─────────┘                        │
└─────────────────────────────────────┘
```

### Component Reimagining

**Standard components should be reimagined for the domain.**

| Standard | Farming Domain Alternative |
|----------|---------------------------|
| Progress bar | Growth indicator (seedling → full plant) |
| Status badge | Weather-inspired (sunny=good, stormy=warning) |
| Success toast | Harvest celebration (golden glow animation) |
| Error state | Drought/blight metaphor |
| Loading spinner | Seasonal cycle or sun position |
| Cards | Field plots with boundary styling |
| Tabs | Seasonal navigation (planting → growing → harvest) |

**The signature element from domain-spec.json MUST appear as an actual component.**

### Typography Feel

**Typography shapes how products FEEL. Choose intentionally.**

| Feel | Typography Direction |
|------|---------------------|
| Grounded/farming | Sturdy serifs, slightly weathered, generous x-height |
| Clinical/precise | Clean geometric sans, high contrast weights |
| Warm/friendly | Rounded sans, open counters, relaxed spacing |
| Technical/dense | Monospace accents, tight tracking, functional |
| Premium/crafted | Classic serifs, generous spacing, subtle weights |

**From domain-spec.json `intent.feel`:**
- "Grounded like farming tools" → NOT Inter/system fonts. Consider Source Serif, Merriweather, or sturdy sans like Work Sans
- "Cold as a terminal" → Monospace-influenced: JetBrains Mono, IBM Plex Mono
- "Warm as a notebook" → Humanist: Nunito, Lora, Literata

### Navigation as Product

**Navigation is NOT scaffolding around the product - IT IS the product.**

| Pattern | Mental Model | When to Use |
|---------|-------------|-------------|
| Seasonal/cyclical | Time-based workflow | Agriculture, education terms, fiscal years |
| Hub-and-spoke | Central command + tools | Dashboards, monitoring |
| Linear flow | Step-by-step process | Wizards, onboarding |
| Spatial/map | Geographic or area-based | Field management, floor plans |
| Hierarchical | Category organization | Content-heavy, documentation |

**Example (farming insurance):**
```
WRONG - Generic sidebar:
Dashboard | Policies | Claims | Settings

RIGHT - Domain-aware navigation:
My Fields | Growing Season | Claims & Weather | Policy
    └── reflects how farmers think about their work
```

### Visual Metaphors (Beyond Color)

**Colors named after domain concepts is step 1. Step 2 is VISUAL expression.**

| Concept | Visual Expression |
|---------|-------------------|
| Growth | Upward motion, expanding elements, green progression |
| Harvest | Golden accents on completion, gathering/consolidating UI |
| Weather | Gradient backgrounds that shift, atmospheric depth |
| Soil/grounding | Heavy bottom borders, earthy textures, stable footers |
| Seasons | Color temperature shifts, layout density changes |

**Implement at least 3 visual metaphors in example.html.**

### Signature Element Implementation

**The signature from domain-spec.json MUST be visibly implemented, not just named.**

```json
"signature": "field boundary visualization"
```

**Wrong:** Token named `--field-border` with standard 1px border
**Right:** Actual component with:
- Dashed borders like property lines
- Corner markers like survey stakes
- Subtle texture suggesting soil/earth
- Hover state showing field expansion

**Implementation checklist for signature:**
- [ ] Create dedicated CSS class or component
- [ ] Use in at least 3 places in preview.html
- [ ] Feature prominently in example.html
- [ ] Include in component documentation
- [ ] Signature should be recognizable at a glance

### Six Mandates (Extended)

Before completing ANY design work:

1. **Swap test:** Would swapping typeface/layout change perception?
2. **Squint test:** Does hierarchy persist without harsh jumps?
3. **Signature test:** Can you point to the signature element visually?
4. **Layout test:** Is layout domain-specific or generic SaaS dashboard?
5. **Component test:** Did you reimagine any standard components?
6. **Visual output test:** Does the rendered result look like THIS product, not generic SaaS?

If ANY fails, iterate before completing.

**Remember:** Differentiation is in the VISUAL OUTPUT - layouts, components, interactions, typography choices. Not in clever token names.
