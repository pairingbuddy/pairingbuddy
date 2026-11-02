// Finds real pb invocations in a Bash command by reading its shell structure: quoting, simple commands and
// the command word of each. This sees only the text: a script file or a line piped into sh hides its calls.
// Node built-ins only.
const SEPARATORS = new Set([";", "&", "|", "(", ")", "\n"]);
const REDIRECTS = new Set(["<", ">"]);
const KEYWORDS = new Set(["if", "then", "elif", "else", "while", "until", "do", "!", "{"]);
const WRAPPERS = new Set(["env", "command", "exec", "nohup", "time", "timeout", "nice", "sudo", "xargs", "node"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const PB_NAMES = new Set(["pb", "pb.mjs"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const WRAPPER_OPTION = /^(?:-.*|\d[\d.]*[smhd]?)$/;
const SHELL_C_FLAG = /^-[a-z]*c[a-z]*$/;
// What a shell drops from a word, which may sit between any two letters of the name.
const QUOTING = String.raw`(?:\\\n|['"\\])*`;
const NAME_START = String.raw`(?<![\w.-])`;
const NAME_END = String.raw`(?![\w./-])`;
const PB_FILE_LETTERS = ["\\.", "m", "j", "s"].join(QUOTING);
const PB_FILE_ANY_CASE = new RegExp(`${NAME_START}p${QUOTING}b${QUOTING}${PB_FILE_LETTERS}${NAME_END}`, "gi");
const PB_FILE_END = `${QUOTING}${PB_FILE_LETTERS}`;
// Either the whole file name or none of it, so the backslash in `pb\.mjs` cannot read as text after a bare pb.
const PB_THEN_EXPANSION = new RegExp(`${NAME_START}p${QUOTING}b(?:${PB_FILE_END}|(?!${PB_FILE_END}))${NAME_END}[^;|&\\n)]*[$\`{\\\\?*\\[]`);
const QUOTING_CHARACTERS = /\\\n|['"\\]/g;

const baseName = (word) => word.slice(word.lastIndexOf("/") + 1);

// The index just past the `)` that closes the substitution whose body starts at `start`.
function closingParen(text, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\" && quote !== "'") i += 1;
    else if (quote !== null) quote = char === quote ? null : quote;
    else if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && (depth -= 1) === 0) return i + 1;
  }
  return text.length;
}

function closingBacktick(text, start) {
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === "`") return i + 1;
  }
  return text.length;
}

// Splits text into simple commands of unquoted words, and collects the bodies of $(...) and backticks.
function parse(text) {
  const commands = [[]];
  const substitutions = [];
  let word = null;
  let quote = null;
  let dropNextWord = false;

  const endWord = () => {
    if (word !== null && !dropNextWord) commands.at(-1).push(word);
    if (word !== null) dropNextWord = false;
    word = null;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
    } else if (char === "\\") {
      i += 1;
      if (text[i] !== "\n") word = (word ?? "") + (text[i] ?? "");
    } else if (char === "$" && text[i + 1] === "(") {
      const end = closingParen(text, i + 2);
      substitutions.push(text.slice(i + 2, end - 1));
      word ??= "";
      i = end - 1;
    } else if (char === "`") {
      const end = closingBacktick(text, i + 1);
      substitutions.push(text.slice(i + 1, end - 1));
      word ??= "";
      i = end - 1;
    } else if (char === '"') {
      quote = quote === null ? '"' : null;
      word ??= "";
    } else if (quote === '"') {
      word += char;
    } else if (char === "'") {
      quote = "'";
      word ??= "";
    } else if (char === "$" && text[i + 1] === "'") {
      continue;
    } else if (char === " " || char === "\t") {
      endWord();
    } else if (REDIRECTS.has(char)) {
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      dropNextWord = true;
    } else if (SEPARATORS.has(char)) {
      endWord();
      dropNextWord = false;
      commands.push([]);
    } else {
      word = (word ?? "") + char;
    }
  }
  endWord();
  return { commands, substitutions };
}

// The words from the command word on, past assignments, keywords and wrappers that run what follows them.
function fromCommandWord(words) {
  let i = 0;
  while (i < words.length) {
    if (ASSIGNMENT.test(words[i]) || KEYWORDS.has(words[i])) {
      i += 1;
    } else if (WRAPPERS.has(baseName(words[i]))) {
      i += 1;
      while (i < words.length && (WRAPPER_OPTION.test(words[i]) || ASSIGNMENT.test(words[i]))) i += 1;
    } else {
      break;
    }
  }
  return words.slice(i);
}

// The command text that a shell or eval will parse again, or undefined for any other command.
function innerScript([head, ...rest]) {
  if (head === "eval") return rest.join(" ");
  if (!SHELLS.has(baseName(head))) return undefined;
  const flag = rest.findIndex((word) => SHELL_C_FLAG.test(word));
  return flag === -1 ? undefined : rest[flag + 1];
}

// True when xargs supplies a pb's words from its input, which no reading of the text can see.
function xargsFeedsPb(command) {
  const { commands, substitutions } = parse(command);
  const scripts = [...substitutions];
  for (const words of commands) {
    const run = fromCommandWord(words);
    if (run.length === 0) continue;
    const wrappers = words.slice(0, words.length - run.length);
    if (wrappers.some((word) => baseName(word) === "xargs") && run.some((word) => PB_NAMES.has(baseName(word)))) return true;
    const script = innerScript(run);
    if (script !== undefined) scripts.push(script);
  }
  return scripts.some(xargsFeedsPb);
}

// True for a pb name the literal readings cannot be trusted with, which may be a mere mention: text in the same simple
// command that the shell rewrites after the name, an xargs that feeds it, or a spelling of pb.mjs that only a case-insensitive filesystem finds.
// Every verb takes fixed words, so a real call needs neither.
export function disguisesPb(command) {
  if (PB_THEN_EXPANSION.test(command) || xargsFeedsPb(command)) return true;
  return [...command.matchAll(PB_FILE_ANY_CASE)].some(([name]) => name.replace(QUOTING_CHARACTERS, "") !== "pb.mjs");
}

// The words after each pb or pb.mjs that a shell would run, in a compound, a subshell, a substitution, `sh -c` or eval.
export function pbInvocations(command) {
  const { commands, substitutions } = parse(command);
  const scripts = [...substitutions];
  const calls = [];
  for (const words of commands.map(fromCommandWord).filter((words) => words.length > 0)) {
    if (PB_NAMES.has(baseName(words[0]))) calls.push(words.slice(1, 3));
    const script = innerScript(words);
    if (script !== undefined) scripts.push(script);
  }
  return [...calls, ...scripts.flatMap(pbInvocations)];
}
