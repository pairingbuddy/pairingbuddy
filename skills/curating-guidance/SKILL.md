---
name: curating-guidance
description: Curates human guidance with the human in the main context at the start of a task, before cleanup, outside Solo, plan tasks included.
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

Look at files with Read. Find and search with Glob and Grep when they exist, otherwise with one plain `find` or `grep` Bash command. Use Bash only for one plain command, such as running the tests or one git command: never with `&&`, `;`, `|`, `$(...)` or `cd`, and never to echo an environment variable. A compound command waits on a permission prompt that can hold the whole run.

## Conversation

First, check whether a human can answer. Look in your session context for a `<pairingbuddy-no-human>` block: the SessionStart hook adds it under the auto policy or `claude -p`, since only a hook sees the environment. Run no Bash for this check. If that block is there, or `PAIRINGBUDDY_SOLO` is `true`, follow "When No Human Can Answer" below and skip the rest of this section.

Next, classify each entry:

- `general` entries are general, so keep them, because they apply broadly to future work: how to run tests or the app, where to document changes, resource access patterns, coding preferences, project conventions.
- `task_specific` entries are task-specific, so drop them, because they relate only to the completed task: specific implementation decisions for completed features, one-time corrections that do not generalize.
- Entries with `task_scoped: true` are dropped without asking: list them under DROP with the reason "task_scoped", marked automatic.

Consolidate similar `general` entries by merging them into a single principle. For example, "Don't use mocks" and "Prefer real implementations" become "Prefer real implementations over mocks".

Prepare a proposal listing the entries to KEEP, the entries to DROP, and the proposed consolidations, each with its reason. Show the actual text of each entry, never a generic placeholder. For a consolidation, show both original entries and the merged text.

Offer to bootstrap with persistent guidance, such as how to run tests, where to document changes, and coding preferences, only when the guidance file is missing. An empty file means the human already skipped that offer, so it is not made again.

When every entry is already persistent and the proposal has nothing to drop and nothing to consolidate, ask nothing: the entries carry over as they are. Finish with one line saying so, then record the curation as Output says.

Then review with the human. Present the proposal with `AskUserQuestion`, with the header `Guidance` on each question, since under auto mode the gate knows the question by that header and denies it, and with full detail: the actual text of each entry, the keep, drop or consolidate action, and the reason. For a missing file, present the bootstrap offer the same way, and the human can add entries or skip.

The human can approve, modify entries (edit text, reclassify keep or drop), add new persistent guidance not captured during the session, or ask for a re-analysis with feedback.

Review loop:

1. Present the findings and ask for approval.
2. If the human gives corrections or feedback, immediately append an entry capturing it to `.pairingbuddy/human-guidance.json` with the Write tool (read the file first, or start from `{"guidance": []}` if it is missing). Then redo the classification and consolidation with the feedback, present the revised proposal, and ask again.
3. Exit the loop only on explicit approval (for example "yes", "proceed", "looks good") or an explicit stop (for example "stop", "skip", "cancel").

Never go on to the output after feedback: always redo the analysis and ask again. A simple approval needs no recorded entry. Write the final file only after approval.

## When No Human Can Answer

With no human, carry the guidance over silently. There is no human under the auto policy or `claude -p`, which the `<pairingbuddy-no-human>` block from SessionStart says. The same holds if `PAIRINGBUDDY_SOLO` is `true`, or if AskUserQuestion is ever denied with "No human answers", or is not among your tools at all. Then:

1. Ask nothing and offer nothing: never ask in chat, and do not offer to bootstrap.
2. Keep every persistent entry unchanged, field for field. Drop every entry with `task_scoped: true`. If the file is missing, start from `{"guidance": []}`.
3. If the entries hold a real doubt that only a person can settle, such as two entries that contradict each other, keep those entries unchanged, merging and dropping nothing more than step 2 says, and pass that doubt, phrased as one question, as the curation record's `--doubt` (see Output). The run then sets it aside as a question for the human and goes on.
4. Write `.pairingbuddy/human-guidance.json` with the Write tool, never bash, only when something was dropped or the file is missing, then record the curation (see Output).
5. Finish with one line saying the guidance was carried over, not a question, then return so the coding workflow goes on to cleanup.

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

Every way through this skill ends by recording the curation, with one plain Bash command: `pb guidance record --mode <mode> --kept <n> --dropped <n>`, where `pb` is the coding skill's `node <root>/cli/pb.mjs`. Add `--doubt <question>` only when a doubt is left for the human. The mode is `auto` when nobody was asked (no human, or nothing changed) and `human` when the human approved; the counts are the entries kept and dropped. No run is open yet, so pb keeps the record on the open unit, and `pb run open` moves it onto the task's run, where the report shows it. When pb answers that no unit is open, nothing is recorded and the task goes on.
