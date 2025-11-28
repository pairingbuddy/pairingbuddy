# GREEN Phase: Make Test Pass

## Required Reading
- Read reference/implement-code-subagent-context.md

## What to Do

### 1. Spawn implement-code atomic skill

Spawn the implement-code skill as a subagent using the **Task tool**:
- subagent_type: "general-purpose"
- model: "sonnet"
- description: "Implement code to pass test"
- prompt: "Use and follow the implement-code skill exactly as written. **Failing test:** [test name]. **Test command:** [test command]. **Context:** [any context]. Write minimal code to make this test pass, verify it passes, and verify all other tests still pass."

Fill in [test name] with the failing test name, [test command] with how to run tests, and [any context] with relevant information.

### 2. Verify all tests pass

The subagent will implement the code and verify all tests pass. Confirm from the subagent's output that:
- Code was written
- Failing test now passes
- All existing tests still pass (no regressions)

## Verification
- [ ] Minimal code written via Task tool subagent
- [ ] Failing test now passes
- [ ] All tests passing (no regressions)
- [ ] Ready for REFACTOR phase
