# Design Principles Reference

This file contains embedded design principles for the design-ux skill.

## Core Philosophy

**"Don't make me think"** (Krug) - Every interface should be self-evident.

**"Less, but better"** (Rams) - Concentrate on essentials.

**"Design for goals, not features"** (Cooper) - Users want to accomplish things.

## Design Hierarchy (Apply in Order)

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
- Max 7+/-2 items visible (Miller's Law)

## Key Specifications

### Touch Targets
```
MINIMUM: 48 x 48px (all interactive elements)
Spacing between targets: 8px minimum
```

### Color Contrast
```
Text: 4.5:1 minimum (WCAG AA)
Large text (18pt+): 3:1 minimum
UI components: 3:1 minimum
```

### Typography
```
Body: 16px minimum (mobile), 14px minimum (desktop)
Line height: 1.5 for body, 1.25 for headings
Line length: 50-75 characters optimal
```

### Spacing Scale (8px base)
```
4, 8, 12, 16, 24, 32, 48, 64, 96px
Use ONLY values from the scale
```

## Laws of UX

### Fitts's Law
Time to reach target depends on distance and size. Make important targets large and close.

### Hick's Law
Decision time increases with number of choices. Limit options, highlight recommendations.

### Miller's Law
Working memory holds 7+/-2 items. Chunk information into groups.

### Jakob's Law
Users expect your site to work like other sites. Follow conventions.

### Von Restorff Effect
Items that stand out are more memorable. Make primary actions visually distinct.

### Peak-End Rule
People judge experiences by peak and end moments. End flows positively.

### Doherty Threshold
Productivity soars when response < 400ms. Make interactions feel instant.

## Gestalt Principles

### Proximity
Elements close together are perceived as related. Group related items.

### Similarity
Similar elements are perceived as related. Use consistent styling.

### Common Region
Elements in a boundary are perceived as a group. Use cards and containers.

## Don Norman's Principles

### Affordances
The relationship between object and user capabilities. Buttons should look pressable.

### Signifiers
Signals that communicate where actions happen. Make clickable things look clickable.

### Feedback
Communicate results of actions. Users must always know what happened.

### Constraints
Limitations that guide toward correct actions. Disable invalid options.

### Mapping
Relationship between controls and effects. Make controls intuitive.

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

## Anti-Patterns (Never Do)

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
