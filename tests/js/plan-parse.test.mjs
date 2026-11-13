// Scenarios: plan-parsing-units, plan-parsing-tasks-and-lines, plan-next-task (parser half), plan-format-problems, human-task-parsing.
// Tests for the pure plan parser in shared-node/plan.mjs.
// Never use { skip } here: the JS suite treats skipped tests as failures.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withPrLine } from "../../shared-node/plan-boxes.mjs";
import { parsePlan } from "../../shared-node/plan.mjs";

const unitShapes = (text) =>
  parsePlan(text).units.map((u) => ({ unit: u.unit, tracer: u.tracer, tasks: u.tasks.map((t) => t.title) }));

describe("plan-parsing-units", () => {
  // A tracer containing #### PR: groups yields one unit per PR group (name without the PR: prefix, tracer name attached), each with its tasks
  test("parses-plan-with-pr-headings", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Parse units**",
      "- [ ] **Parse tasks**",
      "",
      "#### Notes",
      "",
      "- [ ] **Parse notes**",
      "",
      "#### PR: Verb",
      "",
      "- [ ] **Add verb**",
      "",
    ].join("\n");

    assert.deepEqual(
      unitShapes(text),
      [
        { unit: "Parser", tracer: "Tracer 1: Walking skeleton", tasks: ["Parse units", "Parse tasks", "Parse notes"] },
        { unit: "Verb", tracer: "Tracer 1: Walking skeleton", tasks: ["Add verb"] },
      ],
      "one unit per PR group, named without the PR: prefix, carrying the tracer name and its tasks",
    );
  });

  // A tracer with boxes and no PR group is itself the unit, carrying its own name as the tracer
  test("parses-plan-without-pr-headings", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "- [ ] **Parse units**",
      "- [ ] **Parse tasks**",
      "",
      "### Tracer 2: Verb",
      "",
      "- [ ] **Add verb**",
      "",
    ].join("\n");

    assert.deepEqual(
      unitShapes(text),
      [
        { unit: "Tracer 1: Walking skeleton", tracer: "Tracer 1: Walking skeleton", tasks: ["Parse units", "Parse tasks"] },
        { unit: "Tracer 2: Verb", tracer: "Tracer 2: Verb", tasks: ["Add verb"] },
      ],
      "a tracer without PR groups is itself the unit, carrying its own name as the tracer",
    );
  });

  // Headings and checkboxes under ## Requirements and ## Architecture are not units or tasks, in a plan with ## Tasks and in an older plan without it
  test("ignores-requirements-and-architecture-headings", () => {
    const withTasks = [
      "# Plan",
      "",
      "## Design Decisions",
      "",
      "### Human decisions",
      "",
      "- [ ] **Decision box**",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Real work",
      "",
      "- [ ] **Do the thing**",
      "",
      "## Requirements",
      "",
      "### R1: Must be fast",
      "",
      "- [ ] **Requirement box**",
      "",
      "## Architecture",
      "",
      "### D1: Use a parser",
      "",
      "- [ ] **Architecture box**",
      "",
    ].join("\n");
    const older = [
      "# Plan",
      "",
      "## Design Decisions",
      "",
      "### TB1: Real work",
      "",
      "- [ ] **Do the thing**",
      "",
      "## Requirements",
      "",
      "### R1: Must be fast",
      "",
      "- [ ] **Requirement box**",
      "",
      "## Architecture",
      "",
      "### D1: Use a parser",
      "",
      "- [ ] **Architecture box**",
      "",
    ].join("\n");
    const levelThreeTasks = ["# Plan", "", "### TB1: Real work", "", "- [ ] **Do the thing**", "", "### Tasks", "", "Nothing here.", ""].join("\n");
    assert.deepEqual(
      unitShapes(levelThreeTasks),
      [{ unit: "TB1: Real work", tracer: "TB1: Real work", tasks: ["Do the thing"] }],
      "a ### Tasks heading is not the ## Tasks section: the plan is still read as an older one",
    );
    assert.deepEqual(
      unitShapes(withTasks),
      [{ unit: "Tracer 1: Real work", tracer: "Tracer 1: Real work", tasks: ["Do the thing"] }],
      "with ## Tasks, only the tracer under it is a unit",
    );
    assert.deepEqual(
      unitShapes(older),
      [{ unit: "TB1: Real work", tracer: "TB1: Real work", tasks: ["Do the thing"] }],
      "without ## Tasks, Requirements and Architecture sections are still not units",
    );
  });

  // Headings and checkbox lines inside fenced code blocks are not parsed; a heading with no tasks is not a unit
  test("ignores-headings-and-boxes-in-code-fences", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Real work",
      "",
      "- [ ] **Real task**",
      "",
      "#### PR: Empty group",
      "",
      "```",
      "### Backtick fake tracer",
      "#### PR: Backtick fake",
      "- [ ] **Backtick fake task**",
      "```",
      "",
      "~~~",
      "### Tilde fake tracer",
      "#### PR: Tilde fake",
      "- [ ] **Tilde fake task**",
      "~~~",
      "",
      "### Outcome notes",
      "",
      "Nothing to build here.",
      "",
    ].join("\n");

    assert.deepEqual(
      unitShapes(text),
      [{ unit: "Tracer 1: Real work", tracer: "Tracer 1: Real work", tasks: ["Real task"] }],
      "headings and boxes inside ``` and ~~~ fences are not parsed, and a ### or #### PR: heading with no tasks is not a unit",
    );

    const mixedMarkers = ["# Plan", "", "## Tasks", "", "### Tracer 1: Real work", "", "```", "~~~", "### Fake", "- [ ] **Fake task**", "```", ""].join("\n");

    assert.deepEqual(unitShapes(mixedMarkers), [], "a ``` fence closes only on its own marker, so a ~~~ line inside it does not end it");
  });
});

describe("plan-parsing-tasks-and-lines", () => {
  // Title has the surrounding ** removed, checked is true for x and X, and the body keeps the indented lines with common indentation removed and blank ends trimmed
  test("task-title-checked-and-body", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "- [ ] **Task 1: Parser**",
      "",
      "  Parse the plan text.",
      "",
      "  **Acceptance criteria:**",
      "  - Titles come out clean",
      "  - Bodies keep their shape",
      "    - Nested detail",
      "  - [ ] Check the parser by hand",
      "",
      "  ```js",
      "  const parsed = parsePlan(text);",
      "  ```",
      "",
      "---",
      "",
      "- [x] **Task 2: Done**",
      "      Indented first line.",
      "  Already finished.",
      "- [X] **Task 3: Upper**",
      "",
    ].join("\n");

    const tasks = parsePlan(text).units[0].tasks;

    assert.deepEqual(
      tasks.map((t) => ({ title: t.title, checked: t.checked, body: t.body })),
      [
        {
          title: "Task 1: Parser",
          checked: false,
          body: [
            "Parse the plan text.",
            "",
            "**Acceptance criteria:**",
            "- Titles come out clean",
            "- Bodies keep their shape",
            "  - Nested detail",
            "- [ ] Check the parser by hand",
            "",
            "```js",
            "const parsed = parsePlan(text);",
            "```",
          ].join("\n"),
        },
        { title: "Task 2: Done", checked: true, body: "    Indented first line.\nAlready finished." },
        { title: "Task 3: Upper", checked: true, body: "" },
      ],
      "titles lose the bold, x and X are checked, bodies drop common indentation and only blank ends (extra indent on a first line stays), keep fenced code, and stop at --- or the next box",
    );

    const deep = ["# Plan", "", "## Tasks", "", "### T1", "", "- [ ] **Deep**", "    First line", "    Second line", ""].join("\n");

    assert.equal(parsePlan(deep).units[0].tasks[0].body, "First line\nSecond line", "a body indented uniformly by 4 spaces loses all of that indent");
  });

  // A PR: <url> branch: <name> line sets the unit pr to the url (null when absent); a Legacy: accepted line sets legacy true (false when absent)
  test("unit-pr-and-legacy-lines", () => {
    const base = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Lines",
      "",
      "#### PR: Published",
      "",
      "- [ ] **Task 1: First**",
      "",
      "#### PR: Accepted",
      "Legacy: accepted",
      "",
      "- [ ] **Task 2: Second**",
      "",
      "#### PR: Pending",
      "Legacy: pending",
      "",
      "- [ ] **Task 4: Fourth**",
      "",
      "#### PR: Plain",
      "",
      "- [ ] **Task 3: Third**",
      "  PR: https://example.test/pull/9 branch: x",
      "",
    ].join("\n");
    const text = withPrLine(base, "Published", "PR: https://example.test/pull/7 branch: feat/parser");

    const lines = parsePlan(text).units.map((u) => ({ unit: u.unit, pr: u.pr, legacy: u.legacy }));

    assert.deepEqual(
      lines,
      [
        { unit: "Published", pr: "https://example.test/pull/7", legacy: false },
        { unit: "Accepted", pr: null, legacy: true },
        { unit: "Pending", pr: null, legacy: false },
        { unit: "Plain", pr: null, legacy: false },
      ],
      "pr is the url from the PR: line pb publish writes, legacy follows only the exact Legacy: accepted line, and an indented PR: line in a task body does not count",
    );

    const fenced = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Fenced",
      "",
      "#### PR: Fenced",
      "```",
      "PR: https://example.test/pull/1 branch: x",
      "Legacy: accepted",
      "```",
      "",
      "- [ ] **Task 1: First**",
      "",
    ].join("\n");

    const fencedUnit = parsePlan(fenced).units.find((u) => u.unit === "Fenced");

    assert.deepEqual(
      { pr: fencedUnit.pr, legacy: fencedUnit.legacy },
      { pr: null, legacy: false },
      "PR: and Legacy: lines inside a fenced block under a unit heading do not count",
    );
  });
});

describe("plan-next-task", () => {
  // Next is the first unchecked task across units, with its unit, tracer, title and body; null when all tasks are checked
  test("next-is-first-unchecked-in-document-order", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "#### PR: Parser",
      "",
      "- [x] **Task 1: Done first**",
      "- [x] **Task 2: Done second**",
      "",
      "#### PR: Verb",
      "",
      "- [x] **Task 3: Done third**",
      "- [ ] **Task 4: Build the verb**",
      "",
      "  Wire the verb up.",
      "",
      "  - Reports the next task",
      "- [ ] **Task 5: Later**",
      "",
    ].join("\n");
    const allChecked = ["# Plan", "", "## Tasks", "", "### Tracer 1: Done", "", "- [x] **Task 1: Done**", ""].join("\n");

    assert.deepEqual(
      parsePlan(text).next,
      {
        unit: "Verb",
        tracer: "Tracer 1: Walking skeleton",
        title: "Task 4: Build the verb",
        body: "Wire the verb up.\n\n- Reports the next task",
      },
      "next is the first unchecked task in document order, with its unit, tracer, title and body",
    );
    assert.equal(parsePlan(allChecked).next, null, "next is null when every task is checked");
  });

  // Parsing the edited text of an unchecked task (renamed title, changed body) returns the new title and body, with no state carried between parses
  test("human-edits-to-unchecked-tasks-are-picked-up", () => {
    const original = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "- [x] **Task 1: Done**",
      "- [ ] **Task 2: Original title**",
      "",
      "  Original body.",
      "",
    ].join("\n");
    const edited = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "- [x] **Task 1: Done**",
      "- [ ] **Task 2: Renamed title**",
      "",
      "  Changed body.",
      "",
    ].join("\n");

    const first = parsePlan(original);
    const second = parsePlan(edited);
    const firstAgain = parsePlan(original);

    const unit = "Tracer 1: Walking skeleton";
    assert.deepEqual(
      second.next,
      { unit, tracer: unit, title: "Task 2: Renamed title", body: "Changed body." },
      "the edited parse returns the renamed title and changed body",
    );
    assert.deepEqual(
      first.next,
      { unit, tracer: unit, title: "Task 2: Original title", body: "Original body." },
      "the original parse is unchanged by the later parse",
    );
    assert.deepEqual(firstAgain, first, "parsing the original again gives the same result, so no state is carried");
  });
});

describe("plan-format-problems", () => {
  // A box under ## Tasks before any tracer, or directly under a tracer that also has #### PR: groups, is reported as a problem naming the task
  test("problem-task-outside-any-unit", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "- [ ] **Task 0: Stray**",
      "",
      "### Tracer 1: Grouped",
      "",
      "- [ ] **Task 1: Ungrouped**",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Task 2: Grouped**",
      "",
    ].join("\n");

    const { problems } = parsePlan(text);

    assert.deepEqual(
      problems,
      [
        'the task "Task 0: Stray" is not under a tracer',
        'the task "Task 1: Ungrouped" is under the tracer "Tracer 1: Grouped" but outside its PR: groups',
      ],
      "one plain string per problem, each naming its task title",
    );

    const sameNameTracers = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### T1",
      "",
      "- [ ] **Task A: Direct**",
      "",
      "### T1",
      "",
      "#### PR: y",
      "",
      "- [ ] **Task B: Grouped**",
      "",
    ].join("\n");

    const sameName = parsePlan(sameNameTracers);

    const earlyGroup = ["# Plan", "", "## Tasks", "", "#### PR: Early", "", "- [ ] **Task E: Early**", ""].join("\n");

    const early = parsePlan(earlyGroup);

    assert.deepEqual(early.problems, ['the task "Task E: Early" is not under a tracer'], "a PR: group before any tracer does not take its box in");
    assert.deepEqual(early.units, [], "a PR: group outside any tracer makes no unit");

    const afterSection = ["# Plan", "", "### TB1", "", "- [ ] **Task 1: In**", "", "## Notes", "", "#### PR: Late", "", "- [ ] **Task 2: Late**", ""].join("\n");

    const late = parsePlan(afterSection);

    assert.deepEqual(late.problems, ['the task "Task 2: Late" is not under a tracer'], "a level-2 section ends the tracer, so a later PR: group has none");
    assert.deepEqual(late.units.map((u) => u.unit), ["TB1"], "only the tracer before the section is a unit");

    assert.deepEqual(sameName.problems, [], "a tracer without PR groups is not flagged just because a later tracer with the same name has them");
    assert.deepEqual(
      sameName.units.map((u) => u.unit),
      ["T1", "y"],
      "the first tracer's direct task is kept as its own unit",
    );
  });

  // Two tasks with the same title are reported, naming the title
  test("problem-duplicate-task-titles", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: First",
      "",
      "- [x] **Task 3: Same name**",
      "- [ ] **Task 4: Unique one**",
      "",
      "### Tracer 2: Second",
      "",
      "- [ ] **Task 3: Same name**",
      "- [ ] **Task 5: Unique two**",
      "",
    ].join("\n");

    const { problems } = parsePlan(text);

    assert.deepEqual(
      problems,
      ['2 tasks are titled "Task 3: Same name"; task titles identify tasks, so each must be unique'],
      "one plain string naming the duplicated title once, with its count",
    );

    const nested = parsePlan("# Plan\n\n## Tasks\n\n### T1\n\n- [ ] **A**\n  - [ ] B\n- [ ] **B**\n").problems;

    assert.deepEqual(
      nested,
      ['2 tasks are titled "B"; task titles identify tasks, so each must be unique'],
      "a task title also matching an indented sub-box counts twice, the way pb task end counts boxes",
    );
  });

  // Two units with the same name are reported naming the unit; a plan with no tasks at all is reported
  test("problem-duplicate-unit-names-and-no-tasks", () => {
    const duplicated = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: First",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Task 1: Parse units**",
      "",
      "### Tracer 2: Second",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Task 2: Parse tasks**",
      "",
    ].join("\n");
    const empty = ["# Plan", "", "## Tasks", "", "### Tracer 1: Nothing yet", ""].join("\n");

    assert.deepEqual(
      parsePlan(duplicated).problems,
      ['2 units are named "Parser"; unit names identify units, so each must be unique'],
      "one plain string naming the duplicated unit once, with its count",
    );
    assert.deepEqual(parsePlan(empty).problems, ["the plan has no tasks"], "a plan with a tracer but no boxes is reported as having no tasks");

    const onlyStray = ["# Plan", "", "## Tasks", "", "- [ ] **Task 0: Stray**", ""].join("\n");

    assert.deepEqual(parsePlan(onlyStray).problems, ['the task "Task 0: Stray" is not under a tracer'], "a stray box counts as a task, so the plan is not also reported as having none");
  });
});

describe("human-task-parsing", () => {
  // A task is human when its title starts with [HUMAN], bare or after a leading "Task <id>:" prefix; lowercase, mid-title and bracketless markers are not
  test("human-marker-with-or-without-task-prefix", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "- [ ] **[HUMAN] Bare marker**",
      "- [ ] **Task 5: [HUMAN] Prefixed marker**",
      "- [ ] **[human] Lowercase marker**",
      "- [ ] **Do X [HUMAN] mid title**",
      "- [ ] **HUMAN without brackets**",
      "- [ ] **Task 6: Plain agent task**",
      "- [ ] **Task 7 and 8: [HUMAN] Two ids**",
      "- [ ] **[HUMANS] Plural marker**",
      "",
    ].join("\n");

    const tasks = parsePlan(text).units[0].tasks.map((t) => ({ title: t.title, human: t.human }));

    assert.deepEqual(
      tasks,
      [
        { title: "[HUMAN] Bare marker", human: true },
        { title: "Task 5: [HUMAN] Prefixed marker", human: true },
        { title: "[human] Lowercase marker", human: false },
        { title: "Do X [HUMAN] mid title", human: false },
        { title: "HUMAN without brackets", human: false },
        { title: "Task 6: Plain agent task", human: false },
        { title: "Task 7 and 8: [HUMAN] Two ids", human: false },
        { title: "[HUMANS] Plural marker", human: false },
      ],
      "only an uppercase bracketed [HUMAN] at the start of the title, or right after Task <id>:, marks a human task",
    );
  });
});

describe("plan-depends-on", () => {
  // A "Depends on: <unit name>" line between the unit heading and its first task gives that unit dependsOn equal to the trimmed name; a unit without the line has dependsOn null
  test("depends-on-line-sets-dependsOn", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Parse units**",
      "",
      "#### PR: Verb",
      "",
      "Depends on:   Parser  ",
      "",
      "- [ ] **Add verb**",
      "",
    ].join("\n");

    const result = parsePlan(text);

    assert.deepEqual(
      result.units.map((u) => ({ unit: u.unit, dependsOn: u.dependsOn })),
      [
        { unit: "Parser", dependsOn: null },
        { unit: "Verb", dependsOn: "Parser" },
      ],
      "the unit with a Depends on line carries the trimmed name; the unit without one has dependsOn null",
    );
    assert.deepEqual(result.problems, [], "a valid Depends on line is not a format problem");
  });
  // A Depends on line after the first task or inside a code fence does not count and sets no dependsOn
  test("depends-on-outside-header-zone-is-ignored", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Parse units**",
      "",
      "Depends on: Verb",
      "",
      "#### PR: Verb",
      "",
      "```",
      "Depends on: Parser",
      "```",
      "",
      "- [ ] **Add verb**",
      "",
    ].join("\n");

    const result = parsePlan(text);

    const dependsOnOf = (name) => result.units.find((u) => u.unit === name)?.dependsOn;
    assert.equal(dependsOnOf("Parser"), null, "a Depends on line after the first task sets no dependsOn");
    assert.equal(dependsOnOf("Verb"), null, "a Depends on line inside a code fence sets no dependsOn");
    assert.deepEqual(
      result.units.map((u) => u.unit),
      ["Parser", "Verb"],
      "both units are still parsed",
    );
    assert.deepEqual(result.problems, [], "an ignored Depends on line is not a format problem");
  });
  // Builds the Parser/Verb plan where Verb's header carries the given lines
  const twoUnitPlanWithVerbHeader = (...headerLines) =>
    [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "#### PR: Parser",
      "",
      "- [ ] **Parse units**",
      "",
      "#### PR: Verb",
      "",
      ...headerLines,
      "",
      "- [ ] **Add verb**",
      "",
    ].join("\n");
  // Builds the Parser/Verb plan where Verb declares the given Depends on value
  const twoUnitPlanWithVerbDependsOn = (dep) => twoUnitPlanWithVerbHeader(`Depends on: ${dep}`);
  // A Depends on naming no unit of the plan is reported as a format problem naming the unit and the missing dependency
  test("depends-on-unknown-unit-is-a-named-format-problem", () => {
    const text = twoUnitPlanWithVerbDependsOn("Ghost");

    const { problems } = parsePlan(text);

    assert.equal(problems.length, 1, "exactly one problem is reported for the unknown dependency");
    assert.match(problems[0], /Verb/, "the problem names the unit that depends");
    assert.match(problems[0], /Ghost/, "the problem names the missing dependency");
  });
  // A Depends on naming the unit itself is reported as a format problem naming the unit
  test("depends-on-itself-is-a-named-format-problem", () => {
    const text = twoUnitPlanWithVerbDependsOn("Verb");

    const { problems } = parsePlan(text);

    assert.equal(problems.length, 1, "exactly one problem is reported for the self dependency");
    assert.match(problems[0], /Verb/, "the problem names the unit that depends on itself");
    assert.match(problems[0], /itself/, "the problem says the unit depends on itself");
  });
  // A Depends on naming a unit that comes later in the plan is reported as a format problem saying a dependency must come first
  test("depends-on-later-unit-is-a-named-format-problem", () => {
    const text = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "### Tracer 1: Walking skeleton",
      "",
      "#### PR: Parser",
      "",
      "Depends on: Verb",
      "",
      "- [ ] **Parse units**",
      "",
      "#### PR: Verb",
      "",
      "- [ ] **Add verb**",
      "",
    ].join("\n");

    const { problems } = parsePlan(text);

    assert.equal(problems.length, 1, "exactly one problem is reported for the later dependency");
    assert.match(problems[0], /Parser/, "the problem names the unit that depends");
    assert.match(problems[0], /Verb/, "the problem names the later unit it depends on");
    assert.match(problems[0], /must come first/, "the problem says a dependency must come first");
  });
  // A unit with two Depends on lines is reported as a format problem naming the unit
  test("more-than-one-depends-on-line-is-a-named-format-problem", () => {
    const text = twoUnitPlanWithVerbHeader("Depends on: Parser", "Depends on: Parser");

    const { problems } = parsePlan(text);

    assert.equal(problems.length, 1, "exactly one problem is reported for the repeated Depends on line");
    assert.match(problems[0], /Verb/, "the problem names the unit with more than one Depends on line");
    assert.match(problems[0], /more than one/, "the problem says the unit has more than one Depends on line");
  });
  // Depends on is a line of its own: the words mid-text in a heading-zone line are prose, so the unit has no dependency
  test("depends-on-mid-text-is-not-a-dependency", () => {
    const text = twoUnitPlanWithVerbHeader("This slice Depends on: Parser");

    const { units, problems } = parsePlan(text);

    assert.equal(units.find(({ unit }) => unit === "Verb").dependsOn, null, "a mid-text Depends on leaves dependsOn null");
    assert.deepEqual(problems, [], "a mid-text Depends on is no problem");
  });
  // With two Depends on lines the first wins, and it is still checked: an unknown first one is reported next to the repeat
  test("first-of-two-depends-on-lines-wins-and-is-still-checked", () => {
    const text = twoUnitPlanWithVerbHeader("Depends on: Ghost", "Depends on: Parser");

    const { units, problems } = parsePlan(text);

    assert.equal(units.find(({ unit }) => unit === "Verb").dependsOn, "Ghost", "the first Depends on line is the one kept");
    assert.equal(problems.length, 2, "the repeat and the unknown dependency are both reported");
    assert.ok(problems.some((problem) => /more than one/.test(problem)), "one problem says there is more than one Depends on line");
    assert.ok(problems.some((problem) => /Ghost/.test(problem)), "one problem names the unknown Ghost");
  });
});
