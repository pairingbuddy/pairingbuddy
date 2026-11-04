import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RUNBOOK = fileURLToPath(new URL("../smoke/T4A-RUNBOOK.md", import.meta.url));
const WIDTH_THRESHOLD = 110;

const CAPTURE_DIR = "docs/design/progress-mod/t4a-smoke/";
const README = fileURLToPath(new URL("../../docs/design/progress-mod/t4a-smoke/README.md", import.meta.url));

function readReadme() {
  assert.ok(existsSync(README), `${CAPTURE_DIR}README.md exists`);
  return readFileSync(README, "utf8");
}

function section(text, title) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${title}\\b`, "i").test(line));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = line.match(/^(#+)\s/);
    return m && m[1].length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function tableRows(body) {
  return body
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim().toLowerCase()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

test("runbook-names-required-checks", async (t) => {
  assert.ok(existsSync(RUNBOOK), "tests/smoke/T4A-RUNBOOK.md exists");
  const text = readFileSync(RUNBOOK, "utf8");

  await t.test("has the Setup, Steps, Observe and Report back sections", () => {
    for (const heading of ["Setup", "Steps", "Observe", "Report back"]) {
      assert.match(text, new RegExp(`^#{1,6}\\s+${heading}\\b`, "mi"), `has a ${heading} section`);
    }
  });

  await t.test("names the lab commands", () => {
    for (const command of ["t4a-lab.mjs setup", "setup --broken load", "setup --broken render", "t4a-lab.mjs show"]) {
      assert.ok(text.includes(command), `names ${command}`);
    }
  });

  await t.test("names a wide and a narrow width", () => {
    const widths = [...text.matchAll(/\b(\d{2,3})\s*(?:columns|cols)\b/gi)].map((m) => Number(m[1]));
    assert.ok(widths.some((w) => w >= WIDTH_THRESHOLD), "names a wide width of 110 columns or more");
    assert.ok(widths.some((w) => w < WIDTH_THRESHOLD), "names a narrow width under 110 columns");
  });

  await t.test("names the light and dark themes", () => {
    assert.match(text, /\blight\s+theme\b|\btheme\b[^\n]*\blight\b/i, "names the light theme");
    assert.match(text, /\bdark\s+theme\b|\btheme\b[^\n]*\bdark\b/i, "names the dark theme");
  });

  await t.test("names the alert sound and the alertSound setting turned off", () => {
    assert.match(text, /alert sound/i, "names the alert sound");
    assert.match(text, /alertSound[^\n]*\b(off|false|disabled?)\b/i, "names the alertSound setting turned off");
  });

  await t.test("hands the headless S2 runs to the agent", () => {
    assert.ok(text.includes("s2.mjs"), "names s2.mjs");
    assert.ok(text.includes("--plugin-dir"), "names --plugin-dir");
    assert.match(
      text,
      /headless[^\n]*S2[^\n]*\bby the agent\b|headless[^\n]*S2[^\n]*\bdone by the agent\b|S2[^\n]*headless[^\n]*\bby the agent\b/i,
      "says on the headless S2 line that the agent did the runs",
    );
  });
});

test("runbook-capture-destination", async (t) => {
  await t.test("the runbook says to save captures in the t4a-smoke folder", () => {
    const text = readFileSync(RUNBOOK, "utf8");
    assert.match(text, /\b(save|saved|capture|captures)\b[^\n]*docs\/design\/progress-mod\/t4a-smoke\//i, `a save or capture instruction names ${CAPTURE_DIR}`);
  });

  await t.test("the capture README exists", () => {
    assert.ok(readReadme().length > 0, `${CAPTURE_DIR}README.md exists and is not empty`);
  });

  await t.test("the README has a Headless S2 table with healthy, broken load and broken render rows", () => {
    const body = section(readReadme(), "Headless S2");
    assert.ok(body !== null, "has a Headless S2 section");
    const labels = tableRows(body).map((cells) => cells[0]);
    for (const row of ["healthy", "broken load", "broken render"]) {
      assert.ok(labels.some((label) => label.includes(row)), `has a ${row} row`);
    }
  });

  await t.test("the README has a Captures table with file, part, columns, theme and moment columns", () => {
    const body = section(readReadme(), "Captures");
    assert.ok(body !== null, "has a Captures section");
    const header = tableRows(body)[0] ?? [];
    assert.deepEqual(header, ["file", "part", "columns", "theme", "moment"], "header columns");
  });
});

test("focus-loss-recorded-as-platform-behaviour", async () => {
  const runbook = readFileSync(RUNBOOK, "utf8").toLowerCase();
  const readme = readReadme().toLowerCase();

  for (const [name, text] of [["the runbook", runbook], ["the README", readme]]) {
    assert.match(text, /focus[^.]*\b(lost|loses|lose)\b[^.]*window|window[^.]*\b(loses|lost)\b[^.]*focus/, `${name} says focus can be lost when the window loses focus`);
    assert.match(text, /\/pb[^.]*\b(restores|restore|brings back|recovers)\b|\b(restores|restore|recovery)\b[^.]*\/pb/, `${name} says /pb restores it`);
  }
});
