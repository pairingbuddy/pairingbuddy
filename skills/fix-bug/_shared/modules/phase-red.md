# RED Phase: Write Failing Test

## Required Reading
- Read reference/implement-test-subagent-context.md

## What to Do

### 1. Pick next test placeholder

Identify the next `pytest.fail("TODO: ...")` placeholder to implement.

### 2. Spawn implement-test atomic skill

Spawn the implement-test skill as a subagent using the **Task tool**:
- subagent_type: "general-purpose"
- model: "haiku"
- description: "Write failing test"
- prompt: "Use and follow the implement-test skill exactly as written. **Test scenario:** [scenario description]. **Test command:** [test command]. **Context:** [any context]. Write ONE test for this scenario, run it, and verify it fails for the right reason."

Fill in [scenario description] with the test scenario, [test command] with how to run the test, and [any context] with relevant information.

### 3. Verify test fails correctly

The subagent will write the test and verify it fails. Confirm from the subagent's output that:
- Test was written
- Test runs
- Test fails with expected failure message (not syntax error or import error)

## Verification
- [ ] Test written via Task tool subagent
- [ ] Test verified failing for the right reason
- [ ] Ready for GREEN phase
