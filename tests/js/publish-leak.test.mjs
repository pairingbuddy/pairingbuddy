// pb publish and the leak check: before anything is pushed or opened, the outgoing diff, the commit messages and the pull
// request text are scanned for secrets and personal data. A hit refuses with nothing pushed and no attempt used; only the
// human's typed pb human leak allow lets a false alarm through.
import "./isolated-tmpdir.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CLEAN_BODY, REFUSED, gitConfigPath } from "./publish-fixture.mjs";
import { pb } from "./cli-repo-fixture.mjs";
import { changeUnit, ledgerFile, publishableUnit, publishUnit, remoteRef } from "./publishable-unit-fixture.mjs";

const readLedger = (repo) => JSON.parse(readFileSync(ledgerFile(repo), "utf8"));
const SECRET_BODY = `${CLEAN_BODY}\nRepro with AKIAIOSFODNN7EXAMPLE as the key.\n`;

test("a secret in the pull request body is refused before the push", () => {
  const unit = publishableUnit({ body: SECRET_BODY });

  const { gh, result } = publishUnit(unit);

  assert.equal(result.code, REFUSED, `pb publish refuses, stdout ${result.stdout}`);
  assert.match(result.stderr, /aws-access-key AKIA… \(20 chars\) in the pull request body/, result.stderr);
  assert.match(result.stderr, /human leak allow 1/, "the human's line for a false alarm");
  assert.doesNotMatch(result.stderr, /IOSFODNN7EXAMPLE/, "the secret is not repeated");
  assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed");
  assert.deepEqual(gh.prCreates(), [], "no gh pr create");
  assert.equal(readLedger(unit.repo).retries?.publish?.used ?? 0, 0, "no publish attempt is used");
  const wait = JSON.parse(readFileSync(join(unit.repo.dir, ".pairingbuddy", "run", "human-wait.json"), "utf8"));
  assert.match(wait.lines.join("\n"), /human leak allow 1$/m, "the views show the wait on the human's line");
});

test("the human's pb human leak allow lets a false alarm through", () => {
  const unit = publishableUnit({ body: SECRET_BODY });
  publishUnit(unit);

  const allowed = pb(unit.repo, "human", "leak", "allow", "1");
  const { result } = publishUnit(unit);

  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(result.code, 0, `published after the allow: ${result.stderr}`);
  assert.match(result.stdout, /"result":"published"/);
});

test("allowing a hit that is not there refuses and allows nothing", () => {
  const unit = publishableUnit({ body: SECRET_BODY });
  publishUnit(unit);

  const allowed = pb(unit.repo, "human", "leak", "allow", "2");

  assert.equal(allowed.code, REFUSED, allowed.stdout);
  assert.match(allowed.stderr, /no leak finding 2/);
});

// The push goes to git-config.json's remote: if that is not the repo the unit opened in, nothing leaves.
test("a push to a remote that is not the unit's home repo is refused", () => {
  const unit = publishableUnit();
  writeFileSync(join(unit.repo.dir, ".pairingbuddy", "run", "home-repo.json"), JSON.stringify({ slug: "github.com/acme/private-app" }));

  const { gh, result } = publishUnit(unit);

  assert.equal(result.code, REFUSED, result.stdout);
  assert.match(result.stderr, /github\.com\/acme\/private-app.*only the human/s, result.stderr);
  assert.equal(remoteRef(unit.repo, `refs/heads/${unit.branch}`), null, "nothing was pushed");
  assert.deepEqual(gh.prCreates(), []);
});

// leak_denylist keeps company words out of a repo others can read: it holds unless gh says the repo is private.
const withDenylist = (unit, words) => {
  const path = gitConfigPath(unit.repo);
  const config = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...config, leak_denylist: words }));
  changeUnit(unit.repo, { gitConfigHash: createHash("sha256").update(readFileSync(path)).digest("hex") });
};
const DENYLIST_BODY = `${CLEAN_BODY}\nPorted from the acme ledger service.\n`;

test("a deny-list word bound for a public repo is refused", () => {
  const unit = publishableUnit({ body: DENYLIST_BODY });
  withDenylist(unit, ["ACME Ledger"]);

  const { result } = publishUnit(unit, { GH_SHIM_REPO_PRIVATE: "false" });

  assert.equal(result.code, REFUSED, result.stdout);
  assert.match(result.stderr, /denylisted acme ledger in the pull request body/, result.stderr);
});

test("the same word bound for a private repo goes through", () => {
  const unit = publishableUnit({ body: DENYLIST_BODY });
  withDenylist(unit, ["ACME Ledger"]);

  const { result } = publishUnit(unit, { GH_SHIM_REPO_PRIVATE: "true" });

  assert.equal(result.code, 0, result.stderr);
});

// pb pr refresh edits an open PR's title and body, so the same check runs on them.
test("pb pr refresh refuses a secret in the new body", async () => {
  const { approvedRefresh, pbWithEnv: refreshPb } = await import("./refresh-fixture.mjs");
  const { repo, gh, ghEnv } = approvedRefresh({ body: SECRET_BODY });

  const result = refreshPb(repo, ghEnv(), "pr", "refresh");

  assert.equal(result.code, REFUSED, result.stdout);
  assert.match(result.stderr, /aws-access-key AKIA… \(20 chars\) in the pull request body/);
  assert.equal(gh.calls().some(({ argv }) => argv[0] === "pr" && argv[1] === "edit"), false, "no gh pr edit");
});
