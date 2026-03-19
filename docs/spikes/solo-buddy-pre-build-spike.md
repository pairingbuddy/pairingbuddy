# Solo Buddy Pre-Build Spike — Findings

**Goal:** Answer unknowns U01-U04 before building Solo Buddy: understand guardian hook internals, inventory all human interaction points that the orchestrator must suppress, and validate claude CLI flags for the shell script entry point. Purely analytical — no code was written.

---

## Finding 1: Guardian Hook Internals (U01)

**Injection interval:** `INTERVAL_MS = 5 * 60 * 1000` (5 minutes), defined at line 9 of `hooks/guardian.mjs`.

**Injection mechanism:** Reads JSON from stdin (Claude Code hook protocol). Outputs JSON to stdout with `hookSpecificOutput.additionalContext` containing the reminder text. When `additionalContext` is non-empty, Claude Code injects it into conversation context.

**State file location:** `.pairingbuddy/hooks/{session-id}.json` in CWD. State contains `lastInjection` (ISO timestamp) and `trigger` (`'compact'` or `'timer'`).

**Two trigger modes:**
- Timer-based (PostToolUse): fires after every tool call, injects if 5+ minutes since last injection.
- Force inject (SessionStart:compact): passes `'always'` as `argv[2]`, always injects regardless of timer.

**Solo mode integration points:**
- Environment variable check (`process.env.PAIRINGBUDDY_SOLO`) at top of script.
- `REMINDER` constant (lines 11-18) can be replaced with Solo-specific constraints.
- `SOLO_INTERVAL_MS` constant for halved cadence (2.5 min).
- `shouldInject` logic (line 34) uses interval variable.

**Key design properties:**
- Hook runs as external process — session agent cannot disable it.
- Reads `process.cwd()` for state directory.
- No env vars currently read — adding `PAIRINGBUDDY_SOLO` is a clean, non-breaking addition.
- Hook protocol output format is fixed by Claude Code.

---

## Finding 2: Human Interaction Inventory (U02 + U03)

### Orchestrator `_ask_human` calls — coding SKILL.md

- Line 125: "Task {index} complete. Continue to next task?" — category: operational continuation.
- Line 171: "Coverage gaps found. Implement missing tests?" — category: pass-along decision.
- Line 230: "Unit explored. Continue to next unit?" — category: operational continuation.
- Line 247: "All tests pass. Commit changes?" — category: operational confirmation.

### Orchestrator `_ask_human` calls — designing-ux SKILL.md

- Line 193: "Continue, adjust, or done?" — category: genuine ambiguity (requires human design judgment).

### Orchestrator `_ask_human` calls — planning SKILL.md

- Line 84: "Existing plan: {completed}/{total} tasks done. Resume, re-plan remaining, or start fresh?" — category: genuine ambiguity (requires human strategic choice).

### Agents WITH AskUserQuestion (16 of 29)

All use identical Step 3 Human Review pattern with review loop:
`brainstorm-requirements`, `create-test-placeholders`, `curate-guidance`, `decompose-tracer-bullets`, `design-ux-explorer`, `document-spike`, `enumerate-scenarios-and-test-cases`, `explore-spike-unit`, `identify-code-issues`, `identify-test-issues`, `scope-refactoring`, `sequence-tasks`, `setup-spike`, `solidify-architecture`, `update-documentation`, `verify-test-coverage`.

### Agents WITHOUT AskUserQuestion (13 of 29)

`classify-task`, `commit-changes`, `design-ux-architect`, `design-ux-critic`, `design-ux-gallery-generator`, `design-ux-token-generator`, `design-ux-validator`, `design-ux-visual-builder`, `implement-code`, `implement-tests`, `refactor-code`, `refactor-tests`, `run-all-tests`.

### Special case: design-ux-explorer

Uses `AskUserQuestion` as its FIRST action (lines 130, 141) for information gathering (who uses this? example sites? references?), not just for review. This is genuine ambiguity that cannot be auto-responded in Solo mode.

### Solo mode categorization

- **Auto-yes in Solo** (operational continuation): coding SKILL.md lines 125, 230.
- **Auto-yes in Solo** (pass-along decision): coding SKILL.md line 171.
- **Auto-yes in Solo** (operational confirmation): coding SKILL.md line 247.
- **Stop and document in Solo** (genuine ambiguity): designing-ux SKILL.md line 193, planning SKILL.md line 84.
- **Auto-approve in Solo** (agent Step 3 reviews): all 16 agents with `AskUserQuestion`.

---

## Finding 3: Claude CLI Flags (U04)

### `-p` / `--print` flag (REQUIRED)

Non-interactive mode. Runs Claude without a REPL, prints response and exits. Core flag for Solo Buddy.

### AskUserQuestion in `-p` mode (CRITICAL)

`AskUserQuestion` is inherently blocked in print mode. Tested three configurations: plain `-p`, `-p --dangerously-skip-permissions`, `-p --permission-mode bypassPermissions`. All result in `permission_denials` — the tool call is denied, not answered.

**Implication:** The orchestrator does NOT need to suppress agent `AskUserQuestion` calls. The CLI mode handles it automatically. Agents will simply have their `AskUserQuestion` denied and must proceed without human input.

### `--dangerously-skip-permissions` (LIKELY REQUIRED)

Bypasses Bash/Edit/Write permission checks for autonomous tool use. Does NOT affect `AskUserQuestion` denial (blocked regardless). Solo Buddy needs this for unattended execution.

### `--output-format json` (RECOMMENDED)

Structured JSON output lets the shell script parse results, detect `permission_denials`, read `total_cost_usd`, and determine stop reason.

### `--max-turns` (OPTIONAL safety cap)

Limits conversation turns to prevent runaway sessions.

### `--max-budget-usd` (OPTIONAL safety cap)

Maximum dollar spend per session.

### `--model` (OPTIONAL)

Override model selection. Not required — defaults to user's configured model.

### `--append-system-prompt` (OPTIONAL)

Could inject Solo-specific constraints, though the guardian hook and `-p` prompt may be sufficient.

### Minimum viable invocation

```bash
claude -p --dangerously-skip-permissions --output-format json "<prompt>"
```

Plugin loading happens automatically if installed. `--max-turns` and `--max-budget-usd` recommended as configurable safety caps.

---

## Caveats and Assumptions

- The `AskUserQuestion` blocking behaviour in `-p` mode was validated empirically. The internal mechanism (`permission_denials`) was observed — agents will have their ask denied and must continue without input.
- Guardian hook integration points are identified but not implemented. The `PAIRINGBUDDY_SOLO` env var approach is proposed, not tested.
- The halved cadence (2.5 min vs 5 min) for Solo mode is a design proposal based on reading the hook logic, not a validated requirement.
- All line numbers reflect the state of the files at spike time and may shift as files are edited.

## Unexplored Areas

- ~~What happens when `AskUserQuestion` is denied inside an agent that depends on the answer — does it gracefully skip or error out?~~ **RESOLVED:** Decision made to make agents Solo-aware rather than relying on denial behavior. See Architectural Pivot below.
- Guardian hook behaviour under `PAIRINGBUDDY_SOLO` with the halved interval was not tested end-to-end.
- The designing-ux and planning genuine-ambiguity stop-and-document flows were inventoried but not designed for Solo mode (out of scope for V1).
- Cost and turn budgets for typical Solo sessions were not modelled.

## Architectural Pivot (Post-Spike)

After the spike, the decision was made to **make agents Solo-aware** rather than relying on unpredictable `-p` mode AskUserQuestion denial behavior. The original plan said "agents are unaware of Solo mode" — this was revised to:

- 16 agents with AskUserQuestion get a small "Solo Mode" section: check `PAIRINGBUDDY_SOLO` env var, skip Step 3 Human Review, assume approval.
- Orchestrator changes are minimal: redefine `_ask_human()` to auto-yes. No duplicated pseudocode, no separate Solo branch.
- This is safer than hoping agents degrade gracefully when AskUserQuestion is denied.

## Consolidated Recommendations

1. Use `claude -p --dangerously-skip-permissions --output-format json "<prompt>"` as the minimum viable shell script invocation. Add `--max-turns` and `--max-budget-usd` as configurable safety caps.
2. Modify `hooks/guardian.mjs` to branch on `process.env.PAIRINGBUDDY_SOLO`: use Solo-specific reminder text and a 2.5-minute injection interval.
3. Redefine `_ask_human` in `skills/coding/SKILL.md` to auto-yes when `PAIRINGBUDDY_SOLO=true`. No workflow pseudocode changes.
4. Add Solo Mode section to all 16 agents with AskUserQuestion — check env var, skip Step 3, assume approval. Mechanical, templated change.
5. The designing-ux and planning orchestrators have genuine ambiguity calls — leave them out of V1 Solo Buddy scope.
