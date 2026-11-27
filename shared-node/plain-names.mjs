// Plain-language names for the ids the UI would otherwise show. The UI shows these, never the ids.
const PLAIN_NAMES = {
  // stages
  intake: "work out the task type",
  "code-config": "make the config change",
  "code-scenarios": "write test scenarios",
  "code-tdd": "build test by test",
  "code-safety-net": "safety-net review",
  "code-refactor-scope": "decide what to tidy up",
  "code-refactor-apply": "tidy up step by step",
  "pr-draft": "write the pull request",
  "code-spike-unit": "try one experiment",
  "code-spike-document": "write up the findings",
  // gates
  "G:type": "your OK on the task type",
  "G:scenarios": "your OK on the scenarios",
  "G:task-end": "your sign-off at the end",
  "G:publish": "your OK to publish",
  "G:scope": "your OK on what to tidy up",
  "G:unit": "your OK on this experiment",
  // the wait a changed test-config raises (shared-node/config-wait.mjs)
  "config-changed": "the test settings changed: check and accept them",
  "config-approval": "your OK on the config change",
  // agents
  "apply-config-change": "changing the config",
  "runner": "running the checks",
  "lens": "reviewing through one lens",
  "curate-guidance": "sorting your guidance",
  "classify-task": "sizing up the task",
  "enumerate-scenarios-and-test-cases": "listing scenarios",
  "create-test-placeholders": "sketching the tests",
  "implement-tests": "writing a failing test",
  "implement-code": "making the test pass",
  "identify-test-issues": "reviewing the tests",
  "refactor-tests": "tidying the tests",
  "identify-code-issues": "reviewing the code",
  "refactor-code": "tidying the code",
  "verify-test-coverage": "checking coverage",
  "run-all-tests": "running every test",
  "update-documentation": "updating the docs",
  "commit-changes": "committing the changes",
  "draft-pull-request": "drafting the pull request",
  "scope-refactoring": "scoping the cleanup",
  "setup-spike": "setting up the experiment",
  "explore-spike-unit": "trying an experiment",
  "document-spike": "writing up the findings",
  "brainstorm-requirements": "working out the requirements",
  "solidify-architecture": "settling the architecture",
  "decompose-tracer-bullets": "cutting the plan into slices",
  "sequence-tasks": "writing the task list",
  "design-ux-architect": "choosing the design",
  "design-ux-token-generator": "generating the design tokens",
  "design-ux-visual-builder": "building the preview",
  "design-ux-critic": "critiquing the design",
  "design-ux-explorer": "exploring the design",
  "design-ux-validator": "validating the design",
  "design-ux-gallery-generator": "building the gallery",
  // stop codes
  "missing-artifact": "a step didn't write its file",
  "commit-plan-unusable": "the commit plan was unusable",
  "commit-failed": "the commit failed",
  "no-selector-template": "can't run one test on its own",
  "human-stopped": "you asked it to stop",
  "attempt-cap": "it ran out of fix attempts",
  "agent-budget": "the agent budget ran out",
  "step-failed": "a step kept failing",
  "red-passes": "a test passed before any code",
  "tests-red": "the tests were not green",
  "gate-off": "safety checks are off",
  // task types
  "config_change": "config change",
  "bug_fix": "bug fix",
  "new_feature": "new feature",
  "refactoring": "refactoring",
  "spike": "spike",
  // phases keep their own names
  "RED": "RED",
  "GREEN": "GREEN",
  "REFACTOR": "REFACTOR",
  // roles
  "refuter": "attacking a finding",
  "synthesizer": "consolidating the findings",
  "course-checker": "checking the course",
  "fix": "fixing a finding",
  // lenses
  "classification": "the task type",
  "code": "the code",
  "tests": "the tests",
  "corpus-misalignment": "docs and plan",
  "necessity": "needed or not",
  "pyramid-level": "test level",
  "patterns": "good patterns",
  "anti-patterns": "bad patterns",
  "claims": "what it claims",
  "permanence": "how long it lasts",
  "behaviour-preservation": "same behaviour",
  "existing-behaviour": "existing code kept",
  "config-fit": "fit with the config",
  "scope-serves-intent": "scope fits the goal",
  "claims-against-recorded-evidence": "claims checked against evidence",
  // the one lens of a cycle's light review
  "light-review": "quick review",
};

export function plainName(id) {
  return Object.hasOwn(PLAIN_NAMES, id) ? PLAIN_NAMES[id] : undefined;
}

// Text the CLI wrote about "the human", told to the person reading it as "you": pb status at a terminal and the gate
// question's why line. Text only the model reads keeps "the human", so the model never takes "you" as itself.
const SECOND_PERSON = { has: "have", is: "are", was: "were", does: "do" };
const youVerb = (verb) => SECOND_PERSON[verb] ?? verb.replace(/s$/, "");
const THIRD_PERSON_VERBS = /\b([Tt])he human (has|is|was|does|types|approves|owns|answers|abandons|starts|runs|adds|checks)\b/g;

export function forYou(text) {
  return String(text)
    .replace(THIRD_PERSON_VERBS, (_, t, verb) => `${t === "T" ? "Y" : "y"}ou ${youVerb(verb)}`)
    .replace(/\b([Tt])he human's\b/g, (_, t) => (t === "T" ? "Your" : "your"))
    .replace(/\b([Tt])he human\b/g, (_, t) => (t === "T" ? "You" : "you"));
}

// Which run of a stage this is, from its ledger attempt: every start of its workflow counts, restarts after a crash or a
// stop included. Told as "run N", never "attempt", so it is not taken for a fix attempt, which is told as a fix.
export function stageRun(attempt) {
  const restarts = attempt - 1;
  if (!Number.isInteger(restarts) || restarts < 1) return `run ${attempt}`;
  return `run ${attempt} (restarted ${restarts === 1 ? "once" : `${restarts} times`})`;
}

// A stage's fixes: how many were tried, kept or undone, and how many were undone of the most the stage allows before it
// stops. Told as fixes, never "attempt", so it is not taken for a run of the stage.
export const fixesLine = ({ attempts, rolledBack, maxAttempts }) => `fixes: ${attempts} tried, undone: ${rolledBack} of ${maxAttempts} allowed`;
