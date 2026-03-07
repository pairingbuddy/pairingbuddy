# Tracer Bullet Methodology Reference

## Contents

- [What is a Tracer Bullet?](#what-is-a-tracer-bullet)
- [Core Principles](#core-principles)
- [How to Identify TB Boundaries](#how-to-identify-tb-boundaries)
- [Patterns](#patterns)
- [Anti-Patterns](#anti-patterns)
- [Inline Spikes](#inline-spikes)
- [Relationship to TDD](#relationship-to-tdd)

## What is a Tracer Bullet?

A tracer bullet is a thin end-to-end slice that delivers working functionality through all layers of the system. The metaphor comes from military practice: soldiers fire visible tracer rounds to confirm their aim before committing to a full burst. In software, each tracer bullet proves a path through the system works before building more on top of it.

The key insight: **each tracer bullet is a complete, working feature** — not a prototype, not a stub, not a scaffold. It's thin, but it's real.

## Core Principles

### 1. End-to-End Through All Layers

Every tracer bullet must touch all the layers it will eventually need. If the feature involves UI, API, business logic, and storage, then TB1 touches all four — even if it only handles the simplest possible case.

**Right:** TB1 handles a single item, happy path, through all layers.
**Wrong:** TB1 builds all the database models. TB2 builds all the API endpoints. TB3 builds the UI.

### 2. Minimal Increment

Each TB adds the minimum needed to deliver its goal. TB1 is the simplest useful path. TB2 adds exactly one dimension (error handling, or multiple items, or a second entity type). Never add two dimensions at once.

### 3. YAGNI Alignment

You can stop after any TB and have something that works. This means:
- TB1 is independently deployable
- Each subsequent TB adds value but is not required
- If requirements change after TB3, you haven't wasted work on TB7

### 4. Verification at the End

Every TB ends with a verification task. This might be:
- Automated e2e tests
- Integration tests
- Manual verification steps
- A combination

The verification task is a first-class task in the plan, not an afterthought.

### 5. Learning Flows Forward

What you learn building TB1 informs how you approach TB2. Discoveries, constraints, and edge cases found in earlier TBs refine the plan for later ones. This is a feature, not a bug — the plan evolves as understanding deepens.

## How to Identify TB Boundaries

### Start with the Simplest Path

TB1 should be the absolute simplest end-to-end path:
- Single item (not a collection)
- Happy path only (no error handling)
- Hardcoded or minimal configuration
- The most common use case

### Add One Dimension Per TB

Each subsequent TB adds exactly one new dimension:

| TB | What it adds |
|----|-------------|
| TB1 | Single item, happy path |
| TB2 | Error handling for TB1's path |
| TB3 | Multiple items / collection support |
| TB4 | Edge cases and validation |
| TB5 | Performance or scaling concerns |
| TB6 | Advanced features |

This is illustrative — the actual dimensions depend on the feature.

### Natural Deployment Points

TB boundaries should align with points where you could deploy and get value. Ask: "If we stopped here, would users benefit?" If yes, it's a good boundary.

### Independent Value

Each TB should deliver something independently valuable. If TB3 only makes sense with TB4, they should be one TB.

## Patterns

### Single Before Collection

Build the system to handle one thing before handling many. One user, one order, one notification. The collection handling is a separate TB.

### Happy Path Before Errors

Make it work for the expected case first. Error handling, validation, and edge cases come in subsequent TBs. This proves the architecture before adding complexity.

### Synchronous Before Asynchronous

Build it synchronous first. Adding async processing, queues, or background jobs is a separate TB that builds on a working synchronous foundation.

### Read Before Write

If the feature involves both reading and writing data, start with read. Reading is simpler and proves the data model works before adding mutation complexity.

### Core Before Extensions

Build the core feature before adding extensions, plugins, or configurability. Extensions are separate TBs.

### Manual Before Automated

If something can be done manually first (e.g., data migration, configuration), do it manually in TB1. Automating it is a separate TB.

## Anti-Patterns

### Horizontal Slicing

**Wrong:** Build all models first, then all controllers, then all views.

This is the most common mistake. It produces no working functionality until everything is done. If anything is wrong in the model layer, you don't find out until you try to wire it to the controller.

**Right:** Build one thin vertical slice through all layers.

### Infrastructure Before Features

**Wrong:** Set up the build system, CI/CD pipeline, monitoring, and logging before writing any feature code.

Infrastructure should be added as needed by features, not built speculatively.

**Right:** TB1 includes the minimum infrastructure needed to make it work. Additional infrastructure comes in later TBs.

### Gold-Plating Early TBs

**Wrong:** Make TB1 production-perfect with full error handling, logging, monitoring, and documentation.

Early TBs exist to prove the path works. Polish comes later. If your assumptions about the path are wrong, the polish is wasted.

**Right:** TB1 is functional but minimal. Polish is a later TB.

### Non-Verifiable TBs

**Wrong:** A TB that "sets up the database schema" with no way to verify it works.

Every TB must have a verification task that proves it works end-to-end.

**Right:** Every TB ends with a concrete verification that demonstrates working functionality.

## Inline Spikes

When a TB depends on a technical unknown, insert a spike task before the implementation:

1. **Identify the unknown:** "Can library X handle our throughput requirements?"
2. **Insert spike task:** A focused exploration that answers the question
3. **Spike completes:** Answer informs the implementation approach
4. **Continue with implementation:** Now you know how to proceed

Spikes are time-boxed. If the spike doesn't resolve the unknown, escalate to the human for a decision.

## Relationship to TDD

Tracer bullets and TDD are complementary:

- **TB level:** Determines WHAT to build (scope and order)
- **Task level:** Each task within a TB follows RED-GREEN-REFACTOR
- **Verification task:** May include e2e tests that exercise the full TB path

The TB verification task is itself a first-class task that goes through the TDD workflow. It may produce integration tests, e2e tests, or define manual verification steps — determined at execution time based on what makes sense for the specific TB.
