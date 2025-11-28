# FINAL-VERIFICATION Phase: Confirm Success

## When to Execute This Phase

**MANDATORY before completing the task.**

Execute this phase after:
- All tests implemented (RED-GREEN cycles complete)
- Final REFACTOR complete
- VERIFY-SCENARIOS complete
- COVERAGE phase complete (if executed)

## What to Do

### 1. Run full test suite

Run the complete test suite for the entire project (not just the tests you wrote).

**Why full suite:**
- Verify no regressions in existing functionality
- Ensure integration with rest of codebase works
- Catch unexpected side effects from your changes

Use the project's standard test command (e.g., `pytest`, `npm test`, `cargo test`).

### 2. Verify all tests pass

Check the output carefully:
- ✅ All tests must pass (100% pass rate)
- ✅ No skipped tests (unless they were already skipped)
- ✅ No warnings about your changes
- ✅ Coverage metrics match expectations (if applicable)

**If ANY test fails:**
- Do NOT mark task complete
- Analyze which test(s) failed and why

**If a NEW test you wrote is failing:**
- Return to GREEN phase for that test
- Spawn implement-code to fix the implementation
- Verify the test passes
- Run full suite again

**If an EXISTING test (regression) is failing:**
- This is a regression caused by your changes
- Two options:
  1. **Fix your implementation**: Return to GREEN phase, fix the code that caused regression
  2. **Update the test**: Only if requirements genuinely changed - return to RED phase to update the test
- Run full suite again

**Loop until all tests pass**, then proceed to step 3

### 3. Report results to human operator

Summarize what was accomplished:
- Number of tests implemented
- What behaviors are now verified
- Confirmation that full test suite passes
- Any notable observations or concerns

### 4. Only then mark task complete

After full test suite passes, the task is complete.

## Verification

- [ ] Full test suite executed (not just new tests)
- [ ] All tests passing (100% pass rate)
- [ ] No regressions detected
- [ ] Results reported to human operator
- [ ] Task marked complete
