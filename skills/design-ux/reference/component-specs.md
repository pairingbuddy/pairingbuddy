# Component Specifications

This file defines core components and domain packs for the design-ux skill.

## Core Components (Always Generated)

These are universal - every design system needs them.

### Button

**Variants:**
- `default` (primary) - Main action
- `secondary` - Alternative action
- `ghost` - Subtle action
- `destructive` - Dangerous action
- `outline` - Bordered, transparent background
- `link` - Looks like a link

**States:**
- Default
- Hover (darken 10% or add shadow)
- Focus (2px ring, offset)
- Active (scale 0.98)
- Disabled (50% opacity, no pointer)
- Loading (spinner, preserve width)

**Sizes:**
- `sm` - h-9 px-3
- `default` - h-10 px-4 py-2
- `lg` - h-11 px-8
- `icon` - h-10 w-10

### Input

**Variants:**
- Text input
- With label
- With helper text
- With error
- With success

**States:**
- Empty
- Focused (border-focus)
- Filled
- Error (border-error, text-error)
- Success (border-success)
- Disabled (opacity 50%)

### Select / Dropdown

**States:**
- Closed
- Open (with options visible)
- Option hover
- Option selected
- Disabled

### Checkbox

**States:**
- Unchecked
- Checked
- Indeterminate
- Disabled
- Focus

### Radio

**States:**
- Unselected
- Selected
- Disabled
- Focus

### Toggle / Switch

**States:**
- Off
- On
- Disabled

### Card

**Variants:**
- Default
- Interactive (hover effect)
- Selected

### Badge / Tag

**Variants:**
- Default (neutral)
- Primary
- Success
- Warning
- Error
- Info
- Outline

**Sizes:**
- `sm`
- `default`

### Toast / Notification

**Variants:**
- Success
- Error
- Warning
- Info

**Anatomy:**
- Icon (left)
- Title
- Description (optional)
- Close button
- Action button (optional)

### Loading

**Types:**
- Spinner
- Skeleton

### Empty State

**Anatomy:**
1. Illustration (optional)
2. Headline
3. Description
4. Primary action button

### Avatar

**Sizes:**
- `xs` - 24px
- `sm` - 32px
- `default` - 40px
- `lg` - 48px
- `xl` - 64px

**Variants:**
- Image
- Initials
- Fallback icon

### Link

**States:**
- Default
- Hover (underline)
- Visited (optional)
- Focus

---

## Domain Packs

### SaaS / Dashboard Pack

**Data Table:**
- Header row (sticky, sortable)
- Body rows (zebra optional)
- Row hover
- Row selection (checkbox)
- Pagination
- Column sorting indicators
- Bulk action bar

**Pagination:**
- Page numbers
- Prev/Next buttons
- Page size selector
- "Showing X-Y of Z"

**Tabs:**
- Tab list
- Tab (default, active, disabled)
- Tab panel

**Sidebar Nav:**
- Nav group
- Nav item (default, active, disabled)
- Collapse/expand
- Icon support

**Stat Card:**
- Value (large)
- Label
- Trend indicator (up/down)
- Sparkline (optional)

**Progress Bar:**
- Track
- Fill
- Label (optional)
- Percentage

**Modal:**
- Overlay
- Container
- Header (title, close button)
- Body
- Footer (actions)

**Breadcrumb:**
- Item
- Separator
- Current (non-clickable)

### E-commerce Pack

**Product Card:**
- Image
- Title
- Price
- Rating (optional)
- Add to cart button
- Wishlist button

**Price Display:**
- Current price
- Original price (strikethrough)
- Discount badge
- Currency symbol

**Cart Item:**
- Product image
- Title
- Quantity selector
- Price
- Remove button

**Quantity Selector:**
- Decrement button
- Value display
- Increment button
- Min/max constraints

**Rating Stars:**
- Filled star
- Empty star
- Half star
- Count

### Marketing / Landing Pack

**Hero Section:**
- Headline
- Subheadline
- CTA buttons
- Background (image/gradient)

**Feature Grid:**
- Icon
- Title
- Description
- 3 or 4 column layout

**Testimonial:**
- Quote
- Avatar
- Name
- Title/company

**Pricing Table:**
- Plan name
- Price
- Feature list
- CTA button
- Recommended badge

**CTA Block:**
- Headline
- Description
- Button(s)
- Background

### Forms-heavy Pack

**Multi-step Form:**
- Step indicator
- Step content
- Navigation (back/next)
- Progress tracking

**File Upload:**
- Drop zone
- File preview
- Progress bar
- Remove button

**Date Picker:**
- Input trigger
- Calendar grid
- Month/year navigation
- Today indicator
- Selected state

**Range Slider:**
- Track
- Fill
- Thumb
- Value label

**Form Section:**
- Section title
- Section description
- Field group
- Divider

### Mobile-first Pack

**Bottom Nav:**
- Nav item (icon + label)
- Active indicator
- Badge (notifications)

**Swipe Actions:**
- Left actions (e.g., delete)
- Right actions (e.g., archive)
- Reveal animation

**Pull-to-Refresh:**
- Pull indicator
- Loading state
- Content refresh

**Action Sheet:**
- Overlay
- Sheet container
- Action items
- Cancel button

---

## Component Token Usage Examples

### Button
```
default: bg-action text-on-action hover:bg-action-hover
secondary: bg-surface-primary text-body hover:bg-surface-primary/80
ghost: hover:bg-surface-primary hover:text-heading
destructive: bg-error text-on-action hover:bg-error/90
outline: border border-default bg-transparent hover:bg-surface-primary
```

### Input
```
base: border-default bg-surface-page text-body
focus: border-focus ring-2 ring-focus/20
error: border-error text-error
disabled: bg-surface-primary/50 cursor-not-allowed
```

### Card
```
base: bg-surface-page border-default rounded-lg shadow-card
interactive: hover:shadow-soft hover:-translate-y-0.5
selected: border-action
```

### Badge
```
default: bg-neutral-100 text-neutral-700
primary: bg-action/10 text-action
success: bg-success/10 text-success
warning: bg-warning/10 text-warning
error: bg-error/10 text-error
```

### Toast
```
success: bg-success/10 border-success/20 text-success
error: bg-error/10 border-error/20 text-error
warning: bg-warning/10 border-warning/20 text-warning
info: bg-action/10 border-action/20 text-action
```
