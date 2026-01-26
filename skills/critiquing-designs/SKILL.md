---
name: critiquing-designs
description: 6-pass UX critique framework for comprehensive design evaluation. Covers mental model alignment, information architecture, affordances, cognitive load, state design, and flow integrity.
---

# Critiquing Designs

Reference material for systematic design evaluation using 6-pass framework.

## Contents

- [Quick Reference](#quick-reference) - Overview of six passes
- [Pass 1: Mental Model Alignment](#pass-1-mental-model-alignment)
- [Pass 2: Information Architecture](#pass-2-information-architecture)
- [Pass 3: Affordances & Action Clarity](#pass-3-affordances--action-clarity)
- [Pass 4: Cognitive Load](#pass-4-cognitive-load--decision-minimization)
- [Pass 5: State Design & Feedback](#pass-5-state-design--feedback)
- [Pass 6: Flow Integrity](#pass-6-flow-integrity-check)
- [Critique Summary Format](#critique-summary-format)

## Quick Reference

### The Six Passes

Each pass forces a specific mindset and asks specific questions. Run all 6 passes for thorough critique.

| Pass | Focus | Key Question |
|------|-------|--------------|
| 1. Mental Model | Understanding | "What does the user think this is?" |
| 2. Information Architecture | Organization | "How is it organized?" |
| 3. Affordances | Action signals | "What signals action?" |
| 4. Cognitive Load | Decision burden | "Where will users hesitate?" |
| 5. State Design | System feedback | "How does the system talk back?" |
| 6. Flow Integrity | Cohesion | "Does it feel inevitable?" |

### Validation Categories

| Category | What to Check | Source Principle |
|----------|--------------|------------------|
| Contrast | Text/background ratios | WCAG AA (4.5:1 text, 3:1 UI) |
| Hierarchy | Primary vs secondary distinction | Von Restorff Effect |
| Touch targets | Button/input sizes | Fitts's Law (min 48px) |
| Consistency | Same elements styled same | Jakob's Law |
| Density | Spacing feels balanced | Gestalt proximity |
| Naming | Token names intuitive | Mental model alignment |
| Completeness | All states covered | State design |

## Pass 1: Mental Model Alignment

**Designer mindset:** "What does the user think this is?"

### Questions to Ask

- What does the user believe this system does?
- What are they trying to accomplish in one sentence?
- What wrong mental models are likely?
- Do token names communicate intent clearly?
- Will developers understand the naming conventions?

### For Design Systems

- Does `surface.primary` make sense?
- Is `text.action` vs `text.body` clear?
- Would a new developer intuitively find what they need?

### Output Format

```markdown
## Pass 1: Mental Model

**Token naming clarity:** [Assessment]

**Likely misconceptions:**
- [Misconception 1]
- [Misconception 2]

**Suggestions:**
- [Suggestion 1]
```

## Pass 2: Information Architecture

**Designer mindset:** "How is it organized?"

### Questions to Ask

- Are tokens logically grouped?
- Can a developer find what they need quickly?
- Is the hierarchy clear?
- Are related things near each other?

### For Design Systems

- Colors grouped sensibly? (brand vs semantic vs mapped)
- Typography organized by purpose?
- Spacing scale easy to understand?
- Component tokens grouped by component or by property?

### Output Format

```markdown
## Pass 2: Information Architecture

**Organization assessment:** [Assessment]

**Structure issues:**
- [Issue 1]
- [Issue 2]

**Suggested reorganization:**
- [Suggestion]
```

## Pass 3: Affordances & Action Clarity

**Designer mindset:** "What signals action?"

### Questions to Ask

- What is clickable?
- What looks editable?
- What looks like output (read-only)?
- What looks final vs in-progress?
- Is focus state visible enough?

### For Design Systems

- Do button colors clearly signal "clickable"?
- Are interactive elements visually distinct from static?
- Is hover state noticeable?
- Does focus ring have sufficient contrast?
- Are disabled states obviously disabled?

### Output Format

```markdown
## Pass 3: Affordances

| Element | Signal Assessment |
|---------|-------------------|
| Buttons | [Assessment] |
| Links | [Assessment] |
| Inputs | [Assessment] |
| Focus states | [Assessment] |

**Issues:**
- [Issue with specific element]

**Suggestions:**
- [How to improve signaling]
```

## Pass 4: Cognitive Load & Decision Minimization

**Designer mindset:** "Where will users hesitate?"

### Questions to Ask

- Are there too many similar colors?
- Is naming confusing or ambiguous?
- Are there too many options causing decision fatigue?
- What can be simplified?

### For Design Systems

- Too many shades that look nearly identical?
- Naming conventions inconsistent?
- Too many component variants?
- Could some tokens be consolidated?

### Simplification Strategies

- **Collapse decisions:** Fewer choices
- **Delay complexity:** Progressive disclosure
- **Introduce defaults:** Reduce decision burden

### Output Format

```markdown
## Pass 4: Cognitive Load

**Friction points:**
| Location | Type | Simplification |
|----------|------|----------------|
| [Where] | Choice/Uncertainty | [How to reduce] |

**Consolidation opportunities:**
- [Tokens that could be merged]

**Defaults to introduce:**
- [Default 1]: [Rationale]
```

## Pass 5: State Design & Feedback

**Designer mindset:** "How does the system talk back?"

### Questions to Ask

For EACH major element, are these states covered?
- Empty
- Loading
- Success
- Partial (incomplete)
- Error
- Disabled

For each state:
- What does the user see?
- What do they understand?
- What can they do next?

### For Design Systems

- Are all button states defined? (default, hover, focus, active, disabled, loading)
- Are all input states defined? (empty, focused, filled, error, success, disabled)
- Are feedback colors distinct enough?
- Is error state clearly different from other states?

### Output Format

```markdown
## Pass 5: State Design

### Buttons
| State | Defined? | Distinct? |
|-------|----------|-----------|
| Default | Yes/No | Yes/No |
| Hover | Yes/No | Yes/No |
| Focus | Yes/No | Yes/No |
| Active | Yes/No | Yes/No |
| Disabled | Yes/No | Yes/No |
| Loading | Yes/No | Yes/No |

### Inputs
[Same format]

**Missing states:**
- [Element] missing [state]

**Indistinct states:**
- [State A] too similar to [State B]
```

## Pass 6: Flow Integrity Check

**Designer mindset:** "Does it feel inevitable?"

### Questions to Ask

- When applied to real UI, does the system guide users naturally?
- Are there gaps or inconsistencies?
- Where could users get lost?
- Where would a first-time user fail?
- What must be visible vs can be implied?

### For Design Systems

- Do the tokens work together cohesively?
- Is there consistency across components?
- Would applying these tokens to a real UI feel natural?
- Are there edge cases not covered?

### Output Format

```markdown
## Pass 6: Flow Integrity

**Cohesion assessment:** [Overall assessment]

**Gaps identified:**
- [Missing token or pattern]

**Inconsistencies:**
- [Inconsistency between elements]

**Edge cases not covered:**
- [Scenario without clear token]
```

## Critique Summary Format

After running all 6 passes, produce a summary:

```markdown
# Design System Critique Summary

## Overall Assessment
[1-2 sentence summary]

## Critical Issues (Must Fix)
1. [Issue] - [Pass where found] - [Severity: High]
2. ...

## Recommended Improvements
1. [Improvement] - [Pass where found] - [Severity: Medium]
2. ...

## Nice-to-Have
1. [Enhancement] - [Pass where found] - [Severity: Low]
2. ...

## What's Working Well
- [Positive finding 1]
- [Positive finding 2]
```
