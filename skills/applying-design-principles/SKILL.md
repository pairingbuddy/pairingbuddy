---
name: applying-design-principles
description: Core design principles and specifications for creating accessible, usable interfaces. Covers Laws of UX, touch targets, color contrast, typography, spacing scales, and component patterns.
---

# Applying Design Principles

Reference material for foundational design principles and technical specifications.

## Contents

- [Quick Reference](#quick-reference) - Key specifications and Laws of UX
- [Core Philosophy](#core-philosophy) - Guiding principles
- [Design Hierarchy](#design-hierarchy) - Apply in order
- [Key Specifications](#key-specifications) - Technical requirements
- [Laws of UX](#laws-of-ux) - Psychological principles
- [Gestalt Principles](#gestalt-principles) - Visual perception
- [Component Patterns](#component-patterns) - Standard implementations

## Quick Reference

### Key Specifications

**Touch Targets:**
```
MINIMUM: 48 x 48px (all interactive elements)
Spacing between targets: 8px minimum
```

**Color Contrast:**
```
Text: 4.5:1 minimum (WCAG AA)
Large text (18pt+): 3:1 minimum
UI components: 3:1 minimum
```

**Typography:**
```
Body: 16px minimum (mobile), 14px minimum (desktop)
Line height: 1.5 for body, 1.25 for headings
Line length: 50-75 characters optimal
```

**Spacing Scale (8px base):**
```
4, 8, 12, 16, 24, 32, 48, 64, 96px
Use ONLY values from the scale
```

### Critical Laws of UX

| Law | Application |
|-----|-------------|
| **Fitts's Law** | Make important targets large and close |
| **Hick's Law** | Limit options, highlight recommendations |
| **Miller's Law** | Chunk information into groups of 7±2 |
| **Jakob's Law** | Follow conventions users already know |

## Core Philosophy

**"Don't make me think"** (Krug)
Every interface should be self-evident.

**"Less, but better"** (Rams)
Concentrate on essentials.

**"Design for goals, not features"** (Cooper)
Users want to accomplish things.

## Design Hierarchy

Apply in this order:

### 1. Clarity First

- One primary action per screen
- Labels above inputs, never inside
- Jargon-free language
- Status always visible

### 2. Reduce Friction

- Fewer choices = faster decisions (Hick's Law)
- Larger, closer targets = easier interaction (Fitts's Law)
- Auto-detect what you can
- Smart defaults everywhere

### 3. Instant Feedback

- < 100ms: No indicator needed
- 100-400ms: Subtle indicator
- > 400ms: Skeleton screen or progress
- Every action gets confirmation

### 4. Progressive Disclosure

- Show only what's needed now
- Reveal complexity gradually
- Max 7±2 items visible (Miller's Law)

## Key Specifications

### Touch Targets

**Minimum size:** 48 x 48px for ALL interactive elements

**Spacing:** 8px minimum between adjacent targets

**Rationale:** Fitts's Law - smaller/farther targets are harder to hit

### Color Contrast

**Text contrast:**
- Normal text: 4.5:1 minimum (WCAG AA)
- Large text (18pt+ or 14pt+ bold): 3:1 minimum

**UI components:**
- Interactive elements: 3:1 minimum against adjacent colors
- Focus indicators: 3:1 minimum

**Test both light AND dark modes**

### Typography

**Body text:**
- Mobile: 16px minimum
- Desktop: 14px minimum acceptable, 16px preferred

**Line height:**
- Body text: 1.5
- Headings: 1.25

**Line length:**
- Optimal: 50-75 characters
- Maximum: 90 characters

### Spacing Scale

**Base unit:** 8px

**Scale values:**
```
4, 8, 12, 16, 24, 32, 48, 64, 96px
```

**Rule:** Use ONLY values from the scale for margins, padding, gaps.

## Laws of UX

### Fitts's Law

Time to reach target depends on distance and size.

**Application:**
- Make important targets large
- Place frequent actions close to cursor/thumb
- Increase button size rather than adding space

### Hick's Law

Decision time increases with number of choices.

**Application:**
- Limit options (3-5 ideal)
- Highlight recommended choice
- Progressive disclosure for advanced options
- Group related choices

### Miller's Law

Working memory holds 7±2 items.

**Application:**
- Chunk information into groups
- Navigation: 5-7 top-level items
- Forms: Group related fields
- Lists: Paginate or virtualize

### Jakob's Law

Users expect your site to work like other sites.

**Application:**
- Logo in top-left links to home
- Search in top-right
- Shopping cart icon
- Standard form patterns
- Conventional button placement

### Von Restorff Effect

Items that stand out are more memorable.

**Application:**
- Make primary action visually distinct
- Use color sparingly for emphasis
- One strong CTA per screen

### Peak-End Rule

People judge experiences by peak and end moments.

**Application:**
- End flows positively (success confirmation)
- Celebrate completions
- Smooth error recovery
- Positive final impression

### Doherty Threshold

Productivity soars when response < 400ms.

**Application:**
- Instant feedback for interactions
- Skeleton screens for loading
- Optimistic updates
- Background processing

## Gestalt Principles

### Proximity

Elements close together are perceived as related.

**Application:** Group related items with whitespace.

### Similarity

Similar elements are perceived as related.

**Application:** Use consistent styling for related functions.

### Common Region

Elements in a boundary are perceived as a group.

**Application:** Use cards and containers to group related content.

## Don Norman's Principles

### Affordances

The relationship between object and user capabilities.

**Application:** Buttons should look pressable, inputs should look editable.

### Signifiers

Signals that communicate where actions happen.

**Application:** Make clickable things look clickable (color, underline, icon).

### Feedback

Communicate results of actions.

**Application:** Users must always know what happened (loading, success, error).

### Constraints

Limitations that guide toward correct actions.

**Application:** Disable invalid options, validate input formats.

### Mapping

Relationship between controls and effects.

**Application:** Make controls intuitive (up/down arrows, slider direction).

## Component Patterns

### Buttons

```
Primary: One per screen, prominent color
Secondary: Outlined, for alternative actions
Disabled: 50% opacity, no pointer events
Loading: Spinner replaces text, preserve width

States: default -> hover (darken 10%) -> focus (2px ring) -> active (scale 0.98)
```

### Forms

```
Layout: Single column only
Labels: Above inputs, never placeholder-only
Validation: On blur, not on type
Errors: Inline, below field, red + icon
Success: Show immediately when valid
```

### Loading States

```
< 300ms: Nothing
300ms-1s: Skeleton screen
1-10s: Progress bar
> 10s: Progress + time estimate + cancel
```

### Empty States

```
Structure:
1. Illustration (optional)
2. Headline: What's empty
3. Subtext: Why it matters
4. CTA: What to do next
```

### Toasts

```
Success: 3s auto-dismiss, green
Error: No auto-dismiss (or 8s), red
Info: 4s auto-dismiss, blue
Warning: 5s auto-dismiss, yellow

Position: Top-right (desktop), bottom (mobile)
```

## Anti-Patterns

Never do these:

- Multi-column form layouts
- Placeholder-only labels
- Validate while typing
- Auto-dismiss error messages
- Pure black text on pure white (#000 on #fff)
- Small touch targets (< 44px)
- Hidden navigation
- Mystery meat navigation (unlabeled icons)
- Modal on modal
- Walls of text without hierarchy

## Quick Validation Tests

### The "Mom Test"

Can a non-technical person complete the core flow without help?

### The "Squint Test"

Squint at the screen. Do primary actions still stand out?

### The "5-Second Test"

Show screen for 5 seconds. Can user recall primary action?

### The "Tab Test"

Can you complete the flow using only keyboard?
