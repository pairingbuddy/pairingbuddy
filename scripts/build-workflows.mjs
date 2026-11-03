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
const sharedSources = listModules(sharedDir).map((name) => {
  const path = join(sharedDir, name);
  const source = readFileSync(path, 'utf8');
  compile(source, path);
  rejectDynamicImport(source, path);
  rejectInlineDirective(source, path);
  return { path, source: source.trim() };
});
const sharedCode = sharedSources.map(({ source }) => source).join('\n\n');

const TOP_LEVEL_NAME = /^(?:(?:async\s+)?function\*?\s*([\w$]+)|(?:const|let|var|class)\s+([\w$]+))/gm;

// A repeated function declaration compiles and the last one silently wins, so names are compared
// across every source that ends up in one built script.
const rejectDuplicateNames = (sources) => {
  const owners = new Map();
  for (const { path, source } of sources) {
    for (const [, functionName, otherName] of source.matchAll(TOP_LEVEL_NAME)) {
      const name = functionName ?? otherName;
      if (owners.has(name)) fail(`duplicate top-level name "${name}" in ${owners.get(name)} and ${path}`);
      owners.set(name, path);
    }
  }
};

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

const MODULE_DIRECTIVE = /^\/\/ pb-inline-module (\S+)[ \t]*$\n?/gm;
const NON_DECLARATION_EXPORT = /^export\s*[{*]/m;

// Reads a shared-node module for inlining: "export " is stripped from line starts, so the module
// must compile as a plain function body (no import, no remaining export statement).
const readModule = (path, file) => {
  const modulePath = join(root, path);
  let source;
  try {
    source = readFileSync(modulePath, 'utf8');
  } catch (error) {
    fail(`${join(stagesDir, file)}: cannot inline module "${path}": ${error.message}`);
  }
  // Stripping "export " from these would leave code that can still compile, such as a bare block.
  if (NON_DECLARATION_EXPORT.test(source)) {
    fail(`${modulePath}: export must prefix a declaration, "export {" and "export *" cannot be inlined`);
  }
  const inlined = source.replace(/^export /gm, '').trim();
  compile(inlined, modulePath);
  rejectDynamicImport(inlined, modulePath);
  return { path: modulePath, source: inlined };
};

// Replaces each "// pb-inline NAME PATH" line with a JSON constant declaration, and each
// "// pb-inline-module PATH" line with the module's source (export stripped, each module once).
const extractInlineSources = (source, file) => {
  const seen = new Set();
  const modules = [...source.matchAll(MODULE_DIRECTIVE)].map(([, path]) => {
    if (seen.has(path)) fail(`${join(stagesDir, file)}: module "${path}" is inlined more than once`);
    seen.add(path);
    return readModule(path, file);
  });
  const withoutModules = source.replace(MODULE_DIRECTIVE, '');
  const declarations = [...withoutModules.matchAll(INLINE_DIRECTIVE)].map(([, name, path]) => {
    return `const ${name} = ${readJson(path, file)};`;
  });
  const body = withoutModules.replace(INLINE_DIRECTIVE, '').replace(/^\n+/, '');
  rejectInlineDirective(body, join(stagesDir, file));
  return { declarations, modules, body };
};

const GUARD = 'if (args === undefined) return { started: false };';

const bundle = (stageSource, file) => {
  const metaEnd = findMetaEnd(stageSource);
  if (metaEnd === -1) {
    fail(`${join(stagesDir, file)}: cannot find the meta statement (must start with "${META_START}" and end with "${META_END}")`);
  }
  const meta = stageSource.slice(0, metaEnd);
  const { declarations, modules, body } = extractInlineSources(stageSource.slice(metaEnd), file);
  const path = join(stagesDir, file);
  compile(body, path);
  rejectDynamicImport(body, path);
  rejectDuplicateNames([...sharedSources, ...modules, { path, source: [...declarations, body].join('\n') }]);
  const moduleCode = modules.map(({ source }) => source).join('\n\n');
  const bundled = [meta, GUARD, declarations.join('\n'), sharedCode, moduleCode, body].filter(Boolean).join('\n\n');
  compile(bundled.replace(META_START, 'const meta = {'), path);
  return bundled;
};

const outputs = stageFiles.map((file) => ({
  name: file.replace(/\.mjs$/, '.js'),
  content: bundle(readFileSync(join(stagesDir, file), 'utf8'), file),
}));

// The kit loads only code files, so the mod cannot import contracts/stages.json: a generated .ts copy stands in.
// It is built only for a root that has the contract.
const contractPath = join(root, 'contracts', 'stages.json');
const modContractPath = join(root, 'mod', 'stages-contract.ts');
const modContract = existsSync(contractPath)
  ? [
      '// Generated from contracts/stages.json by scripts/build-workflows.mjs. Do not edit: run that script to regenerate.',
      `export default ${JSON.stringify(JSON.parse(readFileSync(contractPath, 'utf8')), null, 2)}`,
      '',
    ].join('\n')
  : undefined;

const writeModContract = () => {
  if (modContract === undefined) return;
  mkdirSync(join(root, 'mod'), { recursive: true });
  writeFileSync(modContractPath, modContract);
};

// A line naming the mod contract when it is missing or differs, else none.
const findModContractDrift = () => {
  if (modContract === undefined) return [];
  if (!existsSync(modContractPath)) return ['missing: mod/stages-contract.ts'];
  return readFileSync(modContractPath, 'utf8') === modContract ? [] : ['differs: mod/stages-contract.ts'];
};

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
    const drift = [...findDrift(scratch, out), ...findModContractDrift()];
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
  writeModContract();
}
