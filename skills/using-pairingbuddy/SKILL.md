---
name: using-pairingbuddy
description: Use when starting any conversation - establishes mandatory workflows for all coding, planning, and design tasks
---

<EXTREMELY-IMPORTANT>
For ANY coding task, you MUST use the /pairingbuddy:code command.
For ANY planning task, you MUST use the /pairingbuddy:plan command.
For ANY design system task, you MUST use the /pairingbuddy:design-ux command.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

# Getting Started with Pairing Buddy

Pairing Buddy orchestrates TDD workflows, planning, and design system creation through specialized agents.

## Critical Rules

1. **All coding tasks go through /pairingbuddy:code** - Classifies your task and runs the appropriate TDD workflow via subagents.

2. **All planning tasks go through /pairingbuddy:plan** - Brainstorms requirements, solidifies architecture, decomposes into tracer bullets, and sequences TDD-ready tasks.

3. **All design system tasks go through /pairingbuddy:design-ux** - Creates production-ready design systems with three-tiered token architecture.

4. **Follow workflows strictly** - Each command loads an orchestrator skill with pseudocode. Follow it exactly. Do not skip steps, reorder agents, or deviate.

5. **Use subagents** - Every function call in the workflow pseudocode maps to a Task tool invocation. Do not do agent work in the main context.

6. **Never skip the commit step** - When the workflow includes a commit step, follow it.

## When to Use What

| Command | Use for |
|---------|---------|
| `/pairingbuddy:code` | Building features, fixing bugs, refactoring, config changes, spikes |
| `/pairingbuddy:plan` | Planning features with tracer bullet methodology |
| `/pairingbuddy:design-ux` | Creating and iterating on design systems |

## Common Rationalizations That Mean You're About To Fail

If you catch yourself thinking ANY of these thoughts, STOP. Use the appropriate command.

- "This is a simple fix" - WRONG. Simple fixes need tests too. Use /code.
- "I'll just write the code quickly" - WRONG. TDD first. Use /code.
- "Let me implement first, then add tests" - WRONG. That's not TDD. Use /code.
- "I can plan this in my head" - WRONG. Use /plan.
- "I'll skip the subagent and do it myself" - WRONG. Subagents have specialized instructions you don't have.
- "This step doesn't apply" - WRONG. The workflow handles edge cases. Follow it.

## Summary

- **Coding tasks:** /pairingbuddy:code
- **Planning tasks:** /pairingbuddy:plan
- **Design tasks:** /pairingbuddy:design-ux

**Workflows are mandatory. Subagents are mandatory. No exceptions.**
