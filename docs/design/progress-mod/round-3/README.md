# Progress mod, round 3

Round 3 is built around five questions: where are we, how much did we spend, how much is left, are we going in circles, and is anything deviating. A one-row band is always visible and answers all five. `▸ pane` opens the wide pane, which is round 2's direction A with the five questions as its top section. Planning has frames of its own.

Markings: a **dotted magenta underline** is made up. A **dotted cyan underline** is borrowed from a real plan, `docs/plans/deterministic-workflows.md` (local, gitignored), and placed in an invented planning run. Everything else comes from the recording each caption names.

## Frames

| Image | What it shows |
|---|---|
| `R3-1-band-tdd-calm.png` | g-open-1 at 1:55, a 128-column terminal with no pane. `RED test 3/4 │ spent 1:55 · 12 agents · ≈0.4% │ left 1 test, 2 stages │ ↻ 0 ⚠ 0 │ needs you: no`, then `▸ pane`. |
| `R3-2-band-tdd-trouble.png` | probe-2 at 2:10, during RED r3. Circles lights up as amber `↻ RED ×3 · last try`, `⚠ 1` is shown, and "needs you" reads `soon`. |
| `R3-3-pane-tdd-calm.png` | g-open-1 at 1:55. An "at a glance" box (Where, Spent, Remaining, Circles, Deviating) sits above round 2's stages and focus block. |
| `R3-4-pane-tdd-circles.png` | probe-2 at 2:10. Circles shows the per-test strip `1 R●G●  2 R✗✗▸`, each try's exit code and the reason. Deviating has one finding. The status bar warns that one more pass stops the run. |
| `R3-5-band-planning.png` | `/pairingbuddy:plan` in brainstorm, with Q2 open in the chat. In planning, "needs you" is the normal state. |
| `R3-6-pane-planning-brainstorm.png` | Brainstorm. Shows the aim, the five questions, what is decided (2), the open questions with Q2 lit as being asked, and the stages still to come. |
| `R3-7-pane-planning-tracers.png` | 52 minutes in, plan-tracers running a lens round. 12 decisions folded to the latest 3, 1 open question, 14 tracers drafted (the 11 earliest folded), and one rollback shown under Circles. Only G:tracers and plan-sequence remain. |

## How the feedback maps to the design

- **Where, spent, remaining, circles, deviating.** They are the band's five segments and the five rows at the top of the pane, always in that order. The status bar and "needs you" stay as in round 2.
- **C as the default.** The band is the resting state. `▸ pane` opens the pane, and `− band only` in the pane goes back.
- **B's one useful idea, repeats.** It is now the Circles row: a strip per test with one pip per try (● passed, ✗ refused, ▸ running, ◌ covered). When a step repeats, the try history follows, with exit codes and the reason. Calm means `↻ 0` and "every step on its first try".
- **Being honest about spend.** Agent count and elapsed time are real. Tokens and "% of plan" have no source today, so they are marked made up. Remaining leans on real counters: step try 1 of 3, stage attempt 1 of 5, and rollbacks.
- **Planning keeps the slow-changing things visible:** the aim, decisions, open questions (the one being asked is lit), the current stage, and what is still to come, including tracers drafted so far. Long lists fold the same way as round 2's plan list.

## Made-up and borrowed values

- **TDD:** tokens, % of plan, test descriptions, the files touched in R3-3, and the whole Deviating row in R3-2 and R3-4. probe-2 edited no other test, so the deviation is staged to show the lit state.
- **Planning:** no planning run has been recorded, so all times, agent counts, question counts, Q4, the plan-architecture rollback and the lens progress are made up.
- **Borrowed from the real plan:** the aim, the decisions (R2, R15, the Sonnet default, the course checker with its 5-attempt cap, the integration branch), Q2 and Q3 (the real plan's human questions on lens cost and run state), the open question (follow-up R23), the tracer ids and names, the 30 requirements, and the stage and gate names (T8: plan-requirements, plan-architecture, plan-tracers, plan-sequence, G:requirements, G:architecture, G:tracers).

## Build findings

**Where.** All of it can be derived from what exists today: the step comes from the label, the test position from the order in `tests.json`, and the stage from `ledger.stage`.

**Spent.**
- Agents: the ledger's `spend.agents` only updates when a stage ends, so the mod counts `agent.spawn` events instead (as found in round 1).
- Elapsed time can be derived.
- Tokens: every recording has `tokensKnown: false`.
- "% of plan" needs per-spawn token counts and the plan's quota, and the mod can read neither today.

**Remaining.**
- "Step try n of 3" comes from the `r<n>` in the label, with the limit of 3 taken from probe-2 stopping after r3. `retries{}` stayed empty, so the ledger can't supply it.
- "Stage attempt n of 5" comes from `ledger.stage.attempt`. The cap of 5 is a T5 rule (R10), so it is only meaningful once lens fix loops exist.
- Rollbacks need T5's `fixes.rollbacks[]`, which no recording has yet.
- Tests and stages left come from `tests.json` and the stage order.

**Circles.**
- Count `implement-*` spawns per test and step.
- Do not count runner rounds: the GREEN runner is labelled `r2` on its first try in g-open-1, t52-nf-6 and probe-2.
- The exit code and "1 passed" for each try come from the runner's evidence (`tests.perTest.*.red.exitCodes`, plus the captured return).
- A repeated mistake (T5, Task 84a) and course-checker rollbacks would add to this row once they exist.

**Deviating.** Nothing records it today.
- Course-checker verdicts (`wrong-direction`, `broke-something`) arrive with T5, as `course-checker` labels and StructuredOutput.
- "Test edited after its GREEN" and "files outside the task's scope" need a diff between checkpoint shas (`ledger.checkpoints[].sha`). The mod would have to run git through `$.process`, or the CLI would have to record changed files on each checkpoint. The second is better, because the ledger is written only by deterministic code.
- Scope growth would compare against `scenarios.json` or the plan task text.

**Planning: what the workflow must write for the pane to read it.**
- Planning has no ledger or labels today. The agents write `plan-requirements.json`, `plan-architecture.json` and `plan-tracer-bullets.json` only at the end of each agent, after human review, and brainstorm questions live only in the chat.
- Needed:
  1. A plan-kind ledger (T8's `pb run open --kind plan`) with stage, attempt and gates.
  2. An append-only record of decisions and questions, each with an id, text, state (open, asking, answered) and answer, written by the main context as brainstorm goes.
  3. Drafted tracers written as they are produced, not only at stage end.
  4. The aim as one line in the run record.
- Without (2), "decided" and "open questions" can only be filled after `plan-requirements` (from `requirements[]`, `unknowns[]`) and `plan-architecture` (from `key_decisions[]`), not during brainstorm.

**The band's width.** The one-liner fits a 128-column terminal (115 characters plus `▸ pane` and the engine's `[-]`). Below about 120 columns, the labels "spent" and "left" should go first, then the % of plan.

## Re-rendering

`src/base.py` is round 2's generator, unchanged. `lib.py` adds the cyan "borrowed" underline. `mocks.py` is new. Run `python3 src/mocks.py <outdir> [name-filter]`.
