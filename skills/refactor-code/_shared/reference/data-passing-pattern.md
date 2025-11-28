# Data Passing Pattern Between Skills

## Purpose

When passing structured data between atomic skills or phases, use files instead of copying text. This prevents errors and enables verification.

## Rules

### For Producer Skills (Write Data)

When you produce structured output (lists, reports, analysis results):

1. **Generate unique file path:**
   - Use OS temp directory
   - Name describes the content (not the skill name)
   - Include timestamp for uniqueness
   - Format: `/tmp/{content-name}-{timestamp}.txt`
   - Timestamp format: YYYYMMDD-HHMMSS (e.g., 20251124-143052)
   - Examples:
     - `/tmp/test-scenarios-20251124-143052.txt`
     - `/tmp/test-quality-issues-20251124-143105.txt`
     - `/tmp/code-quality-issues-20251124-143210.txt`
     - `/tmp/coverage-gaps-20251124-143330.txt`

2. **Write output to file:**
   - One item per line for lists
   - Or structured format (JSON, markdown, plain text)

3. **Return the file path clearly:**
   - "Results written to: {file_path}"

4. **DO NOT delete the file** - orchestrator handles cleanup

### For Consumer Skills (Read Data)

When you need to consume data from a producer:

1. **Receive file path as input parameter**

2. **Read data from file**

3. **Process the data**

4. **DO NOT delete the file** - orchestrator handles cleanup

### For Orchestrator (Manage Lifecycle)

You control the file lifecycle:

1. **Generate file path** before spawning producer
2. **Pass file path** to skills that need it
3. **Delete file** when no longer needed:
   - After verification complete
   - After all consumers finished
   - Before moving to next major phase

## Current Standard File Names

- `test-scenarios-{timestamp}.txt` - Enumerated test scenarios
- `test-quality-issues-{timestamp}.txt` - Test code quality issues
- `code-quality-issues-{timestamp}.txt` - Production code quality issues
- `coverage-gaps-{timestamp}.txt` - Missing test scenarios identified by coverage analysis
