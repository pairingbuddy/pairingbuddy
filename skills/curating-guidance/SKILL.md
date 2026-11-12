---
name: curating-guidance
description: Curates human guidance with the human in the main context at the start of a task, before cleanup, outside Solo and plan tasks.
---

# Curating Guidance

## Purpose

At the start of each new task, review the human guidance from previous sessions and decide what carries forward. This preserves operational knowledge (how to run tests, where to document, coding preferences) and drops guidance that no longer applies.

Two cases apply:

1. Existing guidance: classify, consolidate, and propose the carry-over.
2. No existing guidance: offer to bootstrap with new persistent guidance.

## Input

Read `.pairingbuddy/human-guidance.json` (optional, it may not exist on first run). Each entry has `agent`, `timestamp`, `context`, `feedback`, and optionally `persistent` (carried over from a previous session) and `task_scoped` (a note for this task only, dropped at the next task).

Read `.pairingbuddy/task.json` (optional) for context on the just-completed task: `description` and `context`.

## Conversation

First, check whether a human can answer. If `PAIRINGBUDDY_SOLO` is `true`, there is no human: skip the Bash check and follow "When No Human Can Answer" below. Otherwise run this with Bash:

```bash
echo "$PAIRINGBUDDY_GATE_POLICY/$CLAUDE_CODE_ENTRYPOINT"
```

If there is no human, follow "When No Human Can Answer" below and skip the rest of this section.

Next, classify each entry:

- `general` entries are general, so keep them, because they apply broadly to future work: how to run tests or the app, where to document changes, resource access patterns, coding preferences, project conventions.
- `task_specific` entries are task-specific, so drop them, because they relate only to the completed task: specific implementation decisions for completed features, one-time corrections that do not generalize.
- Entries with `task_scoped: true` are dropped without asking: list them under DROP with the reason "task_scoped", marked automatic.

Consolidate similar `general` entries by merging them into a single principle. For example, "Don't use mocks" and "Prefer real implementations" become "Prefer real implementations over mocks".

Prepare a proposal listing the entries to KEEP, the entries to DROP, and the proposed consolidations, each with its reason. Show the actual text of each entry, never a generic placeholder. For a consolidation, show both original entries and the merged text.

If the guidance file is empty or missing, offer to bootstrap with persistent guidance, such as how to run tests, where to document changes, and coding preferences.

Then review with the human. Present the proposal with `AskUserQuestion`, with full detail: the actual text of each entry, the keep, drop or consolidate action, and the reason. For an empty or missing file, present the bootstrap offer the same way, and the human can add entries or skip.

The human can approve, modify entries (edit text, reclassify keep or drop), add new persistent guidance not captured during the session, or ask for a re-analysis with feedback.

Review loop:

1. Present the findings and ask for approval.
2. If the human gives corrections or feedback, immediately append an entry capturing it to `.pairingbuddy/human-guidance.json` with the Write tool (read the file first, or start from `{"guidance": []}` if it is missing). Then redo the classification and consolidation with the feedback, present the revised proposal, and ask again.
3. Exit the loop only on explicit approval (for example "yes", "proceed", "looks good") or an explicit stop (for example "stop", "skip", "cancel").

Never go on to the output after feedback: always redo the analysis and ask again. A simple approval needs no recorded entry. Write the final file only after approval.

## When No Human Can Answer

With no human, carry the guidance over silently. There is no human if the Bash output starts with `auto/`, which is the auto policy, or ends with `/sdk-cli`, which is `claude -p`. The same holds if `PAIRINGBUDDY_SOLO` is `true`, or if AskUserQuestion is ever denied with "No human answers". Then:

1. Ask nothing and offer nothing: never ask in chat, and do not offer to bootstrap.
2. Keep every persistent entry unchanged, field for field. Drop every entry with `task_scoped: true`, and rewrite `.pairingbuddy/human-guidance.json` with the Write tool, never bash, only when something is dropped. If the file is missing, write `{"guidance": []}`.
3. Finish with one line saying the guidance was carried over, not a question, then return so the coding workflow goes on to cleanup.

## Output

After approval, write the carried-over entries to `.pairingbuddy/human-guidance.json` with the Write tool, never bash. Approved entries get `"persistent": true`. A kept entry must not carry `task_scoped`: if the human keeps a `task_scoped` entry, remove its `task_scoped` field when marking it persistent. Read the file back to confirm it is valid JSON.

```json
{
  "guidance": [
    {
      "agent": "curating-guidance",
      "timestamp": "2026-01-06T10:00:00Z",
      "context": "carried over from previous session",
      "feedback": "Use uv run pytest to run tests",
      "persistent": true
    }
  ]
}
```

When the human skips and there is nothing to keep, write `{"guidance": []}`.
