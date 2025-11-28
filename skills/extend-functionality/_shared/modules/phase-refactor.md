# REFACTOR Phase: Improve Quality

## When to Execute This Phase

**You MAY skip this phase IF:**
- You're in early tests (first 1-4 tests) building up initial functionality
- You haven't completed 5-10 tests since last refactor

**You MUST execute this phase IF:**
- You've completed 5-10 tests since last refactor (or never refactored)
- ALL tests are implemented (mandatory final refactor before COVERAGE phase)
- You see obvious duplication, code smells, or complexity

**When in doubt: Refactor.** Technical debt compounds.

## Required Reading
- Read reference/data-passing-pattern.md
- Read reference/identify-test-issues-subagent-context.md
- Read reference/refactor-test-subagent-context.md
- Read reference/identify-code-issues-subagent-context.md
- Read reference/refactor-code-subagent-context.md

## What to Do

### 0. Determine refactoring scope and run baseline tests

#### 0.1 Determine if this is incremental or final refactor

**Incremental refactor** (during RED-GREEN-REFACTOR cycles):
- Performed every 5-10 tests
- **Fixed scope: Recently modified files only**
- Goal: Prevent local technical debt accumulation
- **NO human interaction** - use default scope

**Final refactor** (after all tests implemented, before COVERAGE):
- Performed once after all RED-GREEN cycles complete
- **Variable scope: Ask human operator twice (test scope + code scope)**
- Goal: Ensure overall code quality hasn't suffered from narrow-focus changes

#### 0.2 For FINAL refactor only: Ask human operator for scope

**ONLY execute this step if this is the FINAL refactor (after all tests implemented).**

**Question 1 - Test refactoring scope:**

Use the AskUserQuestion tool to ask:

"What scope should the test code refactoring analysis cover?"

Options:
1. **Recently modified test files** - Only test files changed during this feature
2. **Current test file + related test files** - All test files in the same module/feature
3. **Full test suite** - All test files in the entire project

**Recommendation:** Option 3 (Full test suite) to catch incremental degradation.

Store the choice as `test_scope` for step 1.1.

**Question 2 - Application code refactoring scope:**

Use the AskUserQuestion tool to ask:

"What scope should the application code refactoring analysis cover?"

Options:
1. **Recently modified code files** - Only code files changed during this feature
2. **Current module + related code** - All code files in the same module/feature area
3. **Full codebase** - All application code in the entire project

**Recommendation:** Option 2 (Current module + related code) as a good balance.

Store the choice as `code_scope` for step 2.1.

**For INCREMENTAL refactors:** Skip this step, use "recently modified files" scope automatically for both tests and code.

#### 0.3 Run baseline tests

Based on the scope selected:

**For incremental refactors (automatic):**
- Run tests in current test file only

**For final refactor (based on test_scope choice):**
- Option 1: Run tests in recently modified test files
- Option 2: Run tests for current module/feature
- Option 3: Run entire project test suite

**Why run tests first:**
- Establishes baseline (all tests passing before changes)
- If tests fail after refactor, you know your changes caused it
- Catches pre-existing issues before you start

**If tests fail before refactoring:**
- Stop and fix existing failures first
- Do not proceed with refactoring on top of broken tests

### 1. REFACTOR TESTS

#### 1.1 Identify test issues

Generate output file path and spawn identify-test-issues:

1. Generate unique file path: `/tmp/test-quality-issues-{timestamp}.txt`

2. Determine which test files to analyze based on scope:
   - **Incremental refactor**: Recently modified test files only
   - **Final refactor with test_scope=1**: Recently modified test files
   - **Final refactor with test_scope=2**: All test files in current module/feature
   - **Final refactor with test_scope=3**: All test files in entire project

3. Select model based on scope complexity:
   - **Recently modified files only**: Use model: "sonnet"
   - **Current module/feature or broader**: Use model: "opus"

4. Spawn the identify-test-issues skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: [model selected in step 3]
   - description: "Identify test issues"
   - prompt: "Use and follow the identify-test-issues skill exactly as written. **Output file:** [file path]. **Test files to analyze:** [list test files based on scope]. **Context:** [any context]. Analyze the tests and write quality issues to the output file."

5. Store the file path for next step

#### 1.2 Fix test issues (if issues found)

1. Read the issues file to check if any issues were found

2. If issues exist, spawn the refactor-test skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "sonnet"
   - description: "Refactor tests"
   - prompt: "Use and follow the refactor-test skill exactly as written. **Issues file:** [file path]. **Test command:** [test command]. **Context:** [any context]. Read issues from file, fix them, and verify all tests still pass."

3. After refactor-test completes, delete the issues file

#### 1.3 Ask human operator

Ask: "Continue refactoring tests or move to code refactoring?"
- If continue: return to step 1.1
- If move on: proceed to step 2

### 2. REFACTOR CODE

#### 2.1 Identify code issues

Generate output file path and spawn identify-code-issues:

1. Generate unique file path: `/tmp/code-quality-issues-{timestamp}.txt`

2. Determine which code files to analyze based on scope:
   - **Incremental refactor**: Recently modified code files only
   - **Final refactor with code_scope=1**: Recently modified code files
   - **Final refactor with code_scope=2**: All code files in current module/feature area
   - **Final refactor with code_scope=3**: All application code in entire project

3. Select model based on scope complexity:
   - **Recently modified files only**: Use model: "sonnet"
   - **Current module/feature or broader**: Use model: "opus"

4. Spawn the identify-code-issues skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: [model selected in step 3]
   - description: "Identify code issues"
   - prompt: "Use and follow the identify-code-issues skill exactly as written. **Output file:** [file path]. **Code files to analyze:** [list code files based on scope]. **Context:** [any context]. Analyze the code and write quality issues to the output file."

5. Store the file path for next step

#### 2.2 Fix code issues (if issues found)

1. Read the issues file to check if any issues were found

2. If issues exist, spawn the refactor-code skill as a subagent using the **Task tool**:
   - subagent_type: "general-purpose"
   - model: "sonnet"
   - description: "Refactor code"
   - prompt: "Use and follow the refactor-code skill exactly as written. **Issues file:** [file path]. **Test command:** [test command]. **Context:** [any context]. Read issues from file, fix them, and verify all tests still pass."

3. After refactor-code completes, delete the issues file

#### 2.3 Ask human operator

Ask: "Continue refactoring code or proceed to next test?"
- If continue: return to step 2.1
- If move on: proceed to next test

## Verification
- [ ] Test issues identified via Task tool subagent
- [ ] Test issues fixed (if any)
- [ ] Code issues identified via Task tool subagent
- [ ] Code issues fixed (if any)
- [ ] All tests still pass
- [ ] Human operator decisions obtained
- [ ] Ready for next test or COVERAGE phase
