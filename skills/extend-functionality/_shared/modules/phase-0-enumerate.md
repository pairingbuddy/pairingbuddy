# Phase 0: Enumerate Tests

## Required Reading
- Read reference/enumerate-test-scenarios-subagent-context.md

## What to Do

### 1. Spawn enumerate-test-scenarios atomic skill

Spawn the enumerate-test-scenarios skill as a subagent using the **Task tool**:
- subagent_type: "general-purpose"
- model: "haiku"
- description: "Enumerate test scenarios"
- prompt: "Use and follow the enumerate-test-scenarios skill exactly as written. **Feature requirements:** [user's request]. **Context:** [any context]. Return a structured list of test scenario descriptions organized by category."

Fill in [user's request] with the actual feature requirements and [any context] with relevant information.

### 2. Write scenarios to tracking file (MANDATORY)

The subagent will return a structured list of test scenarios. You MUST:

1. Generate a unique tracking file path:
   - Use current timestamp: YYYYMMDD-HHMMSS format
   - Example: `/tmp/test-scenarios-20251124-143052.txt`

2. Write ALL scenarios to this file, one per line (simple descriptive text)

3. **IMPORTANT:** Store this file path - you'll need it in VERIFY-SCENARIOS phase

4. Output the file path clearly so you can reference it later

Example tracking file content:
```
deduplicates single list with duplicates preserving first occurrence
deduplicates multiple lists with overlapping ULIDs preserving first occurrence
returns empty list when given no input lists
handles single ULID appearing in multiple lists
```

### 3. Create pytest.fail() placeholders

For each scenario in the tracking file, create a test placeholder:
```python
def test_scenario_name():
    pytest.fail("TODO: Implement test for [scenario description]")
```

**CRITICAL: Create placeholders for ALL scenarios in the tracking file.**

DO NOT rationalize away tests on your own:
- ❌ "This seems like too many tests, I'll skip some"
- ❌ "These tests are redundant, I'll combine them"
- ❌ "I'll filter out implementation details"

**IF the enumeration seems problematic** (includes implementation details, redundant tests, context variations):
1. Report your concerns to the human operator with specific examples
2. Ask whether to proceed as-is or abort to fix the enumeration guidance
3. Let the human decide

**DO NOT silently skip tests.** Every scenario in the tracking file must be implemented.

### 4. Verify placeholders created

Run tests to verify all placeholders are discovered by pytest.

## Verification
- [ ] Test scenarios enumerated via Task tool subagent
- [ ] ALL scenarios written to tracking file in OS temp directory
- [ ] Tracking file path stored for later verification
- [ ] Placeholders created for each scenario
- [ ] Placeholders discovered by pytest
- [ ] Ready for RED phase
