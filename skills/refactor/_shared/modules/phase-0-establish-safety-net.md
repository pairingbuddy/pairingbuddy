# Phase 0: Establish Safety Net

## Required Reading
- Read reference/data-passing-pattern.md
- Read reference/document-test-coverage-subagent-context.md
- Read reference/identify-coverage-gaps-subagent-context.md

## What to Do

### Step 0.1: Document Current Test Coverage

**Goal:** Create initial documentation of what's currently tested (before gap-filling).

1. Generate unique file path: `/tmp/test-coverage-analysis-{timestamp}.txt`
   - Use current timestamp: YYYYMMDD-HHMMSS format
   - Example: `/tmp/test-coverage-analysis-20251126-143052.txt`

2. Spawn the document-test-coverage skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "haiku"
   - description: "Document current test coverage"
   - prompt: "Use and follow the document-test-coverage skill exactly as written. **Output file:** [file path]. **Test files:** [all test files in scope]. **Context:** [any context]. Analyze what each test verifies and write one-line descriptions to the output file."

3. Store the file path for reference

**Output:** `/tmp/test-coverage-analysis-{timestamp}.txt` - documents what's tested now

### Step 0.2: Identify Test Coverage Gaps

**Goal:** Find behaviors in code that aren't tested yet.

1. Generate unique file path: `/tmp/coverage-gaps-{timestamp}.txt`

2. Spawn the identify-coverage-gaps skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "haiku"
   - description: "Identify coverage gaps"
   - prompt: "Use and follow the identify-coverage-gaps skill exactly as written. **Output file:** [file path]. **Existing test files:** [test files]. **Production code files:** [code files]. **Original requirements:** [requirements if available]. **Context:** [any context]. Analyze what's tested vs what should be tested and write missing test scenarios to the output file."

3. Store the file path for next step

**Output:** `/tmp/coverage-gaps-{timestamp}.txt` - lists behaviors not yet tested

### Step 0.3: Fill Coverage Gaps

**Goal:** Ensure complete test coverage before refactoring begins.

1. Read the coverage gaps file from Step 0.2

2. **If gaps exist:**
   - Create placeholders for each missing scenario:
     ```python
     def test_missing_scenario_name():
         pytest.fail("TODO: Implement test for [scenario description]")
     ```

   - For each new placeholder, cycle through:
     - Read modules/phase-red.md (write failing test)
     - Read modules/phase-green.md (make it pass)
     - Read modules/phase-refactor.md (improve quality)

   - After all gaps filled, delete the coverage gaps file

3. **If no gaps exist:**
   - Proceed to Step 0.4 immediately
   - Delete the coverage gaps file

4. **Baseline verification:**
   - Run all tests
   - Confirm 100% pass
   - We now have complete safety net

**Result:** All behaviors in code are now covered by passing tests

### Step 0.4: Document Complete Test Coverage (New Baseline)

**Goal:** Create refactoring baseline that documents ALL behaviors now tested.

1. Generate unique file path: `/tmp/test-coverage-complete-{timestamp}.txt`
   - Use current timestamp: YYYYMMDD-HHMMSS format
   - Example: `/tmp/test-coverage-complete-20251126-150000.txt`

2. Spawn the document-test-coverage skill again as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "haiku"
   - description: "Document complete test coverage baseline"
   - prompt: "Use and follow the document-test-coverage skill exactly as written. **Output file:** [file path]. **Test files:** [all test files including gap-filling tests]. **Context:** This is the refactoring baseline after gap-filling. Analyze what each test verifies and write one-line descriptions to the output file."

3. **CRITICAL:** Store this file path - the VERIFY-COVERAGE-PRESERVED phase will compare against THIS file

**Output:** `/tmp/test-coverage-complete-{timestamp}.txt` - the refactoring baseline

**This file documents:** Every behavior that must still be tested after refactoring completes

### Step 0.5: Determine Refactoring Goals

**Goal:** Identify what needs to be refactored (quality issues to fix).

**If task provided issues file(s):**
- Task may provide `/tmp/test-quality-issues-{timestamp}.txt` (test refactoring focus)
- Task may provide `/tmp/code-quality-issues-{timestamp}.txt` (code refactoring focus)
- Task may provide both (mixed refactoring)
- Use provided issues file(s)
- Skip analysis
- Proceed to REFACTOR phase

**If task did NOT provide issues file(s):**

1. **For test files in scope:**
   - Generate unique file path: `/tmp/test-quality-issues-{timestamp}.txt`
   - Spawn the identify-test-issues skill as a subagent using the **Task tool**:
     - subagent_type: "general-purpose"
     - model: "sonnet"
     - description: "Identify test quality issues"
     - prompt: "Use and follow the identify-test-issues skill exactly as written. **Output file:** [file path]. **Test files:** [test files to analyze]. **Context:** [any context]. Analyze test code quality against test-patterns.md and write issues to the output file."
   - Store the file path

2. **For app code files in scope:**
   - Generate unique file path: `/tmp/code-quality-issues-{timestamp}.txt`
   - Spawn the identify-code-issues skill as a subagent using the **Task tool**:
     - subagent_type: "general-purpose"
     - model: "sonnet"
     - description: "Identify code quality issues"
     - prompt: "Use and follow the identify-code-issues skill exactly as written. **Output file:** [file path]. **Code files:** [code files to analyze]. **Context:** [any context]. Analyze app code quality against code-patterns.md and write issues to the output file."
   - Store the file path

**Output:** Issue files that specify what to refactor

**Result:** We now know what to refactor (quality improvements to make)

## Verification

- [ ] Step 0.1: Initial coverage documented via Task tool subagent
- [ ] Step 0.2: Coverage gaps identified via Task tool subagent
- [ ] Step 0.3: All gaps filled using RED-GREEN-REFACTOR cycles
- [ ] Step 0.4: Complete coverage baseline documented via Task tool subagent
- [ ] Step 0.5: Refactoring goals determined (provided or analyzed)
- [ ] All tracking files created with timestamp format YYYYMMDD-HHMMSS
- [ ] Baseline file path stored for VERIFY-COVERAGE-PRESERVED phase
- [ ] All tests passing (100% pass rate)
- [ ] Ready for REFACTOR phase
