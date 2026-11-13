// The D17 table at the unit level: each row goes through shared-node/d17.mjs's d17Denial with the run state and the caller
// given directly and a repo made of plain files, so a row costs microseconds. What needs the real hook process (finding the
// run, session binding, broken plugin copies, the permission mode) is in d17-guard.test.mjs.
import "./isolated-tmpdir.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { d17Denial } from "../../shared-node/d17.mjs";
import { expandRows, runsInUnitLayer } from "./d17-cases.mjs";
import { fakeRepo } from "./d17-repos.mjs";
import { scenarios } from "./d17-table.mjs";

const aliasConfig = "[alias]\n\tp = push\n";
const pushToMain = "[remote \"origin\"]\n\tpush = HEAD:main\n";
const pushUpstream = "[push]\n\tdefault = upstream\n";

// The repo each setup name runs in. A row with no setup runs in the repo on feature/x. Everything else the row needs is in its command.
const REPOS = {
  default: fakeRepo(),
  main: fakeRepo({ branch: "main" }),
  alias: fakeRepo({ config: aliasConfig }),
  "remote push": fakeRepo({ config: pushToMain }),
  "push.default": fakeRepo({ config: pushUpstream }),
};
const SETUP_REPOS = {
  "HEAD on main": REPOS.main,
  "alias defined in git config, not inline": REPOS.alias,
  "repo config sets remote.origin.push to HEAD:main": REPOS["remote push"],
  "repo config sets push.default to upstream": REPOS["push.default"],
};

function repoFor(row) {
  if (row.setup === undefined) return REPOS.default;
  return SETUP_REPOS[row.setup];
}

describe("D17 table rows, run directly against d17Denial", () => {
  for (const { name, row, cell, command, reasons } of expandRows(scenarios, runsInUnitLayer)) {
    test(name, () => {
      const denial = d17Denial({ command, cwd: repoFor(row), runState: cell.runState, isSubagent: cell.context === "subagent" });

      if (row.expect === "allow") {
        assert.equal(denial, null, `should be allowed, but was denied: ${denial}`);
        return;
      }
      assert.notEqual(denial, null, "should be denied, but was allowed");
      for (const reason of reasons) assert.match(denial, reason, "the deny came from another rule");
      if (row.forbid) assert.doesNotMatch(denial, row.forbid);
    });
  }
});
