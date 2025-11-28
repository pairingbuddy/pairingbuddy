# COVERAGE Phase: Fill Coverage Gaps

## When to Execute This Phase

**MANDATORY:** You MUST execute this phase after exhausting all initial test scenarios.

**No skipping allowed.** Even if you think coverage is complete, you must verify by spawning the identify-coverage-gaps skill.

## Required Reading
- Read reference/data-passing-pattern.md
- Read reference/identify-coverage-gaps-subagent-context.md

## What to Do

### 1. Spawn identify-coverage-gaps atomic skill (MANDATORY)

Generate output file path and spawn identify-coverage-gaps:

1. Generate unique file path: `/tmp/coverage-gaps-{timestamp}.txt`

2. Spawn the identify-coverage-gaps skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "haiku"
   - description: "Identify coverage gaps"
   - prompt: "Use and follow the identify-coverage-gaps skill exactly as written. **Output file:** [file path]. **Existing test files:** [test files]. **Production code files:** [code files]. **Original requirements:** [requirements]. **Context:** [any context]. Analyze what's tested vs what should be tested and write missing test scenarios to the output file."

3. Store the file path for next step

### 2. Process the gaps

1. Read the coverage gaps file

2. If gaps exist, create placeholders for each missing scenario:
```python
def test_missing_scenario_name():
    pytest.fail("TODO: Implement test for [scenario description]")
```

3. Delete the coverage gaps file

### 4. Return to RED phase

For each new placeholder, cycle through:
- phase-red.md (write failing test)
- phase-green.md (make it pass)
- phase-refactor.md (improve quality)

## Verification
- [ ] Coverage gaps identified via Task tool subagent
- [ ] Placeholders created for missing tests (if any)
- [ ] Ready to cycle through RED-GREEN-REFACTOR for each gap
- [ ] If no gaps: ready for OPTIMIZE phase
