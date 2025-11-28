---
name: build-new-feature
description: Build new features using TDD with full coverage and optimization
---

# Build New Feature

Implement new functionality using TDD.

## Workflow Rules (CRITICAL - Follow Exactly)

**Phase 0: ENUMERATE** (Mandatory)
- Read [phase-0-enumerate](_shared/modules/phase-0-enumerate.md)
- Enumerate ALL test scenarios upfront

**Phase RED-GREEN Cycle** (Mandatory - No Skipping)

For EVERY test you MUST execute:
1. **RED** → Read [phase-red](_shared/modules/phase-red.md) - Write ONE failing test
2. **GREEN** → Read [phase-green](_shared/modules/phase-green.md) - Make that test pass with minimal code

**NO exceptions. NO batch implementation. ONE test at a time.**

**Phase REFACTOR** (Mandatory with Flexible Cadence)

After GREEN phase, you have flexibility on WHEN to refactor:
- You MAY skip REFACTOR for early tests (first 1-4 tests) to build up functionality
- You MUST run REFACTOR at least once every 5-10 tests maximum
- You MUST run REFACTOR after ALL tests are implemented (mandatory final refactor)

Read [phase-refactor](_shared/modules/phase-refactor.md) when executing refactor phase.

**Rationale:** Early tests may not have duplication/complexity worth refactoring. But as code grows, technical debt accumulates. Regular refactoring prevents code rot.

**Phase VERIFY-SCENARIOS** (Mandatory - Before COVERAGE)

After completing all RED-GREEN-REFACTOR cycles, you MUST verify all enumerated scenarios were implemented:

1. Read the tracking file created in phase-0-enumerate (path stored earlier)
2. For each scenario in that file, verify a corresponding test exists
3. If ANY scenario is missing:
   - **STOP immediately**
   - Report which scenarios were not implemented
   - Return to RED phase for each missing scenario
4. Once all scenarios verified, delete the tracking file
5. Proceed to COVERAGE phase

**This prevents forgetting to implement enumerated scenarios.**

**Phase COVERAGE** (Mandatory)
- Read [phase-coverage](_shared/modules/phase-coverage.md)
- YOU MUST check for coverage gaps after exhausting initial test list
- No skipping allowed

**Phase OPTIMIZE** (Currently deferred)
- Read [phase-optimize](_shared/modules/phase-optimize.md)

**Phase FINAL-VERIFICATION** (Mandatory - Before Completion)

Before marking the task complete, you MUST verify everything works:

1. Read [phase-final-verification](_shared/modules/phase-final-verification.md)
2. Run the FULL test suite (entire project, not just your tests)
3. Verify ALL tests pass (100% pass rate, no regressions)
4. Report results to human operator

**Do NOT mark task complete until full test suite passes.**

**Phase COMMIT** (Mandatory - After Verification)

After full test suite passes, commit your changes:

1. Use the **Skill tool** to invoke @superpowers:committing-changes
2. The skill will create a clean commit message without AI attribution
3. Follow the skill's guidance exactly

**Critical:** Do NOT create commits manually. Always use @superpowers:committing-changes.

**Return to orchestrator** when complete

## When Stuck
Check [reference](_shared/reference/) directory for code patterns and examples. **IMPORTANT:** Explicitly state what you're stuck on and that you're loading reference materials to help.
