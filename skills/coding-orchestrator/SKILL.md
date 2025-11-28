---
name: coding-orchestrator
description: Entry point for all coding tasks - classifies task type and delegates to specialized skills
---

# Coding Orchestrator

Entry point for all coding tasks.

## Workflow

**Step 1: Analyze User Request**
- Review user's request and current git status
- Identify task type indicators (keywords, file changes, context)

**Step 2: Classify Task Type**
- If task type is clear → delegate directly to appropriate skill
- If task type is ambiguous → read [ambiguity-resolution](modules/ambiguity-resolution.md)

**Step 3: Delegate to Appropriate Skill**
- Read [task-classification](modules/task-classification.md) for classification logic and delegation patterns
- Use Skill tool for task skills: @mimer-code:build-new-feature, @mimer-code:fix-bug, @mimer-code:extend-functionality, @mimer-code:refactor
- Use Task tool for atomic skills when spawning subagents (see subagent templates)

**Step 4: Invoke Committing Changes**
- After delegated skill completes, invoke @superpowers:committing-changes
- Single commit for entire workflow

**Step 5: Report Completion**
- Summarize work completed
- Confirm commit created
- Note any recommendations

## Task Classification

Read [task-classification](modules/task-classification.md) for:
- Table of task types and specialized skills
- Classification heuristics
- When to use Skill tool vs Task tool (subagent)

## Ambiguity Resolution

When task type is unclear, read [ambiguity-resolution](modules/ambiguity-resolution.md) for:
- AskUserQuestion template
- How to phrase classification questions
- What options to present

## Subagent Templates

When spawning subagents for atomic skills, read appropriate template from [subagent-templates](subagent-templates/):
- [enumerate-test-scenarios](subagent-templates/enumerate-test-scenarios.md)
- [implement-test](subagent-templates/implement-test.md)
- [implement-code](subagent-templates/implement-code.md)
- [identify-test-issues](subagent-templates/identify-test-issues.md)
- [identify-code-issues](subagent-templates/identify-code-issues.md)
- [identify-coverage-gaps](subagent-templates/identify-coverage-gaps.md)
- [refactor-test](subagent-templates/refactor-test.md)
- [refactor-code](subagent-templates/refactor-code.md)

## Core Principle

**One skill, one responsibility**: The orchestrator only classifies and delegates - never implements.
