// The leak scan: secrets and personal data in text about to leave the machine (added diff lines, commit messages, a PR or
// issue body). Pattern rules only, no imports, so the gate hook can load it too. `allowedEmails` are the author's own addresses; `denylist` holds words
// (company and product names) git-config.json's leak_denylist keeps out of the repo.

const RULES = [
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "slack-webhook", pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { kind: "stripe-key", pattern: /\b[sr]k_live_[A-Za-z0-9]{16,}/g },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "gcp-service-account", pattern: /"type"\s*:\s*"service_account"/g },
  { kind: "private-key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g },
];

// A value given to a secret-like name counts when it looks random: 16 or more token characters, letters and digits both,
// and at least 3.5 bits of entropy per character, which a word or a placeholder does not reach.
const SECRET_ASSIGNMENT = /(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9/+_=-]{16,})/gi;

function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => sum - (count / value.length) * Math.log2(count / value.length), 0);
}

const looksRandom = (value) => /[A-Za-z]/.test(value) && /\d/.test(value) && entropy(value) >= 3.5;

function secretAssignments(line) {
  return [...line.matchAll(SECRET_ASSIGNMENT)].filter((match) => looksRandom(match[1])).map((match) => ({ kind: "secret-assignment", excerpt: match[1] }));
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
// Addresses that name nobody: noreply mailboxes and the reserved example and test domains.
const NOBODY = /^(?:no-?reply@|.*@users\.noreply\.github\.com$|.*@(?:[\w-]+\.)*example\.(?:com|org|net)$|.*\.(?:test|example|invalid|localhost)$)/i;

function emails(line, allowed) {
  return [...line.matchAll(EMAIL)].filter(([address]) => !NOBODY.test(address) && !allowed.has(address.toLowerCase())).map(([address]) => ({ kind: "email", excerpt: address }));
}

// A + then 8 to 15 digits, in groups split by single spaces or dashes.
const PHONE = /(?<![\w+])\+\d{1,3}(?:[ -]?\d){7,14}\b/g;
// A Swedish personal identity number (with the Luhn check digit it must have) and a US social security number.
const SWEDISH_ID = /(?<![\d-])(?:19|20)?(\d{6})[-+](\d{4})(?![\d-])/g;
const US_SSN = /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g;

function luhn(digits) {
  const sum = [...digits].reduce((total, digit, i) => {
    const value = Number(digit) * (i % 2 === 0 ? 2 : 1);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return sum % 10 === 0;
}

const isDate = (yymmdd) => Number(yymmdd.slice(2, 4)) >= 1 && Number(yymmdd.slice(2, 4)) <= 12 && Number(yymmdd.slice(4, 6)) >= 1 && Number(yymmdd.slice(4, 6)) <= 91;

function personalData(line) {
  const phones = [...line.matchAll(PHONE)].map(([excerpt]) => ({ kind: "phone", excerpt }));
  const swedish = [...line.matchAll(SWEDISH_ID)].filter(([, date, tail]) => isDate(date) && luhn(`${date}${tail}`)).map(([excerpt]) => ({ kind: "personal-id", excerpt }));
  const ssn = [...line.matchAll(US_SSN)].map(([excerpt]) => ({ kind: "personal-id", excerpt }));
  return [...phones, ...swedish, ...ssn];
}

// Each hit as {kind, line, excerpt}, in the order the text has them.
export function scanText(text, { allowedEmails = [], denylist = [] } = {}) {
  const allowed = new Set(allowedEmails.map((address) => address.toLowerCase()));
  const denied = denylist.filter((word) => word.trim() !== "").map((word) => word.toLowerCase());
  const findings = [];
  text.split("\n").forEach((line, i) => {
    for (const { kind, pattern } of RULES) {
      for (const match of line.matchAll(pattern)) findings.push({ kind, line: i + 1, excerpt: match[0] });
    }
    const named = findings.filter((finding) => finding.line === i + 1).map(({ excerpt }) => excerpt);
    for (const hit of secretAssignments(line)) {
      if (!named.some((excerpt) => hit.excerpt.includes(excerpt))) findings.push({ ...hit, line: i + 1 });
    }
    for (const hit of [...emails(line, allowed), ...personalData(line)]) findings.push({ ...hit, line: i + 1 });
    for (const word of denied.filter((word) => line.toLowerCase().includes(word))) findings.push({ kind: "denylisted", line: i + 1, excerpt: word });
  });
  return findings;
}

// .env and .env.<anything>, except the committed templates of one.
const ENV_FILE = /(?:^|\/)\.env(?:\.(?!(?:example|sample|template|dist|defaults)$)[\w.-]+)?$/;

// The hits in a unified diff's added lines, each with the file it lands in, and each .env file the diff adds or changes.
export function scanDiff(diff, options = {}) {
  const findings = [];
  let file = null;
  for (const line of diff.split("\n")) {
    const target = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (target !== null) {
      file = target[1] === "/dev/null" ? null : target[1];
      if (file !== null && ENV_FILE.test(file)) findings.push({ kind: "env-file", file, excerpt: file });
    } else if (line.startsWith("+")) {
      findings.push(...scanText(line.slice(1), options).map(({ kind, excerpt }) => ({ kind, file, excerpt })));
    }
  }
  return findings;
}

// What a stop message may show of a hit: a value that leaks keeps only its first four characters. The human's own deny-list
// word and a file name are no secret.
const SHOWN_IN_FULL = ["denylisted", "env-file"];
export const redacted = ({ kind, excerpt }) => (SHOWN_IN_FULL.includes(kind) ? excerpt : `${excerpt.slice(0, 4)}… (${excerpt.length} chars)`);
