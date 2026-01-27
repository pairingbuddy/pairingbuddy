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

| Pass | Designer Mindset | Key Question |
|------|-----------------|--------------|
| 1. Mental Model | "What does the user think is happening?" | What wrong mental models are likely? |
| 2. Information Architecture | "What exists, and how is it organized?" | How are concepts grouped and prioritized? |
| 3. Affordances | "What actions are obvious without explanation?" | What signals action? |
| 4. Cognitive Load | "Where will the user hesitate?" | What decisions can be eliminated? |
| 5. State Design | "How does the system talk back?" | Are all states covered? |
| 6. Flow Integrity | "Does this feel inevitable?" | Where could users get lost? |

### Why This Matters

**This is where most AI UX attempts fail.** If you skip explicit passes (especially Information Architecture), your visual specs will be disorganized. Run all 6 passes systematically.

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

---

## Pass 1: Mental Model Alignment

**Designer mindset:** "What does the user think is happening?"

### Force These Questions

- What does the user believe this system does?
- What are they trying to accomplish in one sentence?
- What wrong mental models are likely?
- Do names (tokens, components, labels) communicate intent clearly?

### For Design Systems Specifically

- Does `surface.primary` make sense?
- Is `text.action` vs `text.body` clear?
- Would a new developer intuitively find what they need?
- Do token names align with how they'll be used?

### Required Output Format

```markdown
## Pass 1: Mental Model

**Primary user intent:** [One sentence - what users are trying to accomplish]

**Likely misconceptions:**
- [Misconception 1]
- [Misconception 2]
- ...

**Token naming clarity:** [Assessment of whether names communicate intent]

**UX principle to reinforce/correct:** [Specific principle that applies]

**Suggestions:**
- [Suggestion 1]
- [Suggestion 2]
```

---

## Pass 2: Information Architecture

**Designer mindset:** "What exists, and how is it organized?"

### Force These Actions

1. Enumerate ALL concepts the user will encounter
2. Group into logical buckets
3. Classify each as: **Primary** / **Secondary** / **Hidden** (progressive disclosure)

### For Design Systems Specifically

- Colors grouped sensibly? (brand vs semantic vs mapped)
- Typography organized by purpose?
- Spacing scale easy to understand?
- Component tokens grouped by component or by property?
- Are related things near each other?

### Required Output Format

```markdown
## Pass 2: Information Architecture

**All user-visible concepts:**
- [Concept 1]
- [Concept 2]
- ...

**Grouped structure:**

### [Group Name]
- [Concept]: [Primary/Secondary/Hidden]
- Rationale: [One sentence why this classification]

### [Group Name]
- [Concept]: [Primary/Secondary/Hidden]
- Rationale: [Why]

**Structure issues:**
- [Issue 1]
- [Issue 2]

**Suggested reorganization:**
- [Suggestion]
```

---

## Pass 3: Affordances & Action Clarity

**Designer mindset:** "What actions are obvious without explanation?"

### Force Explicit Decisions

- What is clickable?
- What looks editable?
- What looks like output (read-only)?
- What looks final vs in-progress?
- Is focus state visible enough?

### For Design Systems Specifically

- Do button colors clearly signal "clickable"?
- Are interactive elements visually distinct from static?
- Is hover state noticeable?
- Does focus ring have sufficient contrast?
- Are disabled states obviously disabled?

### Required Output Format

```markdown
## Pass 3: Affordances

| Action | Visual/Interaction Signal |
|--------|---------------------------|
| [Action] | [What makes it obvious] |
| Click button | [Signal] |
| Edit input | [Signal] |
| View output | [Signal] |

**Affordance rules:**
- If user sees X, they should assume Y
- ...

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

No visuals required—just clarity on what signals what.

---

## Pass 4: Cognitive Load & Decision Minimization

**Designer mindset:** "Where will the user hesitate?"

### Force Identification Of

- **Moments of choice** - decisions required
- **Moments of uncertainty** - unclear what to do
- **Moments of waiting** - system processing

### Then Apply These Strategies

- **Collapse decisions** - fewer choices
- **Delay complexity** - progressive disclosure
- **Introduce defaults** - reduce decision burden

### For Design Systems Specifically

- Too many shades that look nearly identical?
- Naming conventions inconsistent?
- Too many component variants?
- Could some tokens be consolidated?

### Required Output Format

```markdown
## Pass 4: Cognitive Load

**Friction points:**
| Moment | Type | Simplification |
|--------|------|----------------|
| [Where] | Choice/Uncertainty/Waiting | [How to reduce] |
| [Where] | Choice/Uncertainty/Waiting | [How to reduce] |

**Consolidation opportunities:**
- [Tokens that could be merged]

**Defaults introduced:**
- [Default 1]: [Rationale]
- [Default 2]: [Rationale]
```

---

## Pass 5: State Design & Feedback

**Designer mindset:** "How does the system talk back?"

### Force Enumeration of States

For EACH major element, enumerate these states:
- **Empty** - nothing to show
- **Loading** - data being fetched
- **Success** - operation completed
- **Partial** - incomplete data/loading
- **Error** - something went wrong
- **Disabled** - cannot interact

### For Each State, Answer

- What does the user **see**?
- What do they **understand**?
- What can they **do next**?

### For Design Systems Specifically

- Are all button states defined? (default, hover, focus, active, disabled, loading)
- Are all input states defined? (empty, focused, filled, error, success, disabled)
- Are feedback colors distinct enough?
- Is error state clearly different from other states?

### Required Output Format

```markdown
## Pass 5: State Design

### [Element/Component Name]

| State | User Sees | User Understands | User Can Do |
|-------|-----------|------------------|-------------|
| Empty | [Visual] | [Understanding] | [Next action] |
| Loading | [Visual] | [Understanding] | [Next action] |
| Success | [Visual] | [Understanding] | [Next action] |
| Partial | [Visual] | [Understanding] | [Next action] |
| Error | [Visual] | [Understanding] | [Next action] |
| Disabled | [Visual] | [Understanding] | [Next action] |

### Buttons
| State | Defined? | Distinct? |
|-------|----------|-----------|
| Default | Yes/No | Yes/No |
| Hover | Yes/No | Yes/No |
| Focus | Yes/No | Yes/No |
| Active | Yes/No | Yes/No |
| Disabled | Yes/No | Yes/No |
| Loading | Yes/No | Yes/No |

**Missing states:**
- [Element] missing [state]

**Indistinct states:**
- [State A] too similar to [State B]
```

This prevents "dead UX"—screens with no feedback.

---

## Pass 6: Flow Integrity Check

**Designer mindset:** "Does this feel inevitable?"

### Final Sanity Check

- Where could users get lost?
- Where would a first-time user fail?
- What must be visible vs can be implied?
- When applied to real UI, does the system guide users naturally?

### For Design Systems Specifically

- Do the tokens work together cohesively?
- Is there consistency across components?
- Would applying these tokens to a real UI feel natural?
- Are there edge cases not covered?

### Required Output Format

```markdown
## Pass 6: Flow Integrity

**Cohesion assessment:** [Overall assessment]

**Failure points for first-time users:**
- [Where they'd fail]
- [Where they'd fail]

**Gaps identified:**
- [Missing token or pattern]

**Inconsistencies:**
- [Inconsistency between elements]

**Edge cases not covered:**
- [Scenario without clear token]

**Visibility decisions:**
| Element | Must Be Visible | Can Be Implied |
|---------|-----------------|----------------|
| [Element] | [Reason] | |
| [Element] | | [Reason] |
```

---

## Critique Summary Format

After running all 6 passes, produce a summary:

```markdown
# Design System Critique Summary

## Overall Assessment
[1-2 sentence summary]

## Critical Issues (Must Fix)
1. [Issue] - [Pass where found] - [Severity: Critical/High]
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
