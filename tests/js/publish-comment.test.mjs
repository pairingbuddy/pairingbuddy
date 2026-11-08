// The CLI of pb publish posting the coordination comment on the new PR, observed through the gh recording shim.
import "./isolated-tmpdir.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { FAKE_PR_URL, flagValues, viewEnv } from "./gh-shim-fixture.mjs";
import { COORDINATION, REFUSED, readUnitRecord, unitFile } from "./publish-fixture.mjs";
import { planBecomesDirectoryAtPush, planFile, prLinePattern, publishableUnit, publishUnit, unitWithRecordedPr, withPlan } from "./publishable-unit-fixture.mjs";

const commentCommand = (path) => `gh pr comment ${FAKE_PR_URL} --body-file ${path}`;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A unit whose PR: line cannot be written (the plan becomes a directory at push time), so pb publish stops after the
// comment with the unit still open.
function publishStoppingAtPlanLine(unit, ghEnv = {}) {
  withPlan(unit.repo);
  planBecomesDirectoryAtPush(unit.repo);
  return publishUnit(unit, ghEnv);
}

describe("pb publish: posting the coordination comment", () => {
  test("With non-null coordination, the shim records one gh pr comment <FAKE_PR_URL> --body-file call whose file content equals the coordination text, after the gh pr create call", () => {
    const unit = publishableUnit();

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const comments = gh.prComments();
    assert.equal(comments.length, 1, "one gh pr comment call");
    assert.deepEqual(comments[0].argv.slice(0, 3), ["pr", "comment", FAKE_PR_URL], "the comment is on the new PR");
    assert.equal(flagValues(comments[0].argv, "--body-file").length, 1, "the text is passed with --body-file");
    assert.equal(comments[0].bodyFile, COORDINATION, "the file holds the coordination text");
    const order = gh.calls().map(({ argv }) => argv.slice(0, 2).join(" "));
    assert.deepEqual(order, ["pr create", "pr comment"], "create comes before comment");
  });

  // Meaningful only together with the non-null test above: that one shows a comment is posted when there is text, this
  // one that it is skipped when there is none.
  test("With null coordination, the shim records no gh pr comment call and publish still succeeds with the PR: line written and the unit closed", () => {
    const unit = publishableUnit({ coordination: null });
    withPlan(unit.repo);

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(gh.prComments(), [], "no gh pr comment call");
    assert.equal(gh.prCreates().length, 1, "the PR was created");
    assert.match(readFileSync(planFile(unit.repo), "utf8"), prLinePattern(unit.branch), "the PR: line is written");
    assert.equal(existsSync(unitFile(unit.repo)), false, "the unit is closed");
    assert.equal(JSON.parse(result.stdout).pendingComment, undefined, "no comment is pending");
    assert.deepEqual(JSON.parse(result.stdout).warnings, [], "no comment warning");
  });

  test("The body file passed to gh pr create does not contain the coordination text, while the comment file does", () => {
    const unit = publishableUnit();

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const [create] = gh.prCreates();
    const [comment] = gh.prComments();
    assert.ok(create, "gh pr create was called");
    assert.ok(comment, "gh pr comment was called");
    assert.equal(create.bodyFile.includes(COORDINATION), false, "the PR body has no coordination text");
    assert.ok(comment.bodyFile.includes(COORDINATION), "the comment file has it");
  });

  test("The temporary comment file under run/ no longer exists after pb publish finishes", () => {
    const unit = publishableUnit();

    const { gh, result } = publishUnit(unit);

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    const [file] = flagValues(gh.prComments()[0]?.argv ?? [], "--body-file");
    assert.ok(file, "a comment file was passed to gh");
    assert.doesNotMatch(file, /[\\/]run[\\/]/, "the comment file is kept per PR outside run/");
    assert.equal(existsSync(file), false, "the comment file is gone");
    assert.equal(JSON.parse(result.stdout).pendingComment, undefined, "nothing is pending");
  });
});

describe("pb publish: a failed comment and retries", () => {
  test("With GH_SHIM_FAIL='pr comment', pb publish exits 0 with result published, a warning naming the failure and the gh pr comment command to run by hand, the PR: line written and the unit closed", () => {
    const unit = publishableUnit();
    withPlan(unit.repo);

    const { gh, result } = publishUnit(unit, { GH_SHIM_FAIL: "pr comment" });

    assert.equal(result.code, 0, `exit 0, stderr ${result.stderr}`);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.result, "published", "the result is published");
    assert.equal(gh.prComments().length, 1, "a comment was tried");
    const file = printed.pendingComment;
    assert.ok(file, `the output names the kept file: ${result.stdout}`);
    const commandAtEnd = new RegExp(`${escapeRegExp(commentCommand(""))}(.+)$`);
    const matching = printed.warnings.filter((text) => commandAtEnd.test(text));
    assert.equal(matching.length, 1, `exactly one warning ends with the command to run by hand: ${result.stdout}`);
    assert.equal(matching[0].match(commandAtEnd)[1], file, "the command names the kept file");
    assert.doesNotMatch(file, /[\\/]run[\\/]/, "the kept comment file is outside run/, which closing removes");
    assert.ok(existsSync(file), "the kept comment file still exists");
    assert.equal(readFileSync(file, "utf8"), COORDINATION, "it holds the coordination text");
    assert.match(readFileSync(planFile(unit.repo), "utf8"), prLinePattern(unit.branch), "the PR: line is written");
    assert.equal(existsSync(unitFile(unit.repo)), false, "the unit is closed");
  });

  test("After a successful comment, unit.json records pr.commented true alongside the url", () => {
    const unit = publishableUnit();

    const { gh, result } = publishStoppingAtPlanLine(unit);

    assert.equal(result.code, REFUSED, `the plan write fails, so publish stops with the unit open: ${result.stdout}`);
    assert.equal(gh.prComments().length, 1, "the comment was posted");
    assert.deepEqual(readUnitRecord(unit.repo).pr, { url: FAKE_PR_URL, commented: true }, "url and commented are recorded");
  });

  test("A failed comment leaves pr.commented unset in unit.json", () => {
    const unit = publishableUnit();

    const { result } = publishStoppingAtPlanLine(unit, { GH_SHIM_FAIL: "pr comment" });

    assert.equal(result.code, REFUSED, `the plan write fails, so publish stops with the unit open: ${result.stdout}`);
    assert.deepEqual(readUnitRecord(unit.repo).pr, { url: FAKE_PR_URL }, "the url is recorded, commented is not");
  });

  test("When unit.pr has a url but commented is unset (stopped between create and comment), a second pb publish makes no gh pr create call, verifies via gh pr view, posts the comment once and records commented", () => {
    const unit = unitWithRecordedPr();

    const { gh, result } = publishUnit(unit, viewEnv({ head: unit.branch }));

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(gh.prCreates(), [], "no second gh pr create");
    assert.ok(gh.prViews().length >= 1, "the recorded PR is verified with gh pr view");
    assert.equal(gh.prComments().length, 1, "the comment is posted once");
    assert.equal(gh.prComments()[0].bodyFile, COORDINATION, "with the coordination text");
    assert.deepEqual(gh.prComments()[0].argv.slice(0, 3), ["pr", "comment", FAKE_PR_URL], "on the recorded PR");
  });

  test("When unit.pr has url and commented true, a second pb publish makes no gh pr create and no gh pr comment call", () => {
    const unit = unitWithRecordedPr({ commented: true });

    const { gh, result } = publishUnit(unit, viewEnv({ head: unit.branch }));

    assert.equal(result.code, 0, `pb publish: ${result.stderr}`);
    assert.deepEqual(gh.prCreates(), [], "no gh pr create");
    assert.deepEqual(gh.prComments(), [], "no gh pr comment");
    assert.match(readFileSync(planFile(unit.repo), "utf8"), prLinePattern(unit.branch), "the publish still finished");
  });
});
