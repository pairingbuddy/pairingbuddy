---
name: enumerating-tests
description: Provides patterns and anti-patterns for enumerating test scenarios. Use when analyzing requirements to identify what to test. Covers enumeration techniques, common mistakes, and when to stop enumerating.
---

# Enumerating Tests

Reference material for discovering and listing test scenarios before writing code.

## Contents

- [Quick Reference](#quick-reference) - Enumeration at a glance
- [Detailed Patterns](./reference.md) - Deep dive with examples

## Quick Reference

### Enumeration Anti-Patterns

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Implementation details** | "modifies list in-place" | Test observable behavior: "sorts items descending" |
| **Context variations** | "works when called from ServiceA" | Only test if behavior differs |
| **Verification steps** | "verifies items are in order" | That's an assertion, not a test |
| **Redundant variations** | 3 tests for "handles None/empty/missing" | One test: "treats missing values as zero" |

### Enumeration Categories

| Category | What to Look For |
|----------|------------------|
| **Happy Path** | Main success scenarios |
| **Edge Cases** | Boundary conditions, unusual but valid inputs |
| **Error Handling** | Invalid inputs, failure scenarios |
| **Boundary Conditions** | Values at limits of acceptable ranges |
| **Integration Points** | External system interactions |
| **State Transitions** | Different states the system can be in |

### Key Principles

1. **One test per behavior** - not one test per permutation
2. **Observable behaviors only** - what it does, not how it works
3. **Consolidate similar cases** - group trivial variations
4. **Start implementing early** - don't over-enumerate upfront
