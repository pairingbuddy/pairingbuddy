---
name: sequencing-tasks
description: Task sequencing principles for TDD-ready plans. Covers ordering for natural TDD progression, rich task descriptions, plan MD format with checkboxes, task sizing, and dependency patterns.
---

# Sequencing Tasks

Reference material for breaking tracer bullets into sequenced, self-contained tasks ready for `/pairingbuddy:code`.

## Contents

- [Quick Reference](#quick-reference) - Ordering, format, sizing at a glance
- [Detailed Patterns](./reference.md) - Deep dive with examples

## Quick Reference

### Task Ordering for TDD

1. First task in a TB sets up the basic structure/interface
2. Subsequent tasks add behavior one test case at a time
3. Each task builds naturally on the previous
4. Verification task is always last in the TB

### Rich Task Description Format

Each task must be self-contained — copyable to `/code` as-is:

- **Goal:** One sentence, what this task delivers
- **What to build:** Specific implementation details
- **Acceptance criteria:** Testable conditions that define done
- **Architecture docs:** Links to relevant docs for context
- **Files likely involved:** Guidance, not prescription

### Plan MD Format

```markdown
### TB1: Name — Goal

**Verification:** How to verify this TB works end-to-end.

- [ ] **Task 1: Title**

  Goal and details...

  **Acceptance criteria:**
  - Criterion 1
  - Criterion 2

- [ ] **Task 2: Title**

  ...
```

### Task Sizing

| Guideline | Rationale |
|-----------|-----------|
| One `/code` session per task | Keeps commits atomic |
| ~5-7 test cases max | More means the task should split |
| Spike tasks are standalone | One question, one answer |
| Verification tasks are first-class | Not an afterthought |

### Dependency Patterns

- **Within a TB:** Sequential (top to bottom)
- **Between TBs:** Explicit via `depends_on` TB ids
- **Verification tasks:** Depend on all prior tasks in the TB
