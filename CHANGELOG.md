# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New `pb plan next <plan.md> [--dry-run]` (parser in `shared-node/plan.mjs`) reads a plan and prints its next unchecked task with its unit and tracer. It refuses when the plan has format problems, naming each one. `--dry-run` lists the units, the next task and the problems and never refuses. Neither form writes anything yet.
- New conversational `curating-guidance` skill curates human guidance in the main context outside Solo and plan tasks; the `curate-guidance` agent stays for Solo and plan tasks.
- The `intake` stage runs `classify-task` under the one input rule with a confidence (new `classify-task-result.schema.json`) and comes first in every task path. `G:type` is now conditional: under `auto` it passes only when the classifier is certain, and it asks when a runner lacks `selector_template` (moved from `pb run open`).
- Intake (Task 92a) runs one Sonnet classification lens with no refuters. A finding re-runs `classify-task` with the note through the course-checked fix loop (artifact rollback, cap 5). `G:type` also asks while a blocking classification finding stands with no kept fix. The run's type follows the kept classification, and an artifact rollback at intake puts the kept type back.
- `pb run open` no longer reads `task-classification.json`; the tap writes `taskType` from the intake return. The prose path keeps its legacy file.
- New `pb spike setup` records the spike setup in `run/task/spike.json` after `G:type`, with the refusals `pb run open` had.
- The coding router no longer classifies before a non-Solo run; the branch type is the main session's guess.
- Spike runs on the new path (`spike` is in `migratedTypes`): `setting-up-spike` in main, `code-spike-unit` with a repeating `G:unit`, `code-spike-document`, then `G:task-end`. `pb task end` closes the unit kept-local, with no publish stage.
- The `code-spike-document` stage runs `document-spike` under the one input rule (new `document-spike-result.schema.json`), then one Sonnet claims-against-recorded-evidence lens with a brief and a course-checked artifact-mode fix loop capped at 5.
- `pb spike write` commits the standing write-up to `doc_path` as a `docs:` commit with the `spike-doc` checkpoint (`pb checkpoint` does not take `spike-doc`). `pb spike state` now prints the findings.
- Smoke S5 now also runs a spike task.
- The `setting-up-spike` skill guides `setup-spike`. `pb run open` records the spike setup in `run/task/spike.json` and refuses a spike whose setup is missing or malformed. `pb spike state` lists a spike's units and the next one to run. `pb checkpoint --step spike-unit` commits one explored unit.
- `explore-spike-unit` runs under the one input rule with a new `explore-spike-unit-result.schema.json`. The `code-spike-unit` stage explores one unit, and the spike graph repeats `G:unit` per unit. The spike graph lands ahead of its flip (spike is not yet in `migratedTypes`).
- Refactoring now runs on the new path (`refactoring` is in `migratedTypes`): scope, apply, then the safety net, whose lens row adds a refactoring lens (behaviour-preservation, at Opus). `G:task-end` follows the safety net.
- The `code-refactor-apply` stage applies the scope one step at a time, code issues then test issues. Each step is committed by `pb checkpoint --step refactor-step` only when the full suite is green, typed `refactor` or `test` by its paths and never `feat` or `fix`. `pb refactor state` lists the scope's issues as numbered steps.
- Smoke S5 (`tests/smoke/s5.mjs`) runs a refactoring task through scope, apply and the safety net.
- The `code-refactor-scope` stage runs the full suite first and stops with `tests-red` when it is not green, then `scope-refactoring` under the one input rule (new `scope-refactoring-result.schema.json`), then one `scope-serves-intent` lens with a brief, no refuters and no fix loop. `G:scope` follows and asks whenever a scope finding stands that is not marked non-blocking. The refactoring graph lands ahead of its flip (not yet in `migratedTypes`); the prose path through scope-refactoring keeps its flat files.
- `pb pr refresh` regenerates an open PR's title and body after review fixes are pushed. It reads the PR with `gh pr view`, opens a `refresh` run (no unit record; `run/refresh.json` and the old body stand in for it), runs pr-draft over the whole PR diff with the same lint, lenses and fix loop, and asks a human at `G:publish` even under auto. Approval runs `gh pr edit --title --body-file` and posts new coordination text as a comment; it pushes nothing and leaves labels and draft state alone. `pb run open` no longer takes that kind, `pb task end` refuses in a refresh run, and the D17 deny for `gh pr edit` now names `pb pr refresh`.
- PR drafts are held to Smart Brevity: the `draft-pull-request` agent, the `creating-pull-requests` skill and the permanence and claims lens briefs ask for short, plain bodies. `pb pr lint` adds a `word-count` cap (`body_max_words`, 250 words outside code blocks and tables) and an `ai-phrase` list (`ai_phrases`) of stock AI phrases, both overridable through `pr.lint`; a phrase that starts or ends with punctuation now matches.
- Smoke S4 now runs to a draft PR. Its sample carries a README the bug fix makes stale, and its test command runs behind the test-only `tests/smoke/force-red.mjs`, which fails the first safety-net fix's test run once, so the fix loop rolls that fix back. S4 checks the safety-net lens record on the ledger and in the unit's task record (names, models, counts only), a red rollback whose private ref held the saved work, `G:publish` passed with its binding, one `gh pr create --draft` on the recording shim into `develop` at the bound HEAD, no `refs/pairingbuddy/` on the remote or left behind, and that no lens finding's claim shows in a ledger, the unit record or the PR. A gate that asks is answered from S4's shell with `pb human approve`, at most four times, except `G:publish` asking for a lens record. `runClaude` takes a `timeoutMs`. Smoke S3 now expects `G:publish` to ask for a reason other than a missing lens record.
- The auto publish refusal is lifted. Under the `auto` gate policy `G:publish` passes by itself only when every task record in `run/unit.json` has a safety-net lens record and the PR lint passes at the body hash. The auto pass records the same binding a human approval does (HEAD, base, target, body hash, title hash, labels, coordination hash); `pb publish` accepts it only while that binding holds, voids a stale or unbound one like a human approval, re-checks the lens records and the lint at the body it sends, and opens the PR as a draft. Without lens records, or with a failing, stale or missing lint, or after a void, the gate still asks a human. The publish run's own ledger lenses no longer count. `pb status --action` names `pb publish` for a bound auto pass.
- The T5 spend re-measure (Task 84c), in `docs/spikes/workflow-platform-spike.md`: two live safety nets at the lens map's models on a real diff, $0.97 with no rollback and $2.14 with 4 rollbacks and 3 Opus checks, per-role costs, the first live `budget.spent()` figure through `pb stage finish`, a re-projected lens map whose worst `new_feature` task is $12.81, and S4 at about 1% of its $3 cap.
- A stage's `budget.spent()` figure now reaches `pb stage finish` without passing through a model. The stage script writes it as a `pb_spent_output_tokens` line in the finish runner's prompt, the tap records the Workflow run's `transcriptDir`, and `pb stage finish` reads that line back from the harness transcript (only the indented computed-task lines of the one runner agent that ran stage finish at this attempt). The ledger and `report.json` record it with `tokensKnown` true and `tokensUnit` "output tokens", `pb status` shows it, and the glance says "N output tokens". A stage with live returns, or any unknown attempt, reads unknown. The finishing runner, whose return lands after stage finish, now counts in agents.
- The pr-draft stage now runs the lint, then the `claims` and `permanence` lenses (Sonnet, no refuters), with a redraft loop. A failed lint spawns no lens: `draft-pull-request` redrafts the last good draft from the lint failures, and the lint alone judges each redraft. Once the lint passes, the lenses review the paths of the body, the draft, `unit.json` and the unit diff; a lens finding's redraft is linted and then course-checked. A failed lint or a bad verdict rolls the redraft back with `pb rollback --artifact` and retries with the stage's notes. The two loops share the cap of 5, the notes, the fix-key rounds and the agent budget; the cap stops the stage before `G:publish`. A lint relay that is not a readable verdict stops the stage as step-failed. The fix loop gained `fix.beforeKey`, `fix.lint`, `priorAttempts` and `priorLessons`, and returns the last kept artifact as `before`.
- A pr-draft redraft (a `fix` return from `draft-pull-request`) now stands as the draft: the tap writes its body to `run/pr-body.md`, and `pb pr lint`, gate eval and the publish binding read the newest standing draft (highest round of the attempt) for the title. `pb rollback --artifact` on pr-draft accepts a failed lint in place of a course-checker verdict, but only when `run/pr-lint.json` failed for that redraft's own body; the note lists the lint failures. It then puts the last good draft's body back in `run/pr-body.md`, read before anything moves, and refuses when no draft would be left.
- Repeated-mistake check in the fix loop: a mistake key (rule, file, mistake; `tests-red` for red tests) seen before in the stage sets `mustChangeApproach` and the retry carries a `<retry>` block with `rejected_approaches`; the fix returns `approach`, and a repeated normalized approach is refused by code before any checkpoint or checker, rolled back as the new kind `repeated` by `pb rollback` (decided from the fix artifacts of earlier rollbacks of the same stage and group) and counted toward the cap of 5. `refactor-code` and `refactor-tests` document the `<retry>` block.
- The fix loop of `lensAttack` (`workflows-src/shared/fix-loop.mjs`, with `relayed-json.mjs` and the fix notes parser `shared-node/fix-notes.mjs`), wired into the safety net and the scenarios stage. Safety net (commit mode): one fix agent per lens group (`refactor-code` or `refactor-tests`), then `pb checkpoint --step fix` runs the full suite and writes `.pairingbuddy/run/fix.diff`; red tests are rolled back with no checker call, otherwise the course checker judges the group, and a bad verdict runs `pb rollback` and retries with the notes. Scenarios (artifact mode): the enumerator revises the artifact, a bad verdict runs `pb rollback --artifact`, and the kept revision is handed on by `pb tdd state`. A stage holds at most 5 rolled-back attempts in the ledger (`maxAttempts` in `contracts/lenses.json`); `pb rollback` prints `note`, `failedAttempts`, `maxAttempts` and `stopped`, and at the cap records the `attempt-cap` stop and the stage report; if the CLI did not confirm, the stage records `stage stop attempt-cap` itself. Other refusals stop the stage with step-failed (no verdict, any other refusal, a refused rollback, a failed fix call). The loop checks the agent budget has room before each fix group. The report and `pb status` carry a `fixes` block `{attempts, rolledBack, maxAttempts, lessons}`, and the task record in `unit.json` keeps the lessons. The checker runs on Opus after the stage's first rollback.
- `pb rollback --from <fix key>` and `pb rollback --artifact --from <key>` (runner verbs) undo a rejected fix group and keep the work. Committed: the rejected commit plus any dirty group paths is kept under `refs/pairingbuddy/<branch>/rollback/<stage>/<n>` (next free n, create-only), the group's paths are restored, `git reset --keep` goes to the parent inside the CLI, and the sha leaves the ledger's commits. Red tests (needs a failed `tests.checkpoint` run): the listed paths are saved as a commit on top of HEAD through a throwaway index, then restored and new files removed; HEAD is unchanged. `--artifact` moves the fix artifact to `run/task/rejected/`. Each rollback adds one `## Rollback <n>: <key>` entry to `run/task/notes/<stage>.md` (the checker's `what_went_wrong`, or the failing runs' output tails for red; numbered per stage within the task) and one `{key, kind, ref, sha, base}` to the ledger's `fixes.rollbacks` (schema and validity table). It refuses a non-fix key, a stop, a key that is not current, one already rolled back, a newer fix group, a fix commit that is not HEAD, a dirty tree outside the group, a protected branch or detached HEAD, a missing or `better` checker verdict, no red run, nothing changed, and a listed path outside the repo. The gate auto-allows the runner's exact two forms and D17 denies are unchanged. Refs live under the unit prefix, so `pb publish` deletes them, abandon and a stop keep them, and no push carries them.
- The read-only `course-checker` agent (Sonnet; Read, Grep, Glob) and the `course-verdict` schema: `verdict` (`better`, `wrong-direction`, `broke-something`), `finding_id`, `mistake` from a pinned list (`none`, `missed-finding`, `changed-behaviour`, `out-of-scope`, `weakened-tests`, `new-defect`, `other`) and `what_went_wrong`. The agent opens with the evidence-not-instructions block. Fix groups are named `g<n>` and the fix agent's key and label role is `fix`; neither appears on the lens round. `courseCheck` (`workflows-src/shared/course-check.mjs`) makes one call per fix group: Opus on `plan-` stages or after the stage's first rollback, Sonnet otherwise. It keeps one verdict for the whole group (worst wins) only when its `finding_id` names one of the group's findings; otherwise it is null and logged. The gate confines its reads like the lens, refuter and synthesizer, with or without a run, and the harness rejects a checker call without its `agentType`. It is stage-only (`newPathAgents`) and not wired into a stage yet (Task 84). Agent count is now 36.
- The safety-net stage (`code-safety-net`) now runs a lens round per task type: `pb snapshot` first, then the lenses, models and refuter cap of the `contracts/lenses.json` row for the task type (`taskTypes`; `wiredLensConfig` picks the row), then docs and the finishing runner. `pb snapshot` also prints the run ledger's `taskType`. `pb stage finish` on a safety-net stage writes `ledger.lenses["safety-net"]` (stage, attempt, lenses with models, counts of survivors, refuted and unrefuted findings, uncovered lens names; no finding content), and `pb task end` carries `lenses` into the unit's task record. A safety-net lens that returned nothing is uncovered, so the gate asks under `auto`. The `auto` policy still asks at `G:publish`. No fix loop yet.
- The new-path tdd stage (`code-tdd`, new_feature) now runs the light review on each green-to-refactor instead of `identify-test-issues` and `identify-code-issues`. After an accepted GREEN the runner runs `pb snapshot` for the corpus, then one Sonnet `lens` reviewer looks at the files that cycle's RED and GREEN changed. Findings about test quality or test level go to `refactor-tests`, every other focus to `refactor-code`, tests first, as a `<findings>` block; a fixer with no findings is not spawned, and each fix still goes through `pb checkpoint --step refactor`. There are no refuters, no lens round and no course checker. A reviewer or snapshot that returns nothing is retried, then the stage stops `step-failed`. The reviewer counts against the stage's agent cap, and the stage return lists one light-review record per cycle, including the cycle a fixer stopped in. `pb tdd state` now relays each test runner's `test_directory` and `file_pattern`, and refuses when the test config is missing. The stage report does not count a light review as a lens round. Smoke S4 checks one reviewer per cycle on a new_feature run. The `identify-*` agents stay for the old prose path.
- Light review building block: a catalog of six review focuses in `contracts/lenses.json` (`lightReview`, checked by the lens-map contract) and a deterministic focus rule. Test files under a runner's `test_directory` that match its `file_pattern` select `test-quality`, every other changed file selects `code-smell`, in catalog order, at most two focuses. One Sonnet `lens` call per review may add or drop a focus, only with a stated reason; blank reasons, focuses outside the catalog and a third focus are rejected and the rule's focus stands, and findings outside the kept focuses are dropped. Zero focuses means no reviewer call and no findings; a failed reviewer goes to `uncovered`. The `light-review-result` schema is a second `lens` output. There is no triage agent, and the `identify-*` agents are unchanged for old callers. It is not yet wired into a stage.
- Read confinement for the `lens`, `refuter` and `synthesizer` agents: the gate lets them read only inside the run's repo toplevel (a linked worktree's own toplevel; the run is found through the session binding, else the folder's repo). Read `file_path`, Grep `path` (or the working folder) and Glob `path` plus its pattern root (braces, `~` and `..` resolved) are checked by their real path, so symlinks and `..` cannot escape. Session transcripts are outside and denied; an unknown toplevel denies. These agents may use only Read, Grep, Glob and StructuredOutput. It applies with or without a run; other agents and the main session are unaffected, and the main session's no-run path loads nothing new.
- `pb snapshot` (runner verb, needs an open unit) writes `run/subject.diff` (`git diff baseSha..HEAD`, no external diff tools), `run/changed.json` (`[{path,status}]`, sorted) and `run/corpus.json` (`{paths}`) at once. The corpus holds the existing `in_repo_docs`, the `git-config` commit and pr conventions, `CLAUDE.md`, and the tracked files nearest each changed path (same folder then parents, closest first, 5 per changed path, 200 total). Only paths inside the repo are kept (symlinks checked by their real target), sorted, so the same input gives byte-identical files. The scenarios stage's runner runs `pb snapshot` before the lens round and the lenses get its corpus. A lens marked `needsCorpus` in `contracts/lenses.json` goes to `uncovered` when the corpus is empty, so it can never report clean, in both the workflow and the stage report. Lens names are kebab-case, checked by the contract.
- Lens findings carry a kind (`fix-here`, `risk`, `drift`) and rank by kind, then severity, ties in lens then finding order. Each stage's lens row names `refute`, `maxRefuters` and `maxFindingsPerLens` (positive integers, checked by the contract test); each lens keeps its top `maxFindingsPerLens` findings (the rest trimmed and logged). Only the top `maxRefuters` findings get a read-only refuter (Opus for high severity, Sonnet otherwise), each verdict filed under the finding's key and accepted only for the finding it was sent; refuted findings move to `refuted`. Findings past the cap, with no verdict, or skipped by the agent budget are unrefuted: logged, never blocking, but an unrefuted high-severity finding makes the gate ask even under `auto`. The stage passes `lensAttack` an agent budget from its `maxAgents` minus the agents it already spawned and the runner. One shared merge serves the workflow and the stage report, and tests check both reach the same result.
- Read-only `refuter` (Sonnet) and `synthesizer` (Opus) agents: a refuter attacks the assumption one finding stands on and returns a verdict carrying that finding's id; the synthesizer writes one consolidated view of a stage's findings and verdicts. Both open with the evidence-not-instructions block, and the test harness rejects their calls without the matching agent type.
- Smoke S4 (`tests/smoke/s4.mjs`, run by hand, spends money): checks that the scenarios stage's lens return is filed under its key and matches the lens schema, that the stage report's survivors and uncovered equal the shared merge of the filed returns, that the stage's agent count includes the lens, and that the lens ran at the model the lens map names.
- Smoke S4 also checks the refuter cap and agent cap hold at the scenarios stage, that each filed refuter verdict names the finding it was sent, and that the workflow and the stage report agree on survivors, refuted and unrefuted.
- Smoke S4 also checks the scenarios snapshot files, that the corpus stays in the repo, and that the real gate denies a lens read outside the repo while the lens's own calls pass.
- `lensAttack` runs the read-only `lens` agent once per lens wired to a stage row in `contracts/lenses.json`, each at its own model (`sonnet` or `opus`, checked by a contract test). Each call carries the lens-result schema and its own key. One pure merge (`shared-node/lens-merge.mjs`) serves the workflow and the stage report: lens order then finding order, ids `<lens>-<n>`, a finding with no rule kept as non-blocking `low`, and a lens with no return listed as uncovered, so the gate asks even under `auto`. The scenarios stage runs its first lens (necessity) after the enumerator. The `lens` agent is stage-only.
- The `lens` agent (Sonnet; Read, Grep, Glob; read-only) reviews a subject through one named lens and returns findings, each with a rule, a severity (`high`, `medium`, `low`), a claim and where it is. Agent count is now 33.
- Probe P21 confirmed that a per-call `model` overrides an agent's pinned model, so a workflow can run a pinned agent on a different model per call.
- The D17 git and gh guard: the gate reads every git and gh call in a Bash command and denies it by run state and caller. The rules are a table plus a pure classifier in `shared-node/d17.mjs`.
  - A subagent during a run or unit gets a read-only git and gh allowlist (plus the table's single-file checkout, restore and switch forms and branch creation); everything else, plumbing included, is denied.
  - The main context during a run gets the table's denylist: push outside `pb publish`, `gh pr create/merge/edit/ready/revert/update-branch`, `gh repo sync --force`, `gh release create`, reverts (plumbing and stash forms too), hook-skipping commits, and creating, switching or rebasing onto another branch while a unit is open. Denials name `pb publish`.
  - A subagent with no run cannot push to a protected, unreadable or unresolvable target (including a short `heads/main` destination, a pattern, or a target picked by `-c`, `--config-env`, `GIT_CONFIG_*` or repo config), cannot force, delete or mirror, and cannot merge.
  - The main context with no run is unrestricted and loads nothing new.
  - The shell reader handles heredocs, `$'...'` strings, git global options, `gh -R` anywhere, and `cd`, `-C`, `--git-dir`, `GIT_DIR` and `GIT_WORK_TREE` targets. It re-reads the command given to `watch`, `script -c`, `su -c`, `flock -c`, `git rebase -x`, `git bisect run` and `git submodule foreach`.
  - Hooks read HEAD, config, `refs/remotes/origin/HEAD` and `git-config.json` as plain files (linked worktrees included; a reftable repo reads as unknown) and never call git. Write and Edit into a git directory are denied while run state exists. If the guard's modules fail to load, a subagent is denied every git or gh call not plainly read-only.
  - Accepted gaps (obfuscation, not accident): a built command word (`$(echo git) push`, `$g push`), `${IFS}` splitting, aliases and scripts that hide the call, and commits made without `git commit` (merge, cherry-pick, revert, am).
- `pb publish` posts the draft's coordination text as a PR comment once the PR is open, from `.pairingbuddy/pr-comments/<n>.md` (deleted on success), and records it in the unit so a retry doesn't repost. Null coordination posts nothing, and the text never goes in the body. A failed comment is a warning: the PR stands, the `PR:` line is written, the unit closes, the file is kept, and the output gives `pendingComment` plus the `gh` command to post it by hand.
- `pb publish` (main-class verb) publishes the unit's PR. `shared-node/publish.mjs` (`publishSteps`) plans the steps purely and the CLI executes them. A stop refuses. A unit with no commits past `baseSha` closes (skip) when no code task is open and config hashes are unchanged. With `pr.publish` none it closes the unit locally after the same fresh human approval and config check. Otherwise it checks every evidence item and reports all failures: a task record per unit task (plan boxes under the unit heading when a plan exists), safety-net finished, valid gate sources, the last task's full suite green at HEAD, a clean tree, no blocking findings, unchanged config hashes, no stop, a human `G:publish` approval bound to HEAD, body, title, labels, base and target, and every commit in the unit record. The branch must be checked out at HEAD, valid and not protected. It pushes exactly the approved SHA (never force, never merge) and opens the PR with `gh pr create` from a snapshot of the bound body (`--draft` when the ledger policy is auto, labels passed through). It records the PR url in the unit, writes `PR: <url> branch: <branch>` under the unit heading in the plan, deletes only this unit's `refs/pairingbuddy/<branch>/` refs in one transaction (never pushing them), and closes the unit. A retry adopts an existing PR only after `gh pr view` confirms head and base.
- The `draft-pull-request` agent (Sonnet) and the `creating-pull-requests` skill: stand-alone PR bodies written for main's log, with open-only notes going to a coordination comment.
- The `pr-draft` stage, wired into a new `publish` task-type graph.
- `G:publish`, a `continue` gate on the publish graph's `pr-draft` node. It shows title, body, lint, coordination comment, commits (flagging ones missing from the unit record), base, HEAD SHA and test command, and answers are publish, keep local or redo. A publish answer binds `headSha`, `bodyHash`, base and target, re-runs the lint, and is refused if HEAD moved since the question. A new commit or body edit voids the approval (moved to the ledger's `voidedGates` with the reason). Keep local closes the unit keeping commits, branch and refs; a unit with no commits past `baseSha` skips.
- The tap writes `.pairingbuddy/run/pr-body.md`.
- `pb pr lint` checks the PR draft's title and body with no model (title form and length, a size budget that grows with the diff, attribution trailers and tool footers, hype, file inventories, expiring text) against `contracts/pr-lint.json`, extended or overridden by git-config `pr.lint` (lists extend, numbers replace). It writes `run/pr-lint.json` with the body hash. The `pr-draft` stage now runs it after the writer, and a failure is recorded for the human at `G:publish` (the retry loop comes later).
- `pb git doctor` warns (never blocks; read-only `gh` calls with a 10s timeout) when squash merges don't use the PR title and body (`squash_merge_commit_title` and `squash_merge_commit_message` must be `PR_TITLE` and `PR_BODY`) or the default branch has no protection. It notes when `gh` is unavailable or protection can't be read. `pb unit open` shows the same warnings.
- `pb human abandon` (human-only) removes the unit and task state under `.pairingbuddy/run`. It keeps commits, the branch and the working tree, and works after a stop.
- `pb task end` refuses a `config_change` whose diff (no rename detection, from the unit's last task head or base) touches files outside the git-config `config_globs`. With empty `config_globs` it asks the human to type `pb human approve-config` (human-only, per task).
- Smoke S3 (`tests/smoke/s3.mjs`, run by hand, spends money): S2's bug task from main against a local bare remote and a recording gh shim. It asserts the unit record, the publish run stopping at G:publish under auto policy with no push, the PR lint result, a forced stop pushing nothing, and after a human approve, `pb publish` pushing the approved HEAD and opening a draft PR against the configured base, with the coordination comment when the draft has one.

### Changed

- The lens-attack diagram (`docs/diagrams/05-lens-attack`) shows the course-checked fix loop instead of re-auditing the fix diff: the fix agent takes one group at a time, the course checker keeps a better fix, a bad verdict rolls back and retries (cap 5 per stage), and a repeated mistake must change approach.
- The refuter verdict now carries `ambiguity`, like every other return.
- `/code` on the new path opens a unit first (`pb unit open --type feat|fix|refactor|chore --slug`). The model runs only the command a refusal prints for it, and the human confirms the branch otherwise. An open, empty unit on its branch is resumed.
- After `pb task end`, `/code` opens a publish run (`pb run open --kind publish`, refused unless every unit task has a record, no task run is open and no publish run exists) and follows `pb status --action` through `pr-draft` and `G:publish`. On approval or nothing to publish it runs `pb publish` and reports url, warnings and `pendingComment`.
- Keep local is finished by `pb publish` (result `kept-local`) if the tap's cleanup left anything.
- The ledger kind is `publish` if and only if the taskType is `publish`.
- `pb task end` refuses in a publish run. `pb publish` refuses outside a publish run and ends the publish run when it closes the unit.
- The `G:publish` binding now also covers the PR title, labels and coordination text (an edit voids the approval).
- `pb task end` records the full-suite result (`fullSuite`) so `pb publish` can check the last task's suite at HEAD.
- `pb task end` now records the unit's commits, so `G:publish` can flag commits not in the unit record.
- Failed, missing or stale PR lint asks under every policy, and a human approval records the failure. The `auto` policy asks until a safety-net lens record exists (T5c) and never auto-approves `G:publish` for now.
- Hooks no longer bootstrap `git-config.json` on the publish path.
- The `committing-changes` skill now carries the commit step table (RED test, covered RED test, GREEN `feat`/`fix`, REFACTOR `refactor` or `test`, docs/`chore`) and commits on green. It allows RED commits under squash; with `red_commits` false, for projects that don't squash, RED tests ride with the GREEN commit.

### Fixed

- The recovery drill starts its wedges at `intake`, now the first stage of every task path, and the `setting-up-spike` skill says it runs after G:type and that `pb spike setup` records the setup.
- The tap now files the spike write-up's fix returns (`code-spike-document` was missing from its fixer map), and a contract test holds every course-checked stage to an entry. `pb rollback --artifact` refuses cleanly when the artifact to set aside is missing.
- The `setting-up-spike` skill checks first whether a human can answer: with no AskUserQuestion tool, under `claude -p`, in auto mode or under Solo it writes the default setup and goes on, instead of stopping to ask in chat.
- A lens in a lens round now gets the run's task in a `<task>` block, marked as data, as context for what the subject is meant to do; it does not widen the lens. Before, the scenarios lens could not see which bug the task named and returned an open ambiguity, so `G:scenarios` asked a human. `agents/lens.md` lists the block for a lens review. The light review is unchanged. Live smoke S4 runs found it.
- The coding skill now says that an `auto-pass` at `G:publish` is the approval: run `pb publish` then, without holding it back for findings or asking the human first. A live S4 run's main session held the publish back on its own after the auto pass.
- A kept fix in an artifact-mode stage (scenarios, pr-draft) now counts in `fixes.attempts` in the stage report and `pb status`. Those fixes make no checkpoint, so only rolled-back ones were counted. A live S4 run found it.
- A fix that has nothing to change no longer stops the safety net. When two lenses report the same defect, the second fix group finds it already fixed; the fix agents were told to return empty lists and keep `ambiguity` for human questions, so `pb checkpoint --step fix` stopped the run for a silent no-op. `refactor-code` and `refactor-tests` now say in `ambiguity` why nothing changed, and the fix loop keeps such a fix without a course check, since no commit means `fix.diff` would be the previous group's. The reason reaches the human at G:task-end. A live safety-net run found it.
- `pb rollback` no longer crashes when the run has recorded no checkpoint yet. `checkpoints` is an optional ledger field, so the first rollback of a fresh run (a scenarios revision, or a red fix) failed with `Cannot read properties of undefined`, and the stage stopped as a failed step. A live S4 run found it.
- The tap now files fix-loop returns. A fix key's role is `fix` for every fixer, so the tap's check that the agent equals the key's role refused them all, and `pb checkpoint --step fix` and `pb rollback` found no artifact. Each stage now lists the fixers its workflow assigns (`refactor-code` and `refactor-tests` on the safety net, the scenario writer on scenarios); any other agent is still refused for a fix key.
- On a re-run of a stage that already rolled back fixes, the first course check now runs on Opus: `pb snapshot` prints the stage's rollback count from the ledger and the fix loop starts its count there.
- The gate now actually sees Read, Grep and Glob calls (they were missing from its hook matcher), so read confinement applies in real sessions; read tools skip the run-ledger checks.
- Each lens prompt now lists the corpus files to check against.
- The recovery drill's gate-throw anchor follows the gate again, and a fast test fails if a line a drill patches moves.
- `/pb` now answers and opens the pane.
- With no run, the pane invents no steps.
- The last run is kept after `pb task end` and shown as "last run finished", and the report button still works.
- Band segments are separated.
- The band shows a "/pb for details" hint, which gives way before content does.
- The band says "between steps · next: …" or "run open" instead of idle during a run.
- Tests come from the run's ledger, showing "test N" with no invented total, and LEFT stays unknown until the total is known.
- `/pb` and details open the pane with focus, so `r` open report works and Tab reaches suggest. The alert's pane doesn't steal focus.
- Theme-key colour: the current step is lit, ticks are success, needs-you is warning, stop is error, and unknowns and spend are dim.
- The report takes test results from the ledger, so a passed test no longer reads "not reached".
- The report shows run time from when the mod saw the run end, labels its STEPS columns, and reads "finished" on a done run.
- Band and NOW lead with needs-you while a gate waits.
- NOW drops the band prefix and reads "all steps done" before task end.
- The needs-you or stop status line clears when the gate is answered, the run ends, or a new run starts.
- The Workflow pluginRoot check compares real paths, so macOS `/var` and `/private/var` match.
- Pane focus lost on window switch is documented as platform behaviour, recovered with `/pb`.
- The report shows run time after the run ends. The poller passed an unawaited `$.clock.now()` promise to `new Date`, so the ended-at time was never saved; it now awaits the clock, and the ended pane and the report measure to the same end time.
- A signed-off run no longer asks for sign-off in the report's WHAT YOU CAN DO once `G:task-end` is approved.
- Test cards in the report have column headings and drop Total, Writing, Running and Commit columns that are unknown on every row.
- A not-reached test card draws no empty table, only the not-reached note.
- The report title keeps the break between the task description and its context.
- The needs-you or stop status line no longer repeats the plugin name.
- The report no longer asks for sign-off after an auto-passed task-end gate. It uses the same gate-passed rule as the CLI, now in `shared-node/gate-passed.mjs`, which `gates.mjs` re-exports.
- A report opened mid-run shows elapsed time like the pane. A snapshot of a gone run is not measured to now.
- The band stays one line at narrow widths: it fits beside the platform's `[-]` control, drops whole segments (lowest priority first, needs-you kept) instead of cutting them, and never wraps.
- The alert logs when the platform keeps its pane undrawn on a narrow terminal and never claims it opened; `/pb` or the details button still opens it.
- The report's STEPS shows the running step's start time instead of "not reached".
- The report follows the viewer's light or dark preference.
- The progress pane, band and HTML report no longer claim a known test total ('test 3 of 4', tests left) when they don't know the list is complete; the report also passes on whether the list is complete, which it used to drop.
- On a narrow band, a standing 'needs you' message is no longer cut shorter than the space allows.

### Added

- `pb unit open --type --slug [--branch <name>]` refuses a dirty tree, an open unit, and an existing, protected or invalid branch name. It fetches, branches from `pr.base_branch` or the remote default, and writes `.pairingbuddy/run/unit.json` (schema `contracts/schemas/unit.schema.json`). A plain call opens the template branch with no confirm step; `--branch` names another, and a passed `--yes` is refused as an unknown flag. The gate has no rule for it, since only a fresh unprotected branch can be created. `pb run open` on a protected branch now points at `pb unit open`, and `pb task end` appends the task record to `unit.json` (skipped when no unit is open).
- `.pairingbuddy/git-config.json` (D21), bootstrapped with defaults on the first `pb run open`, never overwritten, and refused when malformed. Protected branches come from the config plus the remote's default branch (the hard-coded `main`/`master` are removed), and `pr.base_branch` falls back to the default branch. Its hash is recorded in the ledger (`gitConfigHash`), and an edit mid-run stops the next gate check. Schema: `contracts/schemas/git-config.schema.json`.
- The pane's "now building" block (Task 61, new `shared-node/now-building.mjs`): a per-test progress row (`✓` made to pass, `◌` already passed, `▸` now, `·` to do) that folds to `✓ n done · ◌ m covered`, shows `+ n more` only when the total is known, and fits the width. Below it, the current test with its scenario description (fallback: its id), and a compact cycle marker with the step's age. A bug fix drops REFACTOR from the marker, by the rule the CLI shares through `REFACTOR_TASK_TYPES` in `shared-node/labels.mjs`. Under LOOPING it lists each try. It shows active agents (cleared on `turn.complete`) and unknown agents, and ends with a legend line. The smoke check S2 for this block is a paid check and has not been run.
- A dim rule above the band separates it from the transcript (`mod/band.tsx`).
- T4a first-pane smoke (Task 59): `tests/smoke/s2.mjs` takes `--plugin-dir`, so S2 can run against another plugin copy. New `tests/smoke/broken-plugin.mjs` (`makeBrokenCopy`, with `load` and `render` modes) builds a deliberately broken plugin copy. New `tests/smoke/t4a-lab.mjs` sets up the lab (`setup` with `--broken`, `--ask` and `--sound off`) and has `show`. New `tests/smoke/T4A-RUNBOOK.md` guides the human session. S2 passes healthy and with both broken copies; results are in `docs/design/progress-mod/t4a-smoke/README.md`
- Report button and suggestion input in the progress mod (Task 58a): the pane has a report button that writes `.pairingbuddy/reports/<timestamp>-<slug>.html` and opens it. The pane also has a suggestion input that appends a task-scoped entry (`task_scoped`) to `human-guidance.json`, which the next agent spawn reads; the pane shows the suggestion as pending, then delivered. A corrupt or unreadable guidance file is never overwritten, and the pane says "suggestion not saved". `curate-guidance` drops `task_scoped` entries, and `reports/` is kept across task cleanup. The mod's only writes are the reports folder and `human-guidance.json`. New `mod/report.ts`, `mod/suggest.ts`, `shared-node/report.mjs`, `shared-node/suggestion.mjs` and `shared-node/duration.mjs`
- Alerts on stop and needs-human (Task 58): when the run stops or needs a human, the mod plays a sound, sets the status line and opens the pane, once per event (tracked with `$.store`, keyed by run id, kind and event seq). The band reads `needs you · opened details`, and the needs-you segment survives narrow widths while an event stands. The `alertSound` userConfig in `plugin.json` controls the sound, and the bundled `mod/assets/alert.wav` is the default. `mod/alert.ts` holds the alert logic and `mod/pane-open.ts` opens the pane. A stop now carries a `stop.code` field in the ledger, drawn from `STOP_CODES` in the new `shared-node/stop-codes.mjs`, with a plain name for each code in `shared-node/plain-names.mjs`. `pb run open` writes a `runId` to the ledger so alerts can be keyed per run.
- Live pane on the ledger, labels and gates (Task 57): the band above the prompt shows where the run is, what it has spent, what is left, whether it is looping, whether it is off track and whether it needs you, with a `▸ details` button beside it. The button, or `/pb`, opens the pane. `esc` or `×` closes it. The pane shows five glance rows (NOW, SPENT, LEFT, LOOPING, OFF TRACK), the step list and a dim footer saying Pairing Buddy only watches. The mod (`mod/band.tsx`, `mod/pane.tsx`, `mod/view.ts`, `mod/inputs.ts`, `mod/poll.ts`) polls `ledger.json`, counts live agents from `agent.spawn` events and not from `spend.agents`, and reads the try count from `r<n>` in the labels. A label that fails the contract shows raw and counts as unknown. Tokens, % of plan and OFF TRACK show "unknown" until their data exists, and a missing or partial ledger never throws. At narrow widths the band drops `left:` first, then `≈ %`.
- `shared-node/plain-names.mjs` maps stage, role and gate ids to plain names, with a test that fails when an id has no plain name. New `shared-node/glance.mjs` builds the rows and band segments, `shared-node/limits.mjs` holds `MAX_TRIES`, and `shared-node/stage-graph.mjs` holds the graph functions moved out of `stages.mjs`, which re-exports them. `labels.mjs` now exports `PHASES` and `ROLES`. New node tests `tests/js/band-width.test.mjs`, `glance-sentences.test.mjs` and `plain-names.test.mjs`
- `closeStage` keeps `startedAt`. `scripts/build-workflows.mjs` generates `shared-node/stages-contract.mjs` from the stage contract, and `--check` reports drift in it. The replay rig in `mod/testing/` starts a session per replay, feeds the recorded spawns, and lands steps on whole poll intervals
- Mod skeleton and isolation (Task 56): `mod/register.tsx`, listed under `modules` in `hooks/hooks.json` next to the shell hooks. Every hook passes through with `next(e)`, with no `deny`. The mod is read-only: it may read `.pairingbuddy/` run files and never writes run state or the ledger. Its band, above the prompt, reads `.pairingbuddy/run/task/ledger.json` from the session root and shows "running" or "idle", and no ledger, however broken, makes it throw. A replay rig in `mod/testing/` plays a trimmed real recording (`mod/fixtures/replay/g-open-1`) and yields what the band draws at each step, for Tasks 57 and 61. `claude plugin test .` runs the mod tests (`mod/*.test.tsx`), and node tests check that the shell hooks still run with the mod broken
- Per-cycle refactor in `code-tdd`, for `new_feature` only (Task 48): after each GREEN, `identify-test-issues` finds and `refactor-tests` fixes, then `identify-code-issues` finds and `refactor-code` fixes. A finder with no issues spawns no fixer. Each fix group goes through `pb checkpoint --step refactor` with a `refactor-code` or `refactor-tests` key naming the cycle's test: the CLI runs every test the task has closed, each by its selector, and commits only if all pass, typed `refactor`, or `test` when every path is in a test directory. A group with no change makes no commit and runs no test. The CLI refuses the step for any other task type and before the cycle's GREEN, and `refactor-tests` may change tests alone. The gate's runner auto-allow takes exactly those two keys at that step. `pb tdd state` now prints the task type
- Coverage loop in `code-tdd`, for `new_feature` and `bug_fix` (Task 49): after the cycles, `verify-test-coverage` reports gaps, and each gap sends the stage back to `create-test-placeholders` with the coverage report, then cycles only the new tests, at most twice. Gaps left after that finish the stage, and `pb gate eval` asks under auto while the newest standing coverage return holds any. `artifact:verify-test-coverage` is new `code-tdd` evidence, and the stage report's `gaps` are the newest round's
- `identify-test-issues`, `identify-code-issues`, `refactor-tests`, `refactor-code` and `verify-test-coverage` follow the one input rule, with keyed returns. Legacy callers keep their flat files
- No agent a stage spawns asks a human when given paths (Task 50). `tests/js/paths-mode-no-ask.test.mjs` finds every agent the stages spawn and checks that each instruction to ask sits in a step skipped under paths or after a paths line saying not to ask, that AskUserQuestion appears only in the Human Review step, and that the legacy branch keeps that step whole, with its Solo Mode and flat files. `update-documentation` no longer asks or waits for review in Step 2 under paths
- `files_changed` measured at `pb task end` (Task 51): 0 leftovers in 61 runs that reached it, 33 `config_change` and 28 `bug_fix`, in `docs/spikes/workflow-platform-spike.md`
- `new_feature` runs on the new path (Task 52): it joins the migrated types in `contracts/stages.json` and the coding skill, on the same graph as `bug_fix`, with a `feat` GREEN and the per-cycle refactor. `pb run open` refuses it without a `selector_template`, as it does `bug_fix`. In the skill, each migrated type's old branch now says that only plan tasks and Solo reach it
- Smoke S2 `--type new_feature`: an `order_total` feature on a cart sample whose existing code gives the refactor something to fix. S2 now also asserts the task type, a `feat` GREEN for `new_feature`, at least one refactor commit typed `refactor` or `test` for `new_feature` and none for `bug_fix`, a green run of the closed tests at each refactor commit's parent, read from the recorder's ledger snapshots, and a coverage check after the last cycle. The recorder also saves what each `pb task end` printed, in `task-end.jsonl`
- `bug_fix` runs on the new path (Task 46): it joins the migrated types in `contracts/stages.json` and the coding skill. Its coverage check arrives with T2b
- `pb run open` refuses a task type with RED and GREEN when any runner in `test-config.json` has no `selector_template`, and names the fix. No template is guessed, because a wrong one can pass a test that never ran. A `config_change` needs none
- Smoke S2, `node tests/smoke/s2.mjs`: `/pairingbuddy:code` on a pytest sample repo, asserting stage order, the one placeholder commit, one RED and one GREEN commit per test, `tests{}` exit codes and gate sources. `tests/smoke/run-recorder.mjs`, test tooling only, saves spawn events, ledger snapshots and timing under `tests/smoke/recordings/` for the T4a replay rig
- `pb checkpoint --step placeholders|red|green` (Task 44): the key names the test and the row in the tests artifact supplies its selector, so no caller can choose what runs. RED needs a configured failure exit code on that one test, and GREEN needs exit 0 on it. The type is `test` at RED and `fix` or `feat` by task type at GREEN. Each test's run lands in `ledger.tests.perTest`, a refused one included, and the stage report carries its RED excerpt. RED may change only the test directory and cannot leave its test out, and GREEN cannot touch the test
- `selector_template` in `test-config.json`: the argument words that select one test, for example `["{test_file}::{test_function}"]`. RED and GREEN refuse a runner with none, because a run of a file cannot speak for one test in it. `pb test` uses it too, and records whether its result is per test or per file
- `test_function` accepts pytest's class path, `Class::test_name`. `::` means nothing else, and `pb` now checks both selector fields itself as well as the schema
- `code-tdd` stage (Task 45): placeholders, then for each test `implement-tests`, RED, `implement-code` and GREEN, one test at a time. A refusal goes back to a new agent at the next round, three tries per step. The script counts its spawns and stops at `stageMaxAgents` with `agent-budget`, and a re-run continues from `tests.perTest`. `pb tdd state` and `pb stage stop <reason>` are new runner verbs, auto-allowed only in their exact forms, and `tests:cycle` is new evidence that every test stands through RED and GREEN
- The `bug_fix` graph holds `code-scenarios`, `code-tdd` and `code-safety-net` with `G:scenarios` and `G:task-end`
- A test covered by an earlier GREEN (D16): when a test passes at its RED after at least one GREEN of the same task, `pb checkpoint --step red` keeps it, commits it as `test`, records it in `tests.perTest` as `covered` with its exit-0 run and the earliest GREEN before it, and prints `outcome: "covered"`. `code-tdd` then skips its GREEN, `pb checkpoint --step green` refuses it, `pb tdd state` lists it under `covered`, and `tests:cycle` counts it as closed. The stage report and `pb status` list it under `covered`, so the human sees a test that never failed. A test that passes before any GREEN is still refused at RED, as one that proves nothing. S2 accepts one `test` commit for such a test, and an open-scope `--task` is how a run meets one
- `pb checkpoint --step placeholders` refuses a tests row whose `test_function` is already in its `test_file` at the commit before the task's first placeholders, and names it. Such a test passes at its first RED, so RED could only refuse it later and stop the stage. The refusal is not a stop: `code-tdd` hands it to a new placeholders agent as it does any other. The checkpoint records that commit as `base`, so a re-run does not find its own placeholders there. `create-test-placeholders` lists only the tests it creates, never one already in the repo
- An `implement-tests` return's ambiguity no longer stops a gate once that return's test is `covered` in `tests.perTest`: the CLI already decided to keep it. Any other ambiguity still asks. `implement-tests` is told, in the paths mode, that a pass after an earlier GREEN is the CLI's call and not a question
- `code-scenarios` stage and `G:scenarios` (Task 42): the stage calls `enumerate-scenarios-and-test-cases` under the one input rule, with `pb_key`, `ambiguity` and the scenarios in the return, then ends with the runner's `pb stage finish`. `stages.json` holds the bug_fix graph and a new `migratedTypes` list, so a graph can land ahead of its flip: `pb run open` opens only migrated types, and bug_fix stays on the old path until Task 46. A non-empty `ambiguity` makes `pb gate eval` ask under auto
- A redo at a gate appends the human's note from the dialog to `human-guidance.json`, or a line saying the attempt was sent back when there is none, and the stage re-runs at the next attempt
- `create-test-placeholders`, `implement-tests` and `implement-code` follow the one input rule (Task 43): a `<paths>` block means no human review and a StructuredOutput return with `pb_key`, `ambiguity`, `commit_subject` and `files_changed`, and no block means the legacy files. The tests artifact holds one structured selector per row, with `test_id`, `test_file` and `test_function` constrained by schema
- Label contract reviewed against every D8 lens-map row (Tasks 40, 41): a refuter's `item` and `pb_key` carry the finding id it attacks, `contracts/schemas/refuter-verdict.schema.json` carries it too, and `readLabel` reports a label failing the regex as unknown. Label parts now follow the key's token rule, and a course checker cannot take the lens round.
- With no run state, `hooks/gate.mjs` denies a Workflow call naming a stage, or carrying a built-bundle copy, and points at `/pairingbuddy:code`, which opens the run. The stage names come from `contracts/stages.json`, read for Workflow calls only, and every other call stays silently allowed. If the contract or its loader fails, `pairingbuddy:` names are denied. Stage `meta` descriptions now say they are internal, and `commands/plan.md` and `commands/design-ux.md` name their skills in full
- Smoke S1 now runs `/pairingbuddy:code <task>` in one `claude -p` session on a branch made from main, and also asserts that run state is gone and, with no model, that out-of-order calls are denied. Per-run results are in `docs/spikes/workflow-platform-spike.md`
- Stop hook `hooks/stop.mjs` (D13): in every mode, with no stage running, it tells the model the next action through the block form probe P5 recorded. A stop, or a stage with no recorded run past its start lease, counts as not running, and the text gives the real remedy and the task stored in the ledger. It speaks only to the session that owns the run, or to any session while the run has no owner, and stays silent under Solo. One action is told once per session, with a notice per session, and a chain of changing actions has a ceiling, so a turn cannot loop. SessionStart reports open run state, the compact hook injects `pb status` and the next action in place of the guardian reminder, the guardian reminder is reworded while run state exists, and `pb run open` names the stop when it refuses the next task.
- Migrated-types router in `skills/coding/SKILL.md` (Section 7): `/pairingbuddy:code` sends a `config_change` to the workflow stages, and every other type, plan task and Solo run stays on the old path with no run state. `pb run open` takes `taskType` from `.pairingbuddy/task-classification.json`, and refuses a type with no stage graph, a malformed file, and Solo. `commands/code.md` passes the plugin root and the human's text as data, with no `allowed-tools`
- Recovery drill in `tests/drills/`: `force_wedge.mjs` forces each wedged run on demand, one flag per wedge, on a throwaway clone it made itself, and refuses this worktree or any other repo. `CONTRIBUTING.md` gains the recovery recipe, one section per wedge, and `tests/drills/test_wedges.py` runs each recipe's commands against its forced wedge
- Smoke S1 in `tests/smoke/`: a sample repo and a capped `claude -p --plugin-dir` runner on a cheap model with a clean env, asserting stage order, one commit, the gate source and a refused `pb stage finish`, outside pytest and `pb test --full`. The sample-task spike is recorded in `docs/spikes/workflow-platform-spike.md`
- `code-safety-net` stage (Section 4), lens-free for now: `update-documentation`, then the runner running `pb checkpoint --step docs`, `pb test --full` and `pb stage finish`. `code-config` now also ends with the runner, and the runner takes a list of commands. `stages.json` requires `checkpoint:docs`, which a no-change docs step satisfies
- `pb task end` (D12, D16): refuses an unfinished stage, a stop, an unpassed gate or a dirty tree, in that order and with the remaining files listed, ticks the plan box by title when the run has a plan, and removes `run/task/` alone. `shared-node/plan-boxes.mjs` holds the only checkbox writer
- `update-documentation` follows the one input rule: a `<paths>` block in the prompt means no human review and a StructuredOutput return with `pb_key`, `commit_subject` and `files_changed`, and no block means the legacy files
- `pb checkpoint --step config|docs --from <key>` (D16), in `shared-node/checkpoint.mjs`: granular commits with the type fixed by the step, and subject and paths read from the current stage's artifact. It stages only the listed paths, refuses `.pairingbuddy/`, paths outside the repo, symlinks out and protected branches, runs the full suite first, adds no trailer, and appends each commit to `ledger.commits`. A hook that changes files gets one retry, and a second failure or a signing failure sets `ledger.stop`. The gate auto-allows the runner's exact form
- `pb gate eval` with the gate policy (D4, D13): `hooks/gate.mjs` records `permission_mode`, or Solo's `PAIRINGBUDDY_GATE_POLICY=auto`, into the ledger when it changes, `continue` gates pass under `auto` with `source: auto`, and every other mode and each always-stop condition asks with the `PB gate: <name>` question. `hooks/tap.mjs` records the human's answer, a second eval with no answer prints the `!` command, stage order refuses a gate without an approval, and an `AskUserQuestion` carrying its own answers is denied. Rules live in `shared-node/gates.mjs`
- T0 platform probes in `tests/probes/`: a re-runnable harness, fixture plugin and captured hook payload fixtures, with results recorded in `docs/spikes/workflow-platform-spike.md`
- Runbooks and fixtures for the T0 human probes in `tests/probes/human/`
- Workflow bundler `scripts/build-workflows.mjs`: bundles stage modules from `workflows-src/` into `workflows/`, with a `--check` mode that fails on drift between committed output and source
- Workflow control-flow harness `tests/js/harness.mjs`, run through `tests/test_js_suite.py` under `uv run pytest`
- Run ledger with stage keys and workflow labels, and the `pb run open` command to open a run
- Tap hook `hooks/tap.mjs`: captures agent returns into run state, and does nothing outside a run
- Added the `apply-config-change` agent and the direct `code-config` workflow stage (`workflows-src/stages/code-config.mjs`, built to `workflows/code-config.js`). The bundler inlines shared-node modules via `// pb-inline-module PATH`.
- Gate hook `hooks/gate.mjs` with the stage graph `contracts/stages.json`: during a run it enforces stage order, one active stage, `attempt`, `pluginRoot` and the built bundle, and denies a main-context `Agent` call for a pipeline agent. A stage must be called as `pairingbuddy:<stage>`, a stage with no built bundle or a `scriptPath` the hook cannot read is denied, and an active stage with no recorded `runId` can be restarted at the same attempt once its 120-second start lease, counted from the new ledger field `stage.startedAt`, has expired
- Gate hook fails closed: during a run it denies `Write`, `Edit` and `NotebookEdit` on `.pairingbuddy/run/**`, `test-config.json` and `git-config.json`, denies plan checkbox changes, and denies on any hook error and on platform drift in the payload. It finds run state by walking up from the cwd and the target path, with no git call, and its rules moved to `shared-node/gate-rules.mjs`. An empty `.pairingbuddy/run/` no longer stops that walk, and `hooks/tap.mjs` now uses the same `shared-node/run-root.mjs` walk instead of `git rev-parse`, so a git repo nested inside a run reaches the run
- CLI verb table `shared-node/verbs.mjs`, used by `cli/pb.mjs` and the gate. The gate now covers `Bash`: during a run it denies `pb human` in any command text, denies a verb from the wrong caller class, and auto-allows the runner's exact CLI command
- `pb human approve <gate>` and `pb human accept`, reachable only by a human `!`. `approve` passes the due or pending gate with `source: human-cli`, and refuses a ledger with a SHA mismatch, pointing to `accept`. `accept` re-signs a hand-edited ledger that is otherwise well-formed and records it in the new optional ledger field `acceptances`
- Run binding: the gate claims `ledger.owner` for the first main-context session it sees in a run, and writes a session pointer under `<os.tmpdir()>/pairingbuddy-sessions/`. `gate.mjs` and `tap.mjs` read it when the walk from the cwd finds nothing, so every rule holds after `cd /tmp`. The printed `!` commands start with `cd <run root> &&`
- Gate answers take effect: `redo` clears the gate record and the stage's done state so the stage restarts at the next attempt, `stop` sets `ledger.stop`, and `pb human approve` also passes a gate answered either way, clearing the stop
- `pb test` and `pb test --full`, with the `runner` agent that calls them (D5, R3). The human-owned command is split into words and spawned with no shell, and the CLI records exit code, signal, timeout and a bounded excerpt in `ledger.tests`. `--full` runs every configured runner, and plain `pb test` takes its test files from the current attempt's tests artifact. RED counts only for the new optional runner field `failure_exit_codes`, default `[1]`. The new optional `timeout_seconds`, default 540, kills the whole process group. A changed config hash refuses
- `pb stage finish`, `pb stage report`, `pb stage fail`, `pb artifact check` and `pb status` (D3, D9), in `shared-node/stage-run.mjs`. `stage finish` takes no arguments, reads the stage from the ledger, refuses unless the `contracts/stages.json` evidence (`artifact:<role>`, `checkpoint:<step>`, `tests:<run>`, now validated) is present at this attempt and the stage has a recorded run, leaves a stop when it is not, and writes `report.json` stamped with the attempt, stating what ran and what was not covered. `stage fail` closes the active stage for a restart at attempt+1 and clears a stop the run raised, never a human's. Returns and reports of a voided attempt no longer count in evidence or gates, and the tap drops late returns to a failed attempt. `pb checkpoint` records each step, a no-change step included, in the new optional ledger field `checkpoints`. `status` prints stage and task spend against the new contract field `maxAgents`: agents from recorded returns, and output tokens as 0 and unknown until a stage can supply `budget.spent()`

### Changed

- An ambiguity a human approved at a gate no longer asks again at a later gate. Approving a gate settles the returns of its stage and every stage before it, an auto pass settles nothing, and a gate now names every open return, since approving it settles them all
- `commands/code.md` names `pairingbuddy:coding` and its path, and warns off itself and the stages, because "the coding skill" sent every S1 session to the command itself
- `curate_guidance` asks nothing under the auto policy or `claude -p`: it carries the guidance over silently, and the gate denies its question under the auto policy, so it no longer ends a headless run before a run opens
- With no run the gate also denies a direct Agent call for an agent listed in `newPathAgents` in `contracts/stages.json`, a bundle copy differing only in trailing whitespace, and a script naming a stage or one of those agents literally
- `/pairingbuddy:code` with a run already open reports the run's next action and touches nothing, and `pb status --action` gives that action. Under Solo the gate denies a stage start
- `pb run open` stores the task from `.pairingbuddy/task.json` in the ledger, and the gate refuses a `<this task>`-style placeholder as `args.task`
- The run reminder reaches the main context only, not a stage's agents
- The gate denies a stage start with no `task`, where the stage used to refuse inside the workflow and strand itself active. `pluginRoot` was already denied
- `hooks/gate-boot.mjs` is now the registered PreToolUse command. It imports `gate.mjs` dynamically, so a syntax error there denies during a run and names the recovery, instead of failing open. A syntax error in `gate-boot.mjs` itself still fails open. `force_wedge.mjs` gains `--gate-boot-parse`, and `--gate-parse` now denies
- `pb checkpoint --step config` takes no change only from a return with an empty `files_changed` and a non-empty `ambiguity`, which the task-end gate then asks about. A return listing a file that did not change, an empty one with no ambiguity, or no return at all refuses and stops the run, so a refused edit can no longer leave `code-config` done. A no-change docs step stays valid
- The active-stage deny says that a stranded stage is cleared by the human running `pb stage fail`
- The `pb takes literal words` rule reads the shell structure: a bare `pb` counts only in command position or after a known wrapper, and a whole `pb.mjs` counts anywhere except as a quoted argument of a text command, so a word or pattern that merely mentions pb stays untouched
- `pb checkpoint` re-checks the key against the ledger after the tests and under the lock when recording, and stamps a record from its key. A checkpoint orphaned by `pb stage fail` is refused, commits nothing and raises no stop. After the tests it also re-checks the branch, HEAD and the staged paths, and any difference stops the run with nothing committed. The branch is read at the run root, not the cwd, and a listed directory that is gone is refused
- `pb stage fail` clears a run-raised stop in any stage state, and a human's `stop` stays refused
- `pb run open` validates `test-config.json` before hashing it, and `pb human accept` also takes a changed `test-config.json`, re-pinning `configHash` and recording old and new in `ledger.configAcceptances`
- During a run the gate denies any `pb` call under an assignment or the `env` command, and counts a `pb` name followed by a known verb in any position of a simple command, apart from the arguments of text commands such as `grep`, so `env -u`, `node -r`, `find -exec` and `coproc` forms are invocations
- The tap files a return only from the agent its key names, `pairingbuddy:<role>`
- `pb test` takes a selector only from under the runner's `test_directory`, and refuses a leading `-` or `@`
- `pb test` records the HEAD it ran from. `pb stage finish` and `pb task end` refuse once HEAD has moved past a green full run, and `pb task end` refuses a recorded commit that left HEAD's history. `.pairingbuddy/` no longer counts as dirty in `pb task end`
- Runner commands quote the plugin path, and the gate's auto-allow matches the quoted form
- `update-documentation` returns `ambiguity`, which the task-end gate reads as it does for `apply-config-change`
- A gate question must equal the question `pb gate eval` emitted, alone in its call, at PreToolUse and in the tap. Plan checkboxes compare by task title. `pb gate eval` through the gate denies when the policy cannot be recorded. A SHA mismatch names the `!... human accept` command from the CLI and from hook denies. During a run, `Write`, `Edit` and `NotebookEdit` are denied on `.claude/settings.json` and `.claude/settings.local.json`, and any `pb` or `pb.mjs` text with a shell expansion or glob after the name, an `xargs` feeding `pb` or `pb.mjs`, or another letter case of `pb.mjs`, is denied. A lock file with a future mtime counts as stale

### Changed

- The mod's test list uses `tests.json` when it lists every test the ledger has seen; otherwise it keeps the ledger's tests.
- The coding skill's old path stops when a unit is open (`.pairingbuddy/run/unit.json`) and tells the human to finish it on the new path or run `pb human abandon`.

## [0.7.0] - 2026-07-31

### Added

- Solo Buddy: autonomous execution mode via `scripts/solo-buddy.sh`
  - Shell script entry point with `claude -p`, env var signal, API key safety (unsets `ANTHROPIC_API_KEY` by default)
  - Guardian hook Solo mode: halved injection cadence (2 min), Solo constraint prompt on SessionStart
  - 15 agents with Solo Mode section: skip Step 3 Human Review when `PAIRINGBUDDY_SOLO=true`
  - Coding orchestrator Solo mode: `_ask_human` auto-yes, strict scope, sequential execution, resource exhaustion before stopping, bug handling, quality compliance
  - `SOLO_BUDDY_REPORT.md` incremental report generation with session resumability
  - Push-to-remote and GitHub PR creation on success via `gh pr create`
- Solo Buddy observability
  - Live terminal renderer: styled progress bar, task list (✓/→/○), spinner on active task, colored agent names
  - Guardian-based agent tracking: guardian writes `lastAgent`/`lastTool`/`lastDescription` to session file on every tool call
  - Renderer reads source files directly (plan MD, task.json, guardian session file) — independent of hook reliability
  - `hooks/solo-progress.mjs`: append-only progress log for post-session analysis
  - Current test file surfaced in `solo-status` and the progress log, read from `current-batch.json` with `tests.json` as fallback
  - Final 100% status display on completion with PR/report links
- `caffeinate -s` sleep prevention for macOS (prevents App Nap/system sleep during unattended runs)
- Report reconciliation on resume: preserves entries from previous sessions, drops stale entries for tasks removed from plan, maintains correct ordering
- Branch guard: refuses to push/create PR on main/master

### Changed

- `committing-changes` skill: added "What Not to Include" section covering no AI co-author trailers, no auto-formatting noise, and no "tests pass" notes (only call out skipped/failing tests)

### Fixed

- `hooks/solo-progress.mjs`: exits cleanly when `.pairingbuddy/` directory is absent
- `solo-buddy.sh`: `stop_caffeinate` runs first in cleanup to prevent orphan processes
- `solo-buddy.sh`: `require_positive_number` rejects all zero representations
- `solo-buddy.sh`: push branch before `gh pr create` to avoid interactive prompt in headless mode
- Output format set to `json` — `text` format causes early session termination

## [0.6.0] - 2026-03-15

### Added

- Session drift guardian: time-based `PostToolUse` hook that re-injects workflow compliance reminders every 5 minutes of activity, plus always after context compaction (`SessionStart:compact`), to prevent the session agent from skipping steps, avoiding subagents, or doing agent work in the main context
- `/pairingbuddy:plan` command for tracer bullet planning workflow
  - Planning orchestrator skill with adaptive brainstorming, architecture management, tracer bullet decomposition, and task sequencing
  - Four planning agents:
    - brainstorm-requirements: adaptive Socratic exploration of requirements
    - solidify-architecture: analyze/create/update architecture documents
    - decompose-tracer-bullets: decompose into thin end-to-end tracer bullet slices
    - sequence-tasks: sequence tasks within TBs and write plan markdown document
  - Two new reference skills:
    - decomposing-tracer-bullets: tracer bullet methodology and thin E2E slicing patterns
    - sequencing-tasks: task sequencing for TDD-ready plans
  - Four new JSON schemas: plan-config, plan-requirements, plan-architecture, plan-tracer-bullets
  - Plan state isolated in `.pairingbuddy/plan/` (not affected by `/code` cleanup)
  - Plan resumability: detect existing plan, offer resume/re-plan/start fresh
- `/code` plan execution mode
  - Detects plan MD files and iterates through unchecked tasks
  - Claude Code Task visibility for in-session progress tracking
  - Automatic MD checkbox updates on task completion (`- [ ]` → `- [x]`)
  - Cross-session recovery via MD checkboxes (source of truth)
  - Human checkpoint between tasks

### Changed

- Convert all hooks from bash to Node.js for cross-platform compatibility
- Update using-pairingbuddy skill to reflect current architecture: three commands (/code, /plan, /design-ux), agent-based workflows, and commit step enforcement

### Fixed

- Agent output file reliability: agents with human review sometimes completed without writing output JSON files
  - Strengthened `workflow_step4_output` canonical block with mandatory verification step (read-back confirmation)
  - Removed 9 vague agent-specific one-liners ("After approval, write to X") that LLM agents misinterpreted as summaries
  - Affected agents: enumerate-scenarios-and-test-cases, identify-test-issues, identify-code-issues, brainstorm-requirements, solidify-architecture, decompose-tracer-bullets, scope-refactoring, verify-test-coverage, setup-spike
- Spike findings overwrite bug in explore-spike-unit agent: replaced vague append instruction with explicit read-modify-write steps to prevent losing previous units' findings

### Changed

- Agent count increased from 25 to 29
- Schema count increased from 35 to 39
- Skill count increased from 14 to 17 (3 orchestrators, 1 entry, 13 reference)
- Test count increased from ~881 to ~1037
- Added soft wrapping markdown formatting guideline to document-spike agent

## [0.5.0] - 2026-02-20

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
