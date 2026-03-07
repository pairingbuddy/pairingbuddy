---
name: decomposing-tracer-bullets
description: Tracer bullet methodology for decomposing features into thin end-to-end slices. Covers slice identification, YAGNI alignment, verification tasks, inline spikes, and common anti-patterns.
---

# Decomposing Tracer Bullets

Reference material for decomposing features into thin end-to-end slices using tracer bullet methodology.

## Contents

- [Quick Reference](#quick-reference) - Core principles and patterns at a glance
- [Detailed Patterns](./reference.md) - Deep dive with examples and anti-patterns

## Quick Reference

### What is a Tracer Bullet?

A thin end-to-end slice that delivers working functionality. Named after the military concept: fire a visible round to see if it hits the target before committing full ammunition. Each tracer bullet proves the path works, then subsequent bullets widen and deepen the implementation.

### Core Principles

| Principle | Meaning |
|-----------|---------|
| **End-to-end** | Each TB delivers something that works through all layers |
| **Minimal** | The thinnest useful slice — no gold-plating |
| **YAGNI** | You can stop after any TB and have something useful |
| **Verified** | Each TB ends with a verification task |
| **Learning flows forward** | What you learn in TB1 informs TB2 |

### Slice Ordering Patterns

- Single item before collection
- Happy path before error handling
- Synchronous before asynchronous
- Read before write
- Core before extensions
- Manual before automated

### Anti-Patterns

| Anti-Pattern | Why It Fails |
|--------------|-------------|
| Horizontal slicing (all models, then all controllers) | No working E2E path until everything is done |
| Infrastructure before features | Building foundations without proving they support anything |
| Gold-plating early TBs | Wasted effort if assumptions are wrong |
| TBs that can't be verified independently | No confidence that the slice works |

### Inline Spikes

When a TB depends on an unknown, insert a spike task before the implementation tasks. The spike answers the question, then implementation proceeds with confidence.

### Relationship to TDD

Each task within a TB is designed for RED-GREEN-REFACTOR. The TB verification task may include e2e tests, integration tests, or manual verification — determined during execution.
