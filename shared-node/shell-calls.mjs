// Finds real pb invocations in a Bash command by reading its shell structure: quoting, simple commands and
// the command word of each. This sees only the text: a script file or a line piped into sh hides its calls.
// Node built-ins only.
import { matchVerb } from "./verbs.mjs";

const SEPARATORS = new Set([";", "&", "|", "(", ")", "\n"]);
const REDIRECTS = new Set(["<", ">"]);
const KEYWORDS = new Set(["if", "then", "elif", "else", "while", "until", "do", "!", "{"]);
const WRAPPERS = new Set(["env", "command", "exec", "nohup", "time", "timeout", "nice", "sudo", "xargs", "node"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
// Commands whose arguments are text, so a word there is a mention and runs nothing.
const TEXT_COMMANDS = new Set(["echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "ack", "man"]);
// Commands that run a command string given with -c / --command, the way a shell does.
const COMMAND_STRING_RUNNERS = new Set(["script", "flock", "su"]);
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
// A word that names pb: its whole file name, or the name with shell syntax glued on where a file name would end.
const PB_WORD = /(?:^|\/)pb(\.mjs)?(?=$|[$`{?*[])/;

const baseName = (word) => word.slice(word.lastIndexOf("/") + 1);

// ---------- heredocs, ANSI-C quotes and arithmetic ----------

// The `<<` or `<<-` operator at text[i] (not `<<<`), with its delimiter word: quoted when any part of the word is quoted or
// escaped, since then the body is literal. end is the index just past the delimiter word. Null when no word follows.
function heredocOperator(text, i) {
  let j = i + 2;
  const strip = text[j] === "-";
  if (strip) j += 1;
  while (text[j] === " " || text[j] === "\t") j += 1;
  let delimiter = "";
  let quoted = false;
  for (; j < text.length; j += 1) {
    const char = text[j];
    if (char === "'" || char === '"') {
      quoted = true;
      const close = text.indexOf(char, j + 1);
      const limit = close === -1 ? text.length : close;
      delimiter += text.slice(j + 1, limit);
      j = limit;
    } else if (char === "\\") {
      quoted = true;
      delimiter += text[j + 1] ?? "";
      j += 1;
    } else if (/[\s;&|()<>]/.test(char)) {
      break;
    } else {
      delimiter += char;
    }
  }
  return delimiter === "" ? null : { delimiter, quoted, strip, end: j };
}

// `<<<` is a here-string, whose second and third `<` must not read as an operator either.
const startsHeredoc = (text, i) => text[i] === "<" && text[i + 1] === "<" && text[i + 2] !== "<" && text[i - 1] !== "<";

// Reads a heredoc body that starts at `from`, the first character of the line after the operator's line. body is the text up
// to the line holding only the delimiter (leading tabs ignored for <<-), and end is the index of the newline that ends that
// line, or the text length. A delimiter that never comes makes the rest of the text the body, as it does in a shell.
function heredocBody(text, from, { delimiter, strip }) {
  for (let lineStart = from; lineStart <= text.length; ) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = strip ? text.slice(lineStart, lineEnd).replace(/^\t+/, "") : text.slice(lineStart, lineEnd);
    if (line === delimiter) return { body: text.slice(from, lineStart), end: lineEnd };
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return { body: text.slice(from), end: text.length };
}

// Reads each pending heredoc body in order, from the character after the newline at `newline`. Returns where the last one
// ends and the bodies a shell expands (an unquoted delimiter), whose $(...) and backticks run.
function readHeredocBodies(text, newline, pending) {
  let from = newline + 1;
  let end = newline;
  const expanded = [];
  for (const operator of pending) {
    const read = heredocBody(text, from, operator);
    if (!operator.quoted) expanded.push(read.body);
    end = read.end;
    from = read.end + 1;
  }
  return { end, expanded };
}

const SIMPLE_ESCAPES = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };

// One ANSI-C escape whose backslash is at text[i]: its character and the index of its last source character.
function ansiEscape(text, i) {
  const next = text[i + 1] ?? "";
  if (Object.hasOwn(SIMPLE_ESCAPES, next)) return { value: SIMPLE_ESCAPES[next], last: i + 1 };
  const numeric = { x: /^[0-9a-fA-F]{1,2}/, u: /^[0-9a-fA-F]{1,4}/, U: /^[0-9a-fA-F]{1,8}/ }[next];
  if (numeric !== undefined) {
    const digits = numeric.exec(text.slice(i + 2, i + 10))?.[0];
    if (digits !== undefined) return { value: String.fromCodePoint(Number.parseInt(digits, 16)), last: i + 1 + digits.length };
  }
  const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4))?.[0];
  if (octal !== undefined) return { value: String.fromCharCode(Number.parseInt(octal, 8) & 0xff), last: i + octal.length };
  if (next === "c" && text[i + 2] !== undefined) return { value: String.fromCharCode(text[i + 2].charCodeAt(0) & 0x1f), last: i + 2 };
  return { value: `\\${next}`, last: i + 1 };
}

// A $'...' string whose body starts at `start`: a backslash escapes the next character, so only an unescaped ' closes it.
// value is the decoded text; end is the index of the closing quote, or the text length.
function ansiCQuote(text, start) {
  let value = "";
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "'") return { value, end: i };
    if (text[i] === "\\") {
      const escape = ansiEscape(text, i);
      value += escape.value;
      i = escape.last;
    } else {
      value += text[i];
    }
  }
  return { value, end: text.length };
}

// The index just past the `))` of an arithmetic `((...))` whose first paren is at text[open], or -1 when the two parens are
// not one pair (a subshell inside a subshell). Arithmetic holds `<<` as a shift, never as a heredoc.
function arithmeticEnd(text, open) {
  if (text[open] !== "(" || text[open + 1] !== "(") return -1;
  const end = closingParen(text, open + 1, false);
  const body = text.slice(open + 1, end - 1);
  return body.endsWith(")") && closingParen(body, 1, false) === body.length ? end : -1;
}

// The bodies of the $(...) and backticks inside text a shell expands.
function expansionsIn(text) {
  const bodies = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
    } else if (text[i] === "$" && text[i + 1] === "(") {
      const end = closingParen(text, i + 2);
      bodies.push(text.slice(i + 2, end - 1));
      i = end - 1;
    } else if (text[i] === "`") {
      const end = closingBacktick(text, i + 1);
      bodies.push(text.slice(i + 1, end - 1));
      i = end - 1;
    }
  }
  return bodies;
}

// The index just past the `)` that closes the substitution whose body starts at `start`. Quotes, $'...' strings, arithmetic
// and heredoc bodies are skipped as a shell reads them, so an apostrophe in a commit message does not open a quote.
function closingParen(text, start, heredocs = true) {
  let depth = 1;
  let quote = null;
  const pending = [];
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = null;
    } else if (quote === "$'") {
      if (char === "\\") i += 1;
      else if (char === "'") quote = null;
    } else if (char === "\\") {
      i += 1;
    } else if (char === "$" && text[i + 1] === "(") {
      const arithmetic = text[i + 2] === "(" ? arithmeticEnd(text, i + 1) : -1;
      i = (arithmetic === -1 ? closingParen(text, i + 2, heredocs) : arithmetic) - 1;
    } else if (char === "`") {
      i = closingBacktick(text, i + 1) - 1;
    } else if (quote === '"') {
      if (char === '"') quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "$" && text[i + 1] === "'") {
      quote = "$'";
      i += 1;
    } else if (heredocs && startsHeredoc(text, i)) {
      const operator = heredocOperator(text, i);
      if (operator !== null) {
        pending.push(operator);
        i = operator.end - 1;
      }
    } else if (char === "\n" && pending.length > 0) {
      i = readHeredocBodies(text, i, pending.splice(0)).end;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")" && (depth -= 1) === 0) {
      return i + 1;
    }
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

// Splits text into simple commands of unquoted words, and collects the bodies of $(...) and backticks. spans says where
// each command's words sit in the text, and where the command ends, since the words alone have lost their quoting.
function parse(text) {
  const commands = [[]];
  const spans = [{ words: [], end: text.length }];
  const substitutions = [];
  let word = null;
  let wordStart = 0;
  let quote = null;
  let dropNextWord = false;
  let i = 0;
  // Heredocs opened on the current line, whose bodies start after its newline.
  const pending = [];

  const endWord = () => {
    if (word !== null && !dropNextWord) {
      commands.at(-1).push(word);
      spans.at(-1).words.push({ start: wordStart, end: i });
    }
    if (word !== null) dropNextWord = false;
    word = null;
  };

  for (; i < text.length; i += 1) {
    const char = text[i];
    if (word === null) wordStart = i;
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
    } else if (char === "\\") {
      i += 1;
      if (text[i] !== "\n") word = (word ?? "") + (text[i] ?? "");
    } else if (char === "$" && text[i + 1] === "(") {
      const arithmetic = arithmeticEnd(text, i + 1);
      const end = arithmetic === -1 ? closingParen(text, i + 2) : arithmetic;
      if (arithmetic === -1) substitutions.push(text.slice(i + 2, end - 1));
      else substitutions.push(...expansionsIn(text.slice(i + 3, end - 2)));
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
    } else if (char === "#" && word === null) {
      while (i + 1 < text.length && text[i + 1] !== "\n") i += 1;
    } else if (char === "'") {
      quote = "'";
      word ??= "";
    } else if (char === "$" && text[i + 1] === "'") {
      const ansi = ansiCQuote(text, i + 2);
      word = (word ?? "") + ansi.value;
      i = ansi.end;
    } else if (char === "(" && word === null && arithmeticEnd(text, i) !== -1) {
      const end = arithmeticEnd(text, i);
      substitutions.push(...expansionsIn(text.slice(i + 2, end - 2)));
      i = end - 1;
    } else if (char === " " || char === "\t") {
      endWord();
    } else if (startsHeredoc(text, i) && heredocOperator(text, i) !== null) {
      const operator = heredocOperator(text, i);
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      pending.push(operator);
      i = operator.end - 1;
    } else if (REDIRECTS.has(char)) {
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      dropNextWord = true;
    } else if (SEPARATORS.has(char)) {
      endWord();
      dropNextWord = false;
      spans.at(-1).end = i;
      commands.push([]);
      spans.push({ words: [], end: text.length });
      if (char === "\n" && pending.length > 0) {
        const bodies = readHeredocBodies(text, i, pending.splice(0));
        substitutions.push(...bodies.expanded.flatMap(expansionsIn));
        i = bodies.end;
      }
    } else {
      word = (word ?? "") + char;
    }
  }
  endWord();
  return { commands, spans, substitutions };
}

// The words from the command word on, past assignments, keywords and wrappers that run what follows them.
function fromCommandWord(words) {
  let i = 0;
  while (i < words.length) {
    if (ASSIGNMENT.test(words[i]) || KEYWORDS.has(words[i])) {
      i += 1;
    } else if (WRAPPERS.has(baseName(words[i]))) {
      const isEnv = baseName(words[i]) === "env";
      i += 1;
      while (i < words.length && !(isEnv && ENV_SPLIT.test(words[i])) && (WRAPPER_OPTION.test(words[i]) || ASSIGNMENT.test(words[i]))) i += 1;
    } else {
      break;
    }
  }
  return words.slice(i);
}

const ENV_SPLIT = /^(?:-[A-Za-z]*S|--split-string(?:=|$))/;

// The string env -S (--split-string) splits into a command line, glued to the option or the next word. fromCommandWord
// leaves the run starting at that option, since what follows is text to parse again, not a command word.
function envSplitString([option, next]) {
  if (!ENV_SPLIT.test(option ?? "")) return undefined;
  if (option.startsWith("--split-string")) return option.length > "--split-string".length ? option.slice("--split-string=".length) : next;
  return option.slice(option.indexOf("S") + 1) || next;
}

// The string after -c or --command of a command that runs it through a shell, or undefined.
function commandStringOf(words) {
  const flag = words.findIndex((word) => SHELL_C_FLAG.test(word) || /^--command(?:=|$)/.test(word));
  if (flag === -1) return undefined;
  if (!words[flag].startsWith("--command")) return words[flag + 1];
  return words[flag].includes("=") ? words[flag].slice("--command=".length) : words[flag + 1];
}

// The command text git itself runs: the -x/--exec of a rebase, `bisect run` and `submodule foreach`. undefined for any other
// git call, or when git is not among the words.
function gitCommandString(run) {
  const git = run.findIndex((word) => baseName(word) === "git");
  if (git === -1) return undefined;
  const args = run.slice(git + 1);
  const rebase = args.indexOf("rebase");
  if (rebase !== -1) {
    for (let i = rebase + 1; i < args.length; i += 1) {
      if (args[i] === "--exec" || /^-[A-Za-z]*x$/.test(args[i])) return args[i + 1];
      if (args[i].startsWith("--exec=")) return args[i].slice("--exec=".length);
      if (/^-x./.test(args[i])) return args[i].slice(2);
    }
  }
  const bisect = args.indexOf("bisect");
  if (bisect !== -1 && args[bisect + 1] === "run") return args.slice(bisect + 2).join(" ");
  const submodule = args.indexOf("submodule");
  const foreach = submodule === -1 ? -1 : args.indexOf("foreach", submodule);
  return foreach === -1 ? undefined : args.slice(foreach + 1).join(" ");
}

// The command text that a shell or eval will parse again, or undefined for any other command. The shell can sit in any
// position, since a wrapper this file does not know, or `find -exec`, runs the rest of its words.
function innerScript(run) {
  const [head, ...rest] = run;
  if (head === "eval") return rest.join(" ");
  if (TEXT_COMMANDS.has(baseName(head))) return undefined;
  const split = envSplitString(run);
  if (split !== undefined) return split;
  if (baseName(head) === "watch") return rest.join(" ");
  if (COMMAND_STRING_RUNNERS.has(baseName(head))) return commandStringOf(rest);
  const gitString = gitCommandString(run);
  if (gitString !== undefined) return gitString;
  const shell = run.findIndex((word) => SHELLS.has(baseName(word)));
  if (shell === -1) return undefined;
  const flag = run.slice(shell + 1).findIndex((word) => SHELL_C_FLAG.test(word));
  return flag === -1 ? undefined : run[shell + flag + 2];
}

// True when any simple command a shell would run matches, in a compound, a substitution, `sh -c` or eval.
function anySimpleCommand(command, matches) {
  const { commands, spans, substitutions } = parse(command);
  const scripts = [...substitutions];
  for (const [index, words] of commands.entries()) {
    const run = fromCommandWord(words);
    if (matches({ text: command, words, run, span: spans[index] })) return true;
    const script = run.length === 0 ? undefined : innerScript(run);
    if (script !== undefined) scripts.push(script);
  }
  return scripts.some((script) => anySimpleCommand(script, matches));
}

// True when xargs supplies a pb's words from its input, which no reading of the text can see.
function xargsFeedsPb({ words, run }) {
  const wrappers = words.slice(0, words.length - run.length);
  return wrappers.some((word) => baseName(word) === "xargs") && run.some((word) => PB_NAMES.has(baseName(word)));
}

// A bare pb counts only where a shell would run it, past the wrappers fromCommandWord knows, so a word in a list or a
// search pattern is left alone. pb.mjs counts anywhere, since no list of wrappers is complete: `sudo -u me node cli/pb.mjs`
// runs it. The arguments of a text command run nothing, so there a quoted pattern is left alone too.
function canRunPb({ text, words, run, span }, index, isFileName) {
  if (index === words.length - run.length) return true;
  if (!isFileName) return false;
  const { start, end } = span.words[index];
  return !TEXT_COMMANDS.has(baseName(run[0] ?? "")) || text.slice(start, end) === words[index];
}

// True when the shell rewrites text at or after a pb name in the same simple command.
function rewritesPbWords(simple) {
  return simple.words.some((word, index) => {
    const name = PB_WORD.exec(word);
    if (name === null || !canRunPb(simple, index, name[1] !== undefined)) return false;
    return PB_THEN_EXPANSION.test(simple.text.slice(simple.span.words[index].start, simple.span.end));
  });
}

// True for a pb name the literal readings cannot be trusted with: text the shell rewrites after it, an xargs that feeds
// it, or a spelling of pb.mjs that only a case-insensitive filesystem finds. Every verb takes fixed words, so a real
// call needs none of them.
export function disguisesPb(command) {
  if (anySimpleCommand(command, (simple) => rewritesPbWords(simple) || xargsFeedsPb(simple))) return true;
  return [...command.matchAll(PB_FILE_ANY_CASE)].some(([name]) => name.replace(QUOTING_CHARACTERS, "") !== "pb.mjs");
}

const isPbName = (word) => PB_NAMES.has(baseName(word));

// Where pb runs in a simple command: as its command word, or anywhere else when a known verb follows the name, since
// no list of wrappers is complete. Each is {before, after}, the words on either side of the name.
function callsIn(words) {
  const run = fromCommandWord(words);
  if (run.length === 0) return [];
  const start = words.length - run.length;
  const isCall = (word, i) => {
    if (!isPbName(word)) return false;
    return i === start || (!TEXT_COMMANDS.has(baseName(run[0])) && i > start && matchVerb(words.slice(i + 1, i + 3)) !== undefined);
  };
  return words.flatMap((word, i) => (isCall(word, i) ? [{ before: words.slice(0, i), name: word, after: words.slice(i + 1, i + 3), rest: words.slice(i + 1) }] : []));
}

// Every call a shell would make, in a compound, a subshell, a substitution, `sh -c` or eval.
function pbCalls(command) {
  const { commands, substitutions } = parse(command);
  const scripts = [...substitutions];
  for (const run of commands.map(fromCommandWord).filter((words) => words.length > 0)) {
    const script = innerScript(run);
    if (script !== undefined) scripts.push(script);
  }
  return [...commands.flatMap(callsIn), ...scripts.flatMap(pbCalls)];
}

// The words after each pb or pb.mjs that a shell would run.
export const pbInvocations = (command) => pbCalls(command).map(({ after }) => after);

const setsEnvironment = (word) => ASSIGNMENT.test(word) || baseName(word) === "env";

// True when a pb call runs under an assignment or the env command in its own simple command.
export const pbWithEnvironment = (command) => pbCalls(command).some(({ before }) => before.some(setsEnvironment));

// Each bare `unit open` call as {name, rest}: the pb word as written and every word after it.
export const pbUnitOpenCalls = (command) => pbCalls(command).filter(({ after }) => matchVerb(after) === "unit open");

// Every simple command a shell would run, in a compound, a subshell, a substitution, `sh -c` or eval, in order. cd is the
// directory a `cd` earlier in the text named (as written), or undefined. The reading is the one pb calls get.
function simpleCommandsOf(command, cd) {
  const { commands, substitutions } = parse(command);
  const scripts = [...substitutions];
  const found = [];
  let lastCd = cd;
  for (const words of commands) {
    const run = fromCommandWord(words);
    if (run.length === 0) continue;
    found.push({ words, run, cd: lastCd });
    if (run[0] === "cd" || run[0] === "pushd") lastCd = run.slice(1).find((word) => !(word.startsWith("-") && word.length > 1)) ?? "~";
    const script = innerScript(run);
    if (script !== undefined) scripts.push(script);
  }
  return [...found, ...scripts.flatMap((script) => simpleCommandsOf(script, lastCd))];
}

// Each call of a command named in names (git, gh) that a shell would run, as {name, before, rest, atCommandWord, cd}: the
// words before and after the name, and the directory of the last `cd` before it. Off the command word, a name counts only
// when recognizes(name, rest) says a known verb follows, since no list of wrappers is complete, and never as the argument
// of a text command, which runs nothing.
export function toolCalls(command, names, recognizes) {
  return simpleCommandsOf(command, undefined).flatMap(({ words, run, cd }) => {
    const start = words.length - run.length;
    return words.flatMap((word, i) => {
      const name = baseName(word);
      if (!names.includes(name)) return [];
      const rest = words.slice(i + 1);
      const atCommandWord = i === start;
      const counts = atCommandWord || (i > start && !TEXT_COMMANDS.has(baseName(run[0])) && recognizes(name, rest));
      return counts ? [{ name, before: words.slice(0, i), rest, atCommandWord, cd }] : [];
    });
  });
}
