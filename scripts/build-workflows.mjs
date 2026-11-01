import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const fail = (message) => {
  console.error(`build-workflows: ${message}`);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      root: { type: 'string' },
      src: { type: 'string' },
      out: { type: 'string' },
      check: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch (error) {
  fail(error.message);
}

const root = values.root ?? fileURLToPath(new URL('..', import.meta.url));
const src = values.src ?? join(root, 'workflows-src');
const out = values.out ?? join(root, 'workflows');

// Wrong explicit inputs would yield no outputs and prune --out, so they fail up front.
if (values.root !== undefined && !existsSync(root)) fail(`--root ${root} does not exist`);
if (values.src !== undefined && !existsSync(join(src, 'stages'))) {
  fail(`--src ${src} has no stages directory`);
}

const listModules = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.mjs'))
        .sort()
    : [];

const stagesDir = join(src, 'stages');
const stageFiles = listModules(stagesDir);

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const SINGLE_LINE_STRING = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
const DYNAMIC_IMPORT = /(?<![.\w])import\s*\(/;

// Compiles source without running it, so import/export and other syntax errors name the file.
const compile = (source, path) => {
  try {
    new AsyncFunction('args', source);
  } catch (error) {
    fail(`${path}: ${error.message}`);
  }
};

// The parser accepts dynamic import(), but a workflow script cannot load modules.
const rejectDynamicImport = (source, path) => {
  if (DYNAMIC_IMPORT.test(source.replace(SINGLE_LINE_STRING, "''"))) {
    fail(`${path}: dynamic import() is not allowed in bundled source`);
  }
};

const INLINE_PREFIX = /^\s*\/\/ pb-inline.*$/m;

// Only a stage may declare JSON, so any directive left in the source is misplaced or malformed.
const rejectInlineDirective = (source, path) => {
  const directive = source.match(INLINE_PREFIX);
  if (directive) {
    fail(`${path}: misplaced or malformed pb-inline directive "${directive[0].trim()}" (expected "// pb-inline NAME PATH" at the top level of a stage)`);
  }
};

const sharedDir = join(src, 'shared');
const sharedCode = listModules(sharedDir)
  .map((name) => {
    const path = join(sharedDir, name);
    const source = readFileSync(path, 'utf8');
    compile(source, path);
    rejectDynamicImport(source, path);
    rejectInlineDirective(source, path);
    return source.trim();
  })
  .join('\n\n');

const META_START = 'export const meta = {';
const META_END = '};';
const INLINE_DIRECTIVE = /^\/\/ pb-inline (\w+) (\S+)[ \t]*$\n?/gm;

// Offset just past the meta statement, or -1 if its boundary is not found.
const findMetaEnd = (stageSource) => {
  const lines = stageSource.split('\n');
  const first = lines[0];
  if (!first.startsWith(META_START)) return -1;
  if (first.trimEnd().endsWith(META_END)) return first.trimEnd().length;

  let offset = lines[0].length + 1;
  for (const line of lines.slice(1)) {
    if (line === META_END) return offset + META_END.length;
    offset += line.length + 1;
  }
  return -1;
};

// Reads and minifies a declared JSON file, failing cleanly when it is missing or invalid.
const readJson = (path, file) => {
  try {
    return JSON.stringify(JSON.parse(readFileSync(join(root, path), 'utf8')));
  } catch (error) {
    fail(`${join(stagesDir, file)}: cannot inline "${path}": ${error.message}`);
  }
};

// Replaces each "// pb-inline NAME PATH" line with a JSON constant declaration.
const extractInlineJson = (source, file) => {
  const declarations = [...source.matchAll(INLINE_DIRECTIVE)].map(([, name, path]) => {
    return `const ${name} = ${readJson(path, file)};`;
  });
  const body = source.replace(INLINE_DIRECTIVE, '').replace(/^\n+/, '');
  rejectInlineDirective(body, join(stagesDir, file));
  return { declarations, body };
};

const GUARD = 'if (args === undefined) return { started: false };';

const bundle = (stageSource, file) => {
  const metaEnd = findMetaEnd(stageSource);
  if (metaEnd === -1) {
    fail(`${join(stagesDir, file)}: cannot find the meta statement (must start with "${META_START}" and end with "${META_END}")`);
  }
  const meta = stageSource.slice(0, metaEnd);
  const { declarations, body } = extractInlineJson(stageSource.slice(metaEnd), file);
  const path = join(stagesDir, file);
  compile(body, path);
  rejectDynamicImport(body, path);
  const bundled = [meta, GUARD, declarations.join('\n'), sharedCode, body].filter(Boolean).join('\n\n');
  compile(bundled.replace(META_START, 'const meta = {'), path);
  return bundled;
};

const outputs = stageFiles.map((file) => ({
  name: file.replace(/\.mjs$/, '.js'),
  content: bundle(readFileSync(join(stagesDir, file), 'utf8'), file),
}));

const writeOutputs = (dir) => {
  mkdirSync(dir, { recursive: true });
  for (const { name, content } of outputs) {
    writeFileSync(join(dir, name), content);
  }
};

const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

// Only files the bundler built are pruned; --check reports anything else as extra.
const isBuiltFile = (dir, name) => {
  if (!name.endsWith('.js')) return false;
  const path = join(dir, name);
  if (!statSync(path).isFile()) return false;
  const content = readFileSync(path, 'utf8');
  return content.startsWith(META_START) && content.includes(GUARD);
};

const pruneStale = (dir) => {
  const produced = new Set(outputs.map(({ name }) => name));
  for (const name of listFiles(dir)) {
    if (!produced.has(name) && isBuiltFile(dir, name)) rmSync(join(dir, name));
  }
};

// Names of files that differ, are only in one directory, or are missing from the other.
const findDrift = (expectedDir, actualDir) => {
  const names = [...new Set([...listFiles(expectedDir), ...listFiles(actualDir)])].sort();
  return names.flatMap((name) => {
    const expected = join(expectedDir, name);
    const actual = join(actualDir, name);
    if (!existsSync(actual)) return [`missing: ${name}`];
    if (!existsSync(expected)) return [`extra: ${name}`];
    return readFileSync(expected).equals(readFileSync(actual)) ? [] : [`differs: ${name}`];
  });
};

const checkSync = () => {
  const scratch = mkdtempSync(join(tmpdir(), 'build-workflows-'));
  try {
    writeOutputs(scratch);
    const drift = findDrift(scratch, out);
    if (drift.length > 0) {
      console.error(`build-workflows: ${out} is out of sync with ${src}`);
      for (const line of drift) console.error(`  ${line}`);
      process.exitCode = 1;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

if (values.check) {
  checkSync();
} else {
  writeOutputs(out);
  pruneStale(out);
}
