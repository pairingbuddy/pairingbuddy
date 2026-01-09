# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Made state file cleanup explicit in workflow pseudocode
  - Added `_cleanup_state_files()` orchestrator function with crystal-clear description
  - Added mandatory call in workflow after `curate_guidance`, before `classify_task`
  - Previously cleanup was only described in prose (State File Management section), causing Claude to skip it
  - Files preserved: `test-config.json`, `doc-config.json`, `human-guidance.json`
  - All other state files deleted to prevent stale state from previous tasks

### Changed

- Improved curate-guidance agent to show actual entries during human review
  - Added step 4 in Main Work requiring ACTUAL entry text (not generic placeholders)
  - Must show proposed action (KEEP/DROP/CONSOLIDATE) for each entry
  - Must show reasoning for each classification
  - For consolidations: show both original entries AND proposed merged text

- Replaced `summarize-spike` agent with `document-spike` agent
  - Now MANDATORY at end of spike workflow (was optional)
  - Creates comprehensive documentation capturing ALL findings (not a summary that loses information)
  - Includes: all findings, caveats, unexplored areas, issues, limitations, recommendations
  - Shows human mapping: spike-findings.json → document (proves nothing lost)
  - Asks human: where to persist, option to modify content, option to modify format
  - Human review checkpoint with full Step 1-4 workflow pattern

- Improved Human Review step to require comprehensive descriptions
  - Updated canonical `workflow_step3_human_review` content block with explicit instructions
  - Example interaction now shows `[description with all relevant details]` instead of generic `[description]`
  - Added **Important** paragraph emphasizing that descriptions must include ALL relevant details for informed decisions
  - setup-spike agent now has spike-specific guidance listing required details (goal, exploration mode, code location, unit details)
  - All 10 agents with Human Review updated to match new canonical content

- Added mandatory output file writing instructions to Step 4: Output
  - New canonical `workflow_step4_output` content block with explicit Write tool requirements
  - Three write modes: "Writes to" (overwrite), "Appends to" (read-add-write), "Updates" (read-modify-write)
  - Completion requirements: agent cannot exit until all output files are written
  - Explicitly forbids bash commands (echo, cat, printf, heredoc) for JSON file writing
  - All 10 agents with Step 4: Output updated to match new canonical content

- Fixed Output section documentation for consistency
  - create-test-placeholders: Changed "Writes to" to "Appends to" for tests.json (preserves existing entries)
  - verify-test-coverage: Added tests.json with "Updates" mode (reconciliation)
  - update-documentation: Added doc-config.json with "Writes to" mode (bootstrap/update)

## [0.4.0] - 2026-01-06

### Added

- curate-guidance agent for selective carry-over of human guidance between tasks
  - Analyzes existing guidance entries and classifies as task-specific (drop) or general (keep)
  - Proposes consolidation of similar entries into principles
  - Human checkpoint for approval with ability to modify or add new entries
  - Supports bootstrap mode when no existing guidance (offer to seed persistent guidance)
- Persistent guidance feature via `persistent` field in human-guidance.schema.json
  - Entries with `persistent: true` survive cleanup between tasks
  - Preserves operational knowledge (how to run tests, where to document, coding preferences)

### Changed

- Agent count increased from 17 to 18
- Human review checkpoint count increased from 9 to 10
- Updated orchestrator workflow to invoke curate-guidance before task classification
- human-guidance.json now persists across tasks (like test-config.json and doc-config.json)

## [0.3.0] - 2025-12-17

### Added

- update-documentation agent for keeping docs in sync with code changes
  - Analyzes code changes and identifies documentation needing updates
  - Supports both in-repo and external documentation locations
  - Human checkpoint before making updates
  - New persistent doc-config.json for documentation locations
  - New docs-updated.json output for commit context
- Two new schemas: doc-config.schema.json, docs-updated.schema.json
- Agent count increased from 16 to 17
- Schema count increased from 19 to 21

### Changed

- Restructured Human Review workflow with explicit Step 1-4 pattern:
  - Step 1: Read Inputs (always includes human-guidance.json first)
  - Step 2: Main Work (agent-specific analysis)
  - Step 3: Human Review (with retry loop back to Step 2 on feedback)
  - Step 4: Output (only after explicit approval)
- Moved Human Review content into Step 3 (removed separate ## Human Review section)
- Added canonical content blocks: workflow_read_inputs, workflow_step3_human_review
- All 9 agents with Human Review now enforce: read guidance first, redo work after feedback, never proceed to output without approval
- Test count changed from ~500 to ~565
- Refactor agents (refactor-tests, refactor-code) now run targeted tests with verify-fix loop:
  - Run only modified test files or tests that exercise modified code (not entire suite)
  - Retry loop: if tests fail, analyze and fix before proceeding
  - Ask human operator if stuck after 3 attempts

## [0.2.0] - 2025-12-17

### Added

- Spike workflow for exploratory coding without TDD
  - Three new agents: setup-spike, explore-spike-unit, summarize-spike
  - Five new schemas for spike state management
  - New task type "spike" in classify-task agent
- Human guidance persistence across agents via human-guidance.json
- Focus warning in all agents to prevent scope creep
- Human review checkpoints in setup-spike and explore-spike-unit agents
- Architecture documentation (ARCHITECTURE.md)
- Claude Code context file (CLAUDE.md)

### Changed

- Human review section integrated into Instructions via markdown links
- Expanded agent count from 13 to 16
- Expanded schema count from 14 to 19
- Expanded test count from ~300 to ~500

## [0.1.0] - 2025-12-13

### Added

- Agent-based architecture replacing nested skill structure
  - Thirteen TDD agents with single-responsibility design
  - JSON state contracts between agents
  - Python pseudocode workflow in orchestrator
- Core TDD workflow agents
  - classify-task: Determine task type (new_feature, bug_fix, refactoring, config_change)
  - enumerate-scenarios-and-test-cases: Analyze requirements into test scenarios
  - create-test-placeholders: Create test file structure
  - implement-tests: RED phase - write failing tests
  - implement-code: GREEN phase - write minimal passing code
  - identify-test-issues and refactor-tests: REFACTOR phase for tests
  - identify-code-issues and refactor-code: REFACTOR phase for code
  - verify-test-coverage: Coverage verification with gap detection
  - run-all-tests: Final test suite verification
  - commit-changes: Git integration
  - scope-refactoring: Entry point for refactoring workflow
- Reference skills for language-specific guidance
  - writing-tests: Test patterns, FIRST principles, anti-patterns
  - writing-code: SOLID principles, Clean Code practices
  - refactoring-code: Code smell identification, refactoring techniques
  - enumerating-tests: Test scenario enumeration patterns
  - committing-changes: Git commit best practices
- Contract-driven development infrastructure
  - Fourteen JSON schemas for state validation
  - agent-config.yaml as single source of truth
  - Approximately 300 structural tests
- Human review checkpoints in six agents
- Entry point command: /pairingbuddy:code

### Removed

- Nested skill architecture (replaced by flat agents)
- Direct superpowers dependency
