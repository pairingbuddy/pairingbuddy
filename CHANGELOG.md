# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Design UX skill for creating production-ready design systems
  - New orchestrator skill: designing-ux with `/pairingbuddy:design-ux` command
  - Seven new agents for the design workflow:
    - design-ux-explorer: establishes domain grounding and design intent before generation
    - design-ux-architect: makes strategic layout, color, component, and typography decisions
    - design-ux-token-generator: generates three-tier token architecture (global/alias/component)
    - design-ux-visual-builder: creates preview.html and example.html with Playwright feedback
    - design-ux-critic: evaluates designs using 6-pass UX analysis framework
    - design-ux-validator: validates structural correctness of design artifacts
    - design-ux-gallery-generator: creates web-hostable gallery for comparing explorations
  - Six new reference skills for design agents:
    - differentiating-designs: craft knowledge for intentional differentiation
    - applying-design-principles: Laws of UX, specifications, Norman's principles
    - critiquing-designs: 6-pass UX critique framework
    - building-components: component patterns and domain packs
    - generating-design-previews: preview and example HTML templates
    - generating-exploration-gallery: gallery and comparison templates
  - Fourteen new JSON schemas for design state management:
    - brand, design-artifacts, design-brief, design-critique, design-decisions
    - design-direction, design-experience-config, design-session
    - design-system-config, design-validation, domain-spec
    - exploration-status, gallery-output, tokens-generated
  - Design state lives in `.pairingbuddy/design-ux/{exploration-name}/`
  - Parallel exploration support with isolated session state
  - Web output: preview.html, example.html with Tailwind CDN and dark mode
  - Three-tier token architecture: global tokens → alias tokens → component tokens
  - Multi-brand architecture support via brand.schema.json

### Fixed

- Front-loaded file restrictions in explore-spike-unit to prevent /tmp writes
  - Moved file creation restrictions to start of Step 2 (before main work begins)
  - Previously restrictions came after instructions, causing LLM to create markdown files in /tmp

- Made state file cleanup explicit in workflow pseudocode
  - Added `_cleanup_state_files()` orchestrator function with crystal-clear description
  - Added mandatory call in workflow after `curate_guidance`, before `classify_task`
  - Previously cleanup was only described in prose, causing Claude to skip it

### Changed

- Agent count increased from 18 to 25
- Schema count increased from 21 to 35
- Skill count increased from 7 to 14 (2 orchestrators, 1 entry, 11 reference)
- Test count increased from ~565 to ~881

- Upgraded models for better task performance
  - implement-tests: haiku → sonnet (tests may require design decisions beyond mechanical translation)
  - refactor-tests: haiku → sonnet (consistency with refactor-code which was already sonnet)
  - explore-spike-unit: sonnet → opus (spikes involve complex research and exploration)
  - identify-test-issues: haiku → opus (critical quality gate - misses have compounding effects)
  - identify-code-issues: haiku → opus (critical quality gate - misses have compounding effects)

- Improved curate-guidance agent to show actual entries during human review

- Replaced `summarize-spike` agent with `document-spike` agent
  - Now MANDATORY at end of spike workflow (was optional)
  - Creates comprehensive documentation capturing ALL findings (not a summary that loses information)

- Improved Human Review step to require comprehensive descriptions
  - Updated canonical `workflow_step3_human_review` content block with explicit instructions
  - All 10 agents with Human Review updated to match new canonical content

- Added mandatory output file writing instructions to Step 4: Output
  - New canonical `workflow_step4_output` content block with explicit Write tool requirements
  - Three write modes: "Writes to" (overwrite), "Appends to" (read-add-write), "Updates" (read-modify-write)
  - All 10 agents with Step 4: Output updated to match new canonical content

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
