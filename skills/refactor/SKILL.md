---
name: refactor
description: Improve code quality/structure without changing behavior
---

# Refactor

Improve code quality and structure without changing behavior using TDD safety nets.

## Workflow Rules (CRITICAL - Follow Exactly)

**Phase 0: ESTABLISH-SAFETY-NET** (Mandatory)
- Read [phase-0-establish-safety-net](_shared/modules/phase-0-establish-safety-net.md)
- Document current test coverage (baseline)
- Identify and fill coverage gaps
- Document complete test coverage (refactoring baseline)
- Determine refactoring goals (analyze or use provided issues)

**Phase REFACTOR: INCREMENTAL CHANGES** (Mandatory - Stay GREEN Throughout)

Work through refactoring issues incrementally, keeping all tests GREEN:

1. **If test quality issues exist:**
   - Spawn @mimer-code:refactor-test atomic skill (model: sonnet)
   - Reads: `/tmp/test-quality-issues-{timestamp}.txt`
   - Makes: ONE refactoring change at a time
   - Verifies: All tests still GREEN after each change
   - Continues until all test issues resolved

2. **If code quality issues exist:**
   - Spawn @mimer-code:refactor-code atomic skill (model: sonnet)
   - Reads: `/tmp/code-quality-issues-{timestamp}.txt`
   - Makes: ONE refactoring change at a time
   - Verifies: All tests still GREEN after each change
   - Continues until all code issues resolved

3. **After each refactoring change:**
   - Run tests
   - If any test fails → behavior changed (rollback or fix)
   - All tests must stay GREEN throughout
   - May need to iterate between test and code refactoring

**NO RED phase during refactoring - we're not adding behavior.**
**All tests stay GREEN - if any test fails, rollback immediately.**

**Phase VERIFY-COVERAGE-PRESERVED** (Mandatory - After Refactoring)

After refactoring, verify coverage preservation before proceeding:

1. Read [phase-verify-coverage-preserved](_shared/modules/phase-verify-coverage-preserved.md)
2. Spawn @mimer-code:verify-test-coverage atomic skill (model: sonnet)
3. Compares baseline coverage against current test files
4. If coverage lost:
   - STOP immediately
   - Report which behaviors are no longer tested
   - Fix tests to restore coverage
   - Re-run verification
5. If coverage preserved:
   - Proceed to next phase

**This prevents silent coverage loss during refactoring.**

**Phase FINAL-REFACTOR** (Mandatory)

Final quality pass on all code:

1. Read [phase-refactor](_shared/modules/phase-refactor.md)
2. Ask human for scope (current files vs broader analysis)
3. Use Opus for broader scope analysis
4. Apply final polish while staying GREEN

**Phase VERIFY-SCENARIOS** (Mandatory - Before Final Verification)

Verify all tests still pass and no behavior changed:

1. Run all tests in scope
2. Confirm 100% pass rate
3. Test count may differ (consolidated/removed redundant tests)
4. But coverage must be preserved (verified in previous phase)

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
