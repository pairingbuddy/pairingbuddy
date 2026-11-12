---
name: setting-up-spike
description: Sets up a spike by talking with the human in the main context - goal, exploration units, where the code lives and where the write-up goes. Use after G:type, once intake has classified the task as a spike and `pb status --action` says the spike setup is not recorded.
---

# Setting Up a Spike

## Purpose

Clarify the spike goal, split it into exploration units, and write the two setup files the spike run reads. This runs in the main context, after G:type, once intake has classified the task as a spike and `pb status --action` says the setup is not recorded. It needs a conversation. The coding workflow then runs `pb spike setup`, which reads these files and records the setup.

Read `.pairingbuddy/task.json` (description, context) and `.pairingbuddy/human-guidance.json` if it exists, and apply that guidance.

## Conversation

1. Check whether a human can answer.
   - There is no human when AskUserQuestion is not available, or when you run under `claude -p`, in auto permission mode, or with PAIRINGBUDDY_SOLO=true.
   - With no human, skip the rest of the conversation. Never ask in chat instead. Write the default setup files (see When No Human Can Answer) and return, so the coding workflow goes on to `pb spike setup`.
2. Work out the goal: what the spike should learn or answer.
3. Pick the exploration mode:
   - `questions`: answering specific questions ("Can we use X for Y?")
   - `approaches`: comparing implementation approaches
   - `comparison`: comparing technologies or libraries
4. Break the goal into 2-5 units. Each is small, independent and has a clear success criterion. Give each an id (`u1`, `u2`, ...), a name, a description, and an execution config: language, run command, optional setup command, optional environment, and a working directory under the code location.
5. Ask where the spike code lives (a directory such as `spike/`, or a branch) and where the write-up goes. The default write-up path is `docs/spikes/<kebab-goal>.md`.
6. Present everything with AskUserQuestion, with full detail: goal, mode, code location, write-up path, and for each unit its name, description, language, working directory and run command.
7. If the human gives feedback, append it to `.pairingbuddy/human-guidance.json` first (read the file, or start from `{"guidance": []}`; add an entry with agent, timestamp, context, feedback), then redo steps 2-5 and ask again. Leave the loop only on explicit approval or an explicit stop. Plain approvals need no entry.

## When No Human Can Answer

With no human (auto permission mode, `claude -p`, Solo), ask nothing. Pick the defaults: code location `spike/`, write-up path `docs/spikes/<kebab-goal>.md`, 2-3 units, each working directory `<code_location>/<unit id>`. Write the files straight away.

## Output

Write both files with the Write tool (never shell redirection), then read them back.

`.pairingbuddy/spike-config.json`:

```json
{
  "goal": "string",
  "code_location": "string (repo-relative directory, e.g. spike)",
  "exploration_mode": "questions | approaches | comparison",
  "doc_path": "string (repo-relative, ends in .md, e.g. docs/spikes/learn-x.md)"
}
```

`.pairingbuddy/spike-questions.json`:

```json
{
  "units": [
    {
      "id": "u1",
      "name": "string",
      "description": "string",
      "status": "pending",
      "execution": {
        "language": "string",
        "run_command": "string",
        "setup_command": "string (optional)",
        "working_directory": "spike/u1",
        "environment": { "KEY": "value" }
      }
    }
  ]
}
```

`pb spike setup` refuses, and records nothing, when:

- the task is not a spike, G:type has not passed, or the setup is already recorded
- either file is missing
- there are no units
- a unit id does not match `^[a-z0-9][a-z0-9_-]{0,63}$`, or two units share an id
- `code_location`, `doc_path` or a unit `working_directory` is empty, not a string, absolute, contains `..`, or sits inside `.pairingbuddy/` or `.git/`
- `doc_path` does not end in `.md`
- a unit `working_directory` is not `code_location` or inside it

Write only these two files (and `human-guidance.json` when feedback arrives).
