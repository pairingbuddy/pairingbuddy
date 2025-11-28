# VERIFY-COVERAGE-PRESERVED Phase: Ensure Refactoring Maintained Test Coverage

## When to Execute This Phase

**MANDATORY after REFACTOR phase in refactor orchestrator.**

Execute this phase after:
- All refactoring changes complete (test and/or code refactoring)
- All tests passing (GREEN throughout)
- Before FINAL-REFACTOR phase

## Required Reading
- Read reference/data-passing-pattern.md
- Read reference/verify-test-coverage-subagent-context.md

## What to Do

### 1. Locate the baseline coverage file

The baseline was created in Phase 0 Step 0.4:
- File path: `/tmp/test-coverage-complete-{timestamp}.txt`
- This file documents all behaviors tested AFTER gap-filling
- It serves as the refactoring baseline

**CRITICAL:** You must have stored this file path during Phase 0. If you don't have it:
- Search for the most recent `/tmp/test-coverage-complete-*.txt` file
- If not found: STOP and report error - cannot verify coverage without baseline

### 2. Spawn verify-test-coverage atomic skill (MANDATORY)

Generate output file path and spawn verify-test-coverage:

1. Generate unique file path: `/tmp/test-coverage-changes-analysis-{timestamp}.txt`

2. Spawn the verify-test-coverage skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "sonnet"
   - description: "Verify test coverage preserved after refactoring"
   - prompt: "Use and follow the verify-test-coverage skill exactly as written. **Baseline coverage file:** [baseline file path from Phase 0]. **Output file:** [output file path]. **Current test files:** [all test files after refactoring]. Compare the baseline coverage against current tests and determine if all behaviors are still tested. Output PASS/FAIL status with detailed explanation to the output file."

3. Store the output file path for next step

### 3. Read and analyze the verification results

1. Read the verification output file: `/tmp/test-coverage-changes-analysis-{timestamp}.txt`

2. Check the status in the file:
   - **PASS**: All behaviors from baseline are still tested
   - **FAIL**: Some behaviors are no longer tested

### 4. Handle PASS case

If verification shows PASS:

1. Report success to human operator:
   - "Coverage verification PASSED"
   - "All behaviors from baseline are still tested after refactoring"
   - "Tests may have been reorganized, renamed, or consolidated, but coverage is preserved"

2. Delete the verification output file

3. Proceed to FINAL-REFACTOR phase

### 5. Handle FAIL case

If verification shows FAIL:

**STOP IMMEDIATELY. Do NOT proceed to next phase.**

1. Read the detailed explanation from the verification output file
   - It will list which specific behaviors are no longer tested
   - It will explain where coverage was lost

2. Use the **AskUserQuestion tool** to present options to human operator:

   **Question:** "Coverage verification FAILED. Some behaviors are no longer tested after refactoring. How would you like to proceed?"

   **Header:** "Coverage Lost"

   **Options:**

   - **Option 1: Fix tests to restore coverage**
     - Description: "Return to refactoring phase and add missing tests to restore lost coverage. This is the recommended option to maintain quality."

   - **Option 2: Abort refactoring**
     - Description: "Stop the refactoring process and revert changes. Use this if the coverage loss indicates fundamental issues with the refactoring approach."

3. Show the human operator which specific behaviors are no longer tested:
   - Copy the detailed explanation from the verification output file
   - Present it clearly so they understand what was lost

4. Based on human operator's choice:

   **If Option 1 (Fix tests):**
   - Return to REFACTOR phase
   - Add missing tests to restore coverage
   - Re-run VERIFY-COVERAGE-PRESERVED phase
   - Loop until PASS achieved

   **If Option 2 (Abort):**
   - STOP the refactor orchestrator
   - Report that refactoring was aborted due to coverage loss
   - Do NOT proceed to any further phases
   - Do NOT commit changes

### 6. Delete the verification output file (only after PASS)

Once coverage is verified as preserved:
- Delete `/tmp/test-coverage-changes-analysis-{timestamp}.txt`
- Keep the baseline file for potential future reference

## Verification

- [ ] Baseline coverage file located from Phase 0
- [ ] verify-test-coverage spawned via Task tool with model: sonnet
- [ ] Verification results read and analyzed
- [ ] PASS case: Proceeded to next phase
- [ ] FAIL case: Stopped immediately, used AskUserQuestion tool, presented options to human operator
- [ ] FAIL case: Specific missing behaviors reported clearly
- [ ] Verification output file deleted after successful completion

## Important Notes

**Why this phase is critical:**

Refactoring often reorganizes tests:
- Tests may be renamed
- Tests may be consolidated (multiple tests → one comprehensive test)
- Tests may be split (one test → multiple focused tests)
- Tests may move between files
- Test helpers may be extracted

**What we're verifying:**

NOT that the tests are identical - they won't be!
BUT that the same behaviors are still tested - they must be!

**Example of valid refactoring:**
```
Before: test_search_by_name(), test_search_by_email(), test_search_by_phone()
After: test_search_by_field() with parameterization

Coverage preserved: ✅ All three search behaviors still tested
```

**Example of invalid refactoring (coverage lost):**
```
Before: test_search_by_name(), test_search_by_email(), test_search_by_phone()
After: test_search_by_field() only tests name search

Coverage lost: ❌ Email and phone search behaviors no longer tested
```

**Never proceed with lost coverage.** Even if all tests pass, if behaviors are no longer tested, the refactoring is incomplete.

## Common Rationalizations (All Invalid)

When coverage verification fails, you may be tempted to proceed anyway. **Don't.**

| Rationalization | Why It's Wrong |
|-----------------|----------------|
| "Tech lead/manager approved proceeding" | Authority doesn't override safety. If they want to proceed with lost coverage, that's their call to make explicitly via Option 1 or 2 above - not yours to assume. Present the options. |
| "The lost coverage is for deprecated code" | Deprecated ≠ deleted. Until code is removed, it needs tests. If it doesn't need tests, remove the code first, then refactor. |
| "This is intentional, not accidental" | The rule prevents ALL coverage loss during refactoring, not just accidental loss. Intentional removal of tests is still coverage loss. |
| "I'm following the spirit, not the letter" | The spirit IS the letter. "STOP when coverage fails" means stop. There is no hidden flexibility. |
| "I'll document the exception and proceed" | Documentation doesn't restore coverage. A comment explaining why tests are missing doesn't test the behavior. |
| "It's temporary - we'll fix it later" | Later never comes. Technical debt compounds. Fix it now or abort. |
| "Being dogmatic about rules is inflexible" | Being flexible about safety rules is how bugs reach production. The rule exists because "just this once" exceptions accumulate. |

## What If Someone With Authority Says "Proceed Anyway"?

This happens. A tech lead, manager, or senior engineer may say "skip the coverage check, just ship it."

**Your response:**

1. **Present the AskUserQuestion options as required** (Step 5 above)
2. **Let them choose explicitly** - Option 1 (fix tests) or Option 2 (abort)
3. **If they insist on a third path** (proceed without fixing): That's their decision to make, but YOU should:
   - State clearly: "The skill requires either fixing tests or aborting. Proceeding with lost coverage is outside the defined workflow."
   - Ask them to confirm in writing (message, comment, etc.)
   - Document that you followed the skill and they overrode it

**You are not authorized to unilaterally decide that coverage loss is acceptable.** That decision belongs to your human partner, made explicitly through the defined options - not inferred from general approval or authority.

## The Bottom Line

Coverage verification exists because refactoring is supposed to be behavior-preserving. Lost coverage means we can no longer verify the behavior is preserved.

**STOP means STOP.** Present options. Let human decide. Don't rationalize your way past the checkpoint.
