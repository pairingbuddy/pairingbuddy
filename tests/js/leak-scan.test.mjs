// The leak scan pb runs on what leaves the machine: secrets and personal data in added lines, commit messages and PR text.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { redacted, scanDiff, scanText } from "../../shared-node/leak-scan.mjs";

const kinds = (text, options) => scanText(text, options).map(({ kind }) => kind);
// Fake keys are put together at run time, so no key shape sits in the source for a host's push protection to flag.
const glued = (...parts) => parts.join("");

describe("secrets", () => {
  test("an AWS access key id is a secret", () => {
    assert.deepEqual(kinds("aws_access_key_id = AKIAIOSFODNN7EXAMPLE"), ["aws-access-key"]);
  });

  test("each provider's key shape is a secret", () => {
    const keys = {
      "github-token": glued("token: gh", "p_", "a1B2".repeat(9)),
      "slack-token": glued("SLACK=xo", "xb-", "123456789012-123456789012-abcdefABCDEF1234"),
      "slack-webhook": glued("https://hooks.sl", "ack.com/services/", "T0000/B0000/abcdefghijklmnop"),
      "stripe-key": glued("STRIPE=sk", "_live_", "x9".repeat(12)),
      "anthropic-key": glued("key sk-", "ant-api03-", "Ab1_".repeat(10)),
      "openai-key": glued("OPENAI=sk-", "proj-", "Zz9".repeat(10)),
      "google-api-key": glued("AI", "za", "Sy0-".repeat(8), "abc"),
      "gcp-service-account": '{"type": "service_account", "project_id": "demo"}',
      "private-key": glued("-----BEGIN RSA PRIV", "ATE KEY-----"),
    };
    for (const [kind, text] of Object.entries(keys)) assert.deepEqual(kinds(text), [kind], text);
  });

  test("a random-looking value given to a secret-like name is a secret", () => {
    assert.deepEqual(kinds('DB_PASSWORD="q7Lx2Vz9Rk4mWp8Tn3Bf"'), ["secret-assignment"]);
    assert.deepEqual(kinds("api_key: 9fK2mQ8zL1xR7vB4nT6w"), ["secret-assignment"]);
  });

  test("a placeholder or a plain word given to a secret-like name is no secret", () => {
    assert.deepEqual(kinds('password = "changeme-changeme"'), []);
    assert.deepEqual(kinds("token: ${{ secrets.DEPLOY_TOKEN }}"), []);
    assert.deepEqual(kinds("const password = process.env.DB_PASSWORD;"), []);
  });

  test("a provider key under a secret-like name is reported once, as the provider's", () => {
    assert.deepEqual(kinds(glued("GITHUB_TOKEN=gh", "p_", "q7Lx2Vz9Rk4mWp8Tn3BfY6cJ1sD5hG0eK9uA")), ["github-token"]);
  });
});

describe("personal data", () => {
  test("an email address that is not the author's is personal data", () => {
    assert.deepEqual(kinds("contact jane.doe@acme-corp.se for access", { allowedEmails: ["dev@acme-corp.se"] }), ["email"]);
  });

  test("the author's own, a noreply and an example address are not", () => {
    const text = "dev@acme-corp.se, 123+dev@users.noreply.github.com, noreply@vendor.io, someone@example.com, a@b.test";
    assert.deepEqual(kinds(text, { allowedEmails: ["Dev@Acme-Corp.se"] }), []);
  });

  test("a phone number in international form is personal data", () => {
    assert.deepEqual(kinds("call +46 70 123 45 67 after five"), ["phone"]);
    assert.deepEqual(kinds("tel: +1-415-555-0132"), ["phone"]);
  });

  test("a personal identity number with a valid check digit is personal data", () => {
    assert.deepEqual(kinds("pnr 811218-9876"), ["personal-id"]);
    assert.deepEqual(kinds("ssn 123-45-6789"), ["personal-id"]);
  });

  test("dates, versions, counts and a wrong check digit are not", () => {
    assert.deepEqual(kinds("released 2026-11-28, v1.2.3, 811218-9875, took +12 s, 000-12-3456"), []);
  });
});

describe("company words", () => {
  test("a configured deny-list word is reported, whatever its letter case", () => {
    assert.deepEqual(kinds("ported from the acme ledger service", { denylist: ["ACME Ledger"] }), ["denylisted"]);
  });
});

describe("an outgoing diff", () => {
  const diff = [
    "diff --git a/src/app.js b/src/app.js",
    "--- a/src/app.js",
    "+++ b/src/app.js",
    "@@ -1,2 +1,2 @@",
    "-const key = 'AKIAIOSFODNN7EXAMPLE';",
    "+const key = process.env.KEY;",
    "+// owner: jane.doe@acme-corp.se",
  ].join("\n");

  test("only added lines count, each named by its file", () => {
    assert.deepEqual(scanDiff(diff).map(({ kind, file }) => ({ kind, file })), [{ kind: "email", file: "src/app.js" }]);
  });

  test("an added .env file is a secret file, and an example of one is not", () => {
    const added = (path) => [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, "@@ -0,0 +1 @@", "+PORT=3000"].join("\n");
    assert.deepEqual(scanDiff(added("config/.env.local")).map(({ kind, file }) => ({ kind, file })), [{ kind: "env-file", file: "config/.env.local" }]);
    assert.deepEqual(scanDiff(added(".env.example")), []);
  });
});

describe("showing a hit", () => {
  test("a secret or personal value shows only its first four characters", () => {
    assert.equal(redacted({ kind: "aws-access-key", excerpt: "AKIAIOSFODNN7EXAMPLE" }), "AKIA… (20 chars)");
    assert.equal(redacted({ kind: "email", excerpt: "jane.doe@acme-corp.se" }), "jane… (21 chars)");
  });

  test("a deny-list word and a file name show in full", () => {
    assert.equal(redacted({ kind: "denylisted", excerpt: "acme ledger" }), "acme ledger");
    assert.equal(redacted({ kind: "env-file", excerpt: "config/.env.local" }), "config/.env.local");
  });
});
