// Deterministic PR draft lint (Task 68a). Pure: lintDraft takes the defaults as a parameter; loadPrLintDefaults reads
// contracts/pr-lint.json for callers that have no defaults of their own. config (git-config pr.lint) extends the default
// lists and overrides the scalars; a value of the wrong type is refused with PrLintConfigRefused.
import { readFileSync } from "node:fs";

const DEFAULTS_URL = new URL("../contracts/pr-lint.json", import.meta.url);
const PATH_LINE = /^\s*[-*]\s+`?[\w.-]+(?:\/[\w.-]+)+`?\s*$/;
const LIST_KEYS = ["title_types", "attribution_patterns", "hype_words", "expiring_patterns", "expiring_marker_patterns"];
const SCALAR_KEYS = ["title_max_length", "budget_base_chars", "budget_chars_per_diff_line", "file_inventory_min_lines"];

export class PrLintConfigRefused extends Error {}

export function loadPrLintDefaults() {
  return JSON.parse(readFileSync(DEFAULTS_URL, "utf8"));
}

function assertRegexList(key, list) {
  if (!key.endsWith("_patterns")) return;
  for (const source of list) {
    try {
      new RegExp(source, "u");
    } catch {
      throw new PrLintConfigRefused(`pr.lint.${key} has a pattern that is not a valid regular expression: ${source}`);
    }
  }
}

function mergedRules(defaults, config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) throw new PrLintConfigRefused("pr.lint must be an object");
  const rules = { ...defaults };
  for (const key of LIST_KEYS) {
    if (!(key in config)) continue;
    if (!Array.isArray(config[key]) || !config[key].every((item) => typeof item === "string")) throw new PrLintConfigRefused(`pr.lint.${key} must be an array of strings; it extends the default list`);
    assertRegexList(key, config[key]);
    rules[key] = [...new Set([...(defaults[key] ?? []), ...config[key]])];
  }
  for (const key of SCALAR_KEYS) {
    if (!(key in config)) continue;
    if (!Number.isInteger(config[key]) || config[key] < 0) throw new PrLintConfigRefused(`pr.lint.${key} must be a non-negative integer; it replaces the default`);
    rules[key] = config[key];
  }
  return rules;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MESSAGES = {
  "title-form": "Rewrite the title to follow the repository's title template, with a listed type.",
  "title-length": "Shorten the title to the maximum length.",
  "size-budget": "Cut the body to fit the size budget; drop detail the diff already shows.",
  attribution: "Remove this attribution or trailer line; the body carries no tool footer or git trailer.",
  hype: "Replace this word with a plain statement of the fact.",
  "file-inventory": "Remove the list of file paths; describe the behaviour that changed instead.",
  "expiring-text": "Reword so it stays true after merge: state the fact, not the moment, task number or work state.",
};

const failure = (rule, text, line) => ({ rule, text, message: MESSAGES[rule], line });

function titleFormPattern(template, types) {
  const source = escapeRegex(template)
    .replace("\\{type\\}", "(?:" + types.map(escapeRegex).join("|") + ")")
    .replace("\\{summary\\}", ".+");
  return new RegExp(`^${source}$`);
}

const bodyLines = (body) => body.split("\n").map((text, index) => ({ text, line: index + 1 }));

function titleFailures(title, template, rules) {
  const failures = [];
  if (template && !titleFormPattern(template, rules.title_types).test(title)) failures.push(failure("title-form", title, null));
  if (title.length > rules.title_max_length) failures.push(failure("title-length", title, null));
  return failures;
}

function budgetFailures(body, diffLines, rules) {
  const budget = rules.budget_base_chars + rules.budget_chars_per_diff_line * diffLines;
  return body.length > budget ? [failure("size-budget", `${body.length} chars exceeds ${budget}`, null)] : [];
}

function attributionFailures(lines, patterns) {
  const regexes = patterns.map((source) => new RegExp(source, "iu"));
  return lines.filter(({ text }) => regexes.some((regex) => regex.test(text))).map(({ text, line }) => failure("attribution", text.trim(), line));
}

function hypeFailures(lines, words) {
  const regexes = words.map((word) => new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"));
  return lines.flatMap(({ text, line }) => regexes.flatMap((regex) => [...text.matchAll(regex)].map((match) => failure("hype", match[0].toLowerCase(), line))));
}

function inventoryFailures(lines, minLines) {
  const paths = lines.filter(({ text }) => PATH_LINE.test(text));
  return paths.length >= minLines ? [failure("file-inventory", paths.map(({ text }) => text).join("\n"), paths[0].line)] : [];
}

function expiringFailures(lines, rules) {
  const regexes = [
    ...rules.expiring_patterns.map((source) => new RegExp(source, "giu")),
    ...rules.expiring_marker_patterns.map((source) => new RegExp(source, "gu")),
  ];
  return lines.flatMap(({ text, line }) => regexes.flatMap((regex) => [...text.matchAll(regex)].map((match) => failure("expiring-text", match[0], line))));
}

export function lintDraft({ title, body, diffLines, titleTemplate, config = {}, defaults = loadPrLintDefaults() }) {
  const rules = mergedRules(defaults, config);
  const lines = bodyLines(body);
  const failures = [
    ...titleFailures(title, titleTemplate, rules),
    ...budgetFailures(body, diffLines, rules),
    ...attributionFailures(lines, rules.attribution_patterns),
    ...hypeFailures(lines, rules.hype_words),
    ...inventoryFailures(lines, rules.file_inventory_min_lines),
    ...expiringFailures(lines, rules),
  ];
  return { ok: failures.length === 0, failures };
}
