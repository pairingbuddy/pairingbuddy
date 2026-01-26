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
4. **Token test:** Do CSS variable names sound product-specific (`--ink`) or universal (`--gray-700`)?

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

CSS variables are design decisions.

- `--ink` and `--parchment` evoke a world
- `--gray-700` evokes a template

Names should evoke the product's world.

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

### 4. Token Test

Read CSS variables aloud.

Do they belong to this product's world, or any project?

**Good:** `--soil`, `--harvest`, `--weather-alert`
**Generic:** `--gray-700`, `--blue-500`, `--spacing-md`

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
