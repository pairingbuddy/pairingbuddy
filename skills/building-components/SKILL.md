---
name: building-components
description: Component specifications and patterns for design systems. Covers core components, domain packs, component states, variants, and token usage examples.
---

# Building Components

Reference material for component specifications and implementation patterns.

## Contents

- [Quick Reference](#quick-reference) - Component checklist and state requirements
- [Detailed Specifications](./reference.md) - Full component catalog with variants, states, and domain packs

## Quick Reference

### Component Checklist

Every component needs:

**States:**
- Default
- Hover
- Focus (keyboard)
- Active
- Disabled
- Loading (if applicable)

**Variants:**
- Size variations (sm, default, lg)
- Visual variants (primary, secondary, ghost, etc.)
- Semantic variants (success, warning, error)

**Accessibility:**
- Keyboard navigation
- ARIA labels
- Focus indicators
- Screen reader support

### State Requirements

| Component | Required States |
|-----------|----------------|
| Button | default, hover, focus, active, disabled, loading |
| Input | empty, focused, filled, error, success, disabled |
| Select | closed, open, option-hover, option-selected, disabled |
| Checkbox | unchecked, checked, indeterminate, disabled, focus |
| Radio | unselected, selected, disabled, focus |

### Core Component List

Universal components every design system needs:

**Form Elements:**
- Button (6 variants, 4 sizes)
- Input (5 variants)
- Select / Dropdown
- Checkbox
- Radio
- Toggle / Switch
- Text Area
- Label

**Layout & Structure:**
- Card (3 variants)
- Tabs / Tab Bar (3 styles)
- Button Group
- Breadcrumb
- Table (with states)
- Carousel

**Feedback & Status:**
- Badge / Tag (7 variants, 2 sizes)
- Toast / Notification (4 types)
- Progress Bar (5 variants)
- Progress Circle (3 sizes)
- Loading (spinner, skeleton)
- Empty State

**Navigation:**
- Link
- Menu / Dropdown Menu

**Media:**
- Avatar (5 sizes, 3 variants)

### Domain Packs

Specialized component sets for specific contexts:

**SaaS / Dashboard Pack:**
- Data Table (pagination, sorting, bulk actions)
- Sidebar Nav
- Stat Card
- Modal

**E-commerce Pack:**
- Product Card
- Price Display
- Cart Item
- Quantity Selector
- Rating Stars

**Marketing / Landing Pack:**
- Hero Section
- Feature Grid
- Testimonial
- Pricing Table
- CTA Block

**Forms-heavy Pack:**
- Multi-step Form
- File Upload
- Date Picker
- Range Slider
- Form Section

**Mobile-first Pack:**
- Bottom Nav
- Swipe Actions
- Pull-to-Refresh
- Action Sheet

### Component Token Usage Examples

**Button:**
```
default: bg-action text-on-action hover:bg-action-hover
secondary: bg-surface-primary text-body hover:bg-surface-primary/80
ghost: hover:bg-surface-primary hover:text-heading
destructive: bg-error text-on-action hover:bg-error/90
outline: border border-default bg-transparent hover:bg-surface-primary
```

**Input:**
```
base: border-default bg-surface-page text-body
focus: border-focus ring-2 ring-focus/20
error: border-error text-error
disabled: bg-surface-primary/50 cursor-not-allowed
```

**Card:**
```
base: bg-surface-page border-default rounded-lg shadow-card
interactive: hover:shadow-soft hover:-translate-y-0.5
selected: border-action
```

**Badge:**
```
default: bg-neutral-100 text-neutral-700
primary: bg-action/10 text-action
success: bg-success/10 text-success
warning: bg-warning/10 text-warning
error: bg-error/10 text-error
```
