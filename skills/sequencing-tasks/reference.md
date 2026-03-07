# Task Sequencing Reference

## Contents

- [Task Ordering for TDD](#task-ordering-for-tdd)
- [Rich Task Descriptions](#rich-task-descriptions)
- [Plan MD Format](#plan-md-format)
- [Task Sizing](#task-sizing)
- [Dependency Patterns](#dependency-patterns)
- [Spike Tasks](#spike-tasks)
- [Verification Tasks](#verification-tasks)

## Task Ordering for TDD

Tasks within a tracer bullet must be ordered so each builds naturally on the previous, following TDD progression.

### Natural Progression

The first task in a TB typically sets up the basic structure: interfaces, types, or the minimal scaffolding needed. Subsequent tasks add behavior one test case at a time, following RED-GREEN-REFACTOR.

**Example ordering for a "user registration" TB:**
1. Create user model and basic validation (happy path)
2. Add email format validation (error case)
3. Add duplicate user detection (constraint)
4. TB verification: registration flow works end-to-end

Each task produces a commit with passing tests. The codebase is always in a working state.

### Test Infrastructure Before Features

If a task needs test utilities (factories, fixtures, helpers), create them as part of the first task that needs them, not as a separate "setup" task. Test infrastructure should emerge from need, not anticipation.

### Interface Before Implementation

When building across layers, start with the interface/contract and work inward:
1. Define the API/interface the feature exposes
2. Implement the business logic behind it
3. Wire up persistence or external dependencies

This mirrors how TDD works: define the expected behavior (test), then implement it.

## Rich Task Descriptions

Each task description must be self-contained. A developer (or `/code`) should be able to pick up any task and work on it without reading other tasks.

### Required Elements

**Goal:** One sentence explaining what this task delivers. Not what it does, but what capability exists after completion.

**What to build:** Specific implementation details including:
- What files to create or modify
- What behavior to implement
- What patterns to follow (with references)

**Acceptance criteria:** Specific, testable conditions that define "done":
- Each criterion maps to one or more test cases
- Written as assertions, not descriptions
- Include both positive and negative cases where relevant

**Architecture docs:** Links to relevant architecture documents, design docs, or spike findings that provide context. Use markdown links: `[ARCHITECTURE.md](../../ARCHITECTURE.md)`.

**Files likely involved:** Guidance on which files are likely to be created or modified. This is advisory — the enumerate agent makes the final decision about test structure.

### What Makes a Good Task Description

A good task description answers these questions:
- What exists after this task that didn't exist before?
- How do I know it's done?
- Where can I learn more about the design decisions?
- What did the previous task build that I'm building on?

## Plan MD Format

The plan document uses markdown with checkboxes for progress tracking.

### Structure

```markdown
# Plan: Feature Name

> One-line summary of what this plan delivers.

## Design Decisions

- Key decision 1
- Key decision 2

---

### TB1: Name

**Goal:** What this TB delivers when complete.

**Verification:** How to verify this TB works end-to-end.

---

- [ ] **Task 1: Title**

  Goal and implementation details...

  **Acceptance criteria:**
  - Criterion 1
  - Criterion 2

---

- [ ] **Task 2: Title**

  ...

---

### TB2: Name

...
```

### Checkbox Convention

- `- [ ]` — Task not started or in progress
- `- [x]` — Task completed (tests pass, committed)

Checkboxes are the source of truth for progress. They are updated by the `/code` orchestrator after successful task completion.

### Task Separators

Use `---` between tasks for visual clarity. Each task is a self-contained block.

## Task Sizing

### One `/code` Session Per Task

Each task should be completable in a single `/code` invocation — one TDD cycle of enumerate, implement tests, implement code, refactor, commit.

### Test Case Count

A task with more than ~5-7 test cases is probably too large. Consider splitting:
- Split by behavior dimension (happy path vs error handling)
- Split by entity (if handling multiple related entities)
- Split by layer (if the task spans too many layers)

### When to Split

Split a task when:
- It has more than ~5-7 acceptance criteria
- It touches more than 3-4 files
- It requires multiple conceptually different changes
- The acceptance criteria span different concerns

### When NOT to Split

Keep a task whole when:
- Splitting would leave an incomplete feature
- The parts are tightly coupled (splitting creates coordination overhead)
- The task is small but has many trivial test cases (e.g., validation)

## Spike Tasks

When a tracer bullet includes a spike, the spike task comes first:

```markdown
- [ ] **Task N: Spike — Question to answer**

  Explore whether [technology/approach] can [requirement].

  **What to explore:**
  - Specific question 1
  - Specific question 2

  **Time box:** [duration]

  **Acceptance criteria:**
  - Question is answered with evidence
  - Findings are documented
  - Decision is made on how to proceed
```

Spike tasks use `/code` with task type `spike`. They produce findings that inform subsequent implementation tasks.

## Dependency Patterns

### Within a TB

Tasks within a TB are sequential — top to bottom. No explicit dependency markers needed. Each task assumes the previous one is complete.

### Between TBs

TBs declare dependencies via the `depends_on` field. This is handled at the TB level, not the task level. If TB3 depends on TB1 and TB2, all tasks in TB1 and TB2 must be complete before any task in TB3 starts.

### Verification Tasks

The verification task is always the last task in a TB. It depends on all prior tasks in the TB being complete. Its purpose is to confirm the TB delivers its stated goal.

## Verification Tasks

Every TB ends with a verification task. This is a first-class task, not an afterthought.

### What Verification Tasks Do

- Confirm the TB's goal is achieved
- May include e2e tests, integration tests, or manual verification
- Run the full test suite to check for regressions
- Document what was verified and how

### Verification Task Format

```markdown
- [ ] **Task N: TB1 Verification**

  Verify the minimal end-to-end flow works.

  **What to verify:**
  - Full test suite passes
  - [Specific E2E behavior 1]
  - [Specific E2E behavior 2]
  - No regressions in existing functionality
```

The type of verification (automated vs manual, e2e vs integration) is determined during execution based on what makes sense for the specific TB.
