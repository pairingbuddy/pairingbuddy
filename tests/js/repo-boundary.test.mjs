// The repo boundary: a session pb works in never writes to, pushes to, or files anything in another repo.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { bashBoundaryDenial, homeRepoOf, outgoingTextDenial, repoSlug, writeBoundaryDenial } from "../../shared-node/repo-boundary.mjs";
import { fakeRepo } from "./d17-repos.mjs";

const originConfig = (url) => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
const homeRepo = () => fakeRepo({ config: originConfig("git@github.com:acme/private-app.git") });

describe("naming a repo", () => {
  test("every GitHub URL form of one repo gives the same owner/name", () => {
    const forms = ["https://github.com/Acme/Widget.git", "git@github.com:acme/widget.git", "ssh://git@github.com/acme/widget", "https://github.com/acme/widget/", "acme/widget"];
    assert.deepEqual(forms.map(repoSlug), Array(forms.length).fill("github.com/acme/widget"));
  });
});

describe("the home repo", () => {
  test("is the repo pb recorded at unit open, whatever origin says now", () => {
    const root = homeRepo();
    mkdirSync(join(root, ".pairingbuddy", "run"), { recursive: true });
    writeFileSync(join(root, ".pairingbuddy", "run", "home-repo.json"), JSON.stringify({ slug: "github.com/acme/recorded" }));
    assert.equal(homeRepoOf(root).slug, "github.com/acme/recorded");
  });

  test("is origin's repo when nothing is recorded", () => {
    assert.equal(homeRepoOf(homeRepo()).slug, "github.com/acme/private-app");
  });
});

describe("git push", () => {
  const twoRemotes = () => fakeRepo({ config: `${originConfig("git@github.com:acme/private-app.git")}[remote "public"]\n\turl = https://github.com/acme/open-tool.git\n` });
  const denial = (command, root = twoRemotes()) => bashBoundaryDenial({ command, cwd: root, home: homeRepoOf(root) });

  test("to the home repo passes", () => {
    assert.equal(denial("git push"), null);
    assert.equal(denial("git push -u origin feature/x"), null);
  });

  test("to another repo's remote or URL is denied, and the human is named as the one who can", () => {
    for (const command of ["git push public feature/x", "git push https://github.com/acme/open-tool.git HEAD:main", "git push --repo=public"]) {
      assert.match(denial(command) ?? "", /github\.com\/acme\/open-tool.*only the human/s, command);
    }
  });
});

describe("git remote", () => {
  test("pointing a remote at another repo is denied, so no later push can reach it", () => {
    const root = homeRepo();
    const denial = (command) => bashBoundaryDenial({ command, cwd: root, home: homeRepoOf(root) });
    assert.match(denial("git remote set-url origin https://github.com/acme/open-tool.git") ?? "", /open-tool.*only the human/s);
    assert.match(denial("git remote add pub git@github.com:acme/open-tool.git") ?? "", /open-tool.*only the human/s);
    assert.equal(denial("git remote add mirror git@github.com:acme/private-app.git"), null);
  });
});

describe("gh", () => {
  const denial = (command, root = homeRepo()) => bashBoundaryDenial({ command, cwd: root, home: homeRepoOf(root) });

  test("a write that names another repo is denied", () => {
    const writes = [
      "gh issue create -R acme/open-tool --title 'pb bug' --body 'details'",
      "gh issue create --repo https://github.com/acme/open-tool --title x --body y",
      "gh pr create --repo=acme/open-tool --fill",
      "gh issue comment https://github.com/acme/open-tool/issues/12 --body hi",
      "gh api repos/acme/open-tool/issues -f title=x",
      "gh release create v1 -R acme/open-tool",
    ];
    for (const command of writes) assert.match(denial(command) ?? "", /github\.com\/acme\/open-tool.*only the human/s, command);
  });

  test("a write to the home repo and a read of another repo pass", () => {
    for (const command of ["gh issue create -R acme/private-app --title x --body y", "gh pr create --fill", "gh pr view -R acme/open-tool 3", "gh api repos/acme/open-tool/issues"]) {
      assert.equal(denial(command), null, command);
    }
  });

  test("a gist, a new repo and a fork are denied whatever they name", () => {
    for (const command of ["gh gist create notes.md", "gh repo create acme/new --public", "gh repo fork acme/private-app"]) {
      assert.match(denial(command) ?? "", /only the human/, command);
    }
  });
});

describe("another repo's checkout", () => {
  const otherRepo = () => fakeRepo({ config: originConfig("https://github.com/acme/open-tool.git") });

  test("a git change there is denied, and a git read passes", () => {
    const home = homeRepo();
    const other = otherRepo();
    const denial = (command) => bashBoundaryDenial({ command, cwd: home, home: homeRepoOf(home) });
    assert.match(denial(`cd ${other} && git commit -am 'copy fix'`) ?? "", /open-tool.*only the human/s);
    assert.match(denial(`git -C ${other} add .`) ?? "", /open-tool.*only the human/s);
    assert.equal(denial(`git -C ${other} log --oneline`), null);
    assert.equal(denial(`git -C ${other} fetch origin`), null, "a fetch sends nothing out and changes no file there");
  });

  test("a file write there is denied; one in the home repo or outside any repo passes", () => {
    const home = homeRepo();
    const other = otherRepo();
    const denial = (target) => writeBoundaryDenial([target], homeRepoOf(home));
    assert.match(denial(join(other, "sub", "notes.md")) ?? "", /open-tool.*only the human/s);
    assert.equal(denial(join(home, "sub", "app.js")), null);
    assert.equal(denial(join(fakeRepo().replace(/[^/]+$/, ""), "loose-file.txt")), null);
  });
});

describe("text a gh call sends out", () => {
  const denial = (command, cwd = homeRepo()) => outgoingTextDenial({ command, cwd, allowedEmails: ["dev@acme-corp.se"] });

  test("a secret or personal data in a title, body or body file is denied, shown redacted", () => {
    const cwd = homeRepo();
    writeFileSync(join(cwd, "body.md"), "Repro: export AWS_KEY=AKIAIOSFODNN7EXAMPLE\n");
    const reason = denial("gh pr create --title fix --body-file body.md", cwd);
    assert.match(reason ?? "", /aws-access-key.*AKIA… \(20 chars\).*only the human/s);
    assert.doesNotMatch(reason, /IOSFODNN7EXAMPLE/);
    assert.match(denial("gh issue comment 4 --body 'ping jane.doe@acme-corp.se'") ?? "", /email/);
    assert.match(denial("gh issue create -t 'call +46 70 123 45 67' -b x") ?? "", /phone/);
  });

  test("clean text and the author's own address pass", () => {
    assert.equal(denial("gh pr create --title 'Fix the cache key' --body 'Reported by dev@acme-corp.se'"), null);
    assert.equal(denial("gh pr view 3"), null);
  });
});
