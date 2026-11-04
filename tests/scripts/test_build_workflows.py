"""Tests for the workflow bundler (scripts/build-workflows.mjs).

Covers scenarios bundle-builds-self-contained-script, build-is-reproducible and
bare-invocation-returns-not-started. The tests call node via subprocess against a
fixture source tree under tests/fixtures/ built into tmp_path.
"""

import json
import re
from pathlib import Path

import pytest

from tests.scripts.bundler_helpers import (
    BUILD_SCRIPT,
    FIXTURE_ROOT,
    REPO_ROOT,
    assert_clean_failure,
    assert_nothing_written,
    build_ok,
    run_build,
    run_node,
)


def build_trivial_stage(fixture_tree, out):
    """Build the fixture tree, assert the build succeeded, and return the path of trivial.js."""
    build_ok(fixture_tree, out)
    return out / "trivial.js"


def test_trivial_stage_emits_one_file(fixture_tree, tmp_path):
    out = tmp_path / "out"

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert result.returncode == 0, result.stderr
    assert [p.name for p in out.iterdir()] == ["trivial.js"], "one output file per stage"


def test_built_file_has_no_imports_and_starts_with_meta(fixture_tree, tmp_path):
    out = tmp_path / "out"

    built = build_trivial_stage(fixture_tree, out).read_text()

    assert built.startswith("export const meta = {"), "meta must be the first statement"
    assert not re.search(r"^\s*import\b", built, re.MULTILINE), "built file must contain no import"


def test_built_file_contains_shared_code(fixture_tree, tmp_path):
    out = tmp_path / "out"
    shared_source = (fixture_tree / "workflows-src" / "shared" / "greet.mjs").read_text()

    built = build_trivial_stage(fixture_tree, out).read_text()

    assert shared_source.strip() in built, "shared code must be inlined into the built file"


def test_built_file_inlines_declared_json(fixture_tree, tmp_path):
    out = tmp_path / "out"
    declared = {"answer": 42}
    (fixture_tree / "data" / "answer.json").write_text(json.dumps(declared))
    shared_source = (fixture_tree / "workflows-src" / "shared" / "greet.mjs").read_text()

    built = build_trivial_stage(fixture_tree, out).read_text()

    match = re.search(r"^const ANSWER = (.*);$", built, re.MULTILINE)
    assert match, "declared JSON must appear as a const named ANSWER"
    assert json.loads(match.group(1)) == declared, "inlined value must equal the declared file"
    assert "pb-inline" not in built, "the pb-inline directive line must be removed from the output"
    assert (
        built.index("if (args === undefined)") < match.start() < built.index(shared_source.strip())
    ), "the constant must sit after the meta and guard and before the shared code"


def test_build_fails_when_declared_json_missing(fixture_tree, tmp_path):
    out = tmp_path / "out"
    stage = fixture_tree / "workflows-src" / "stages" / "trivial.mjs"
    stage.write_text(stage.read_text() + "\n// pb-inline MISSING data/missing.json\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "trivial.mjs")
    assert "data/missing.json" in result.stderr, "the message must name the missing path"
    assert_nothing_written(out)


def test_rebuild_matches_golden_output(fixture_tree, tmp_path):
    # test_case_id: rebuild-gives-identical-bytes
    out = tmp_path / "out"
    golden = FIXTURE_ROOT / "expected" / "trivial.js"

    built = build_trivial_stage(fixture_tree, out)

    assert built.read_bytes() == golden.read_bytes(), (
        "built output must equal the committed golden file (paths, dates and shared-file order)"
    )


BARE_INVOCATION_RUNNER = """
const { readFileSync } = require('node:fs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const body = readFileSync(process.argv[1], 'utf8').replace(/^export /gm, '');
const agent = () => { throw new Error('agent called during a bare invocation'); };
new AsyncFunction('args', 'agent', body)(undefined, agent)
  .then((result) => console.log(JSON.stringify(result)));
"""


def run_bare_invocation(script):
    """Run a built script under node as a bare invocation: args undefined, agent throws."""
    return run_node(["-e", BARE_INVOCATION_RUNNER, script])


def test_every_built_script_returns_started_false(fixture_tree, tmp_path):
    # test_case_id: every-built-script-returns-started-false
    out = tmp_path / "out"
    build_trivial_stage(fixture_tree, out)
    committed = sorted((REPO_ROOT / "workflows").glob("*.js"))
    scripts = sorted(out.glob("*.js")) + committed

    results = {script.name: run_bare_invocation(script) for script in scripts}

    for name, result in results.items():
        assert result.returncode == 0, f"{name} did not run cleanly: {result.stderr}"
        assert json.loads(result.stdout) == {"started": False}, (
            f"{name} must return {{started: false}} before touching agent"
        )


FORBIDDEN_SOURCE = [
    pytest.param("stages/trivial.mjs", "import x from 'y';", id="import-in-stage"),
    pytest.param("shared/greet.mjs", "import x from 'y';", id="import-in-shared"),
    pytest.param(
        "stages/trivial.mjs", "const m = await import('y');", id="dynamic-import-in-stage"
    ),
    pytest.param("shared/greet.mjs", "export function foo() {}", id="export-in-shared"),
    pytest.param("stages/trivial.mjs", "import{x} from 'y';", id="braced-import-without-space"),
    pytest.param(
        "stages/trivial.mjs", "const a = 1;\nexport{a};", id="braced-export-without-space"
    ),
    pytest.param("stages/trivial.mjs", "const a = 1; import x from 'y';", id="mid-line-import"),
    pytest.param("stages/trivial.mjs", "const u = import.meta.url;", id="import-meta"),
]


@pytest.mark.parametrize("relative_path, offending_line", FORBIDDEN_SOURCE)
def test_build_refuses_import_in_source(fixture_tree, tmp_path, relative_path, offending_line):
    # test_case_id: build-refuses-import-in-source
    out = tmp_path / "out"
    offender = fixture_tree / "workflows-src" / relative_path
    offender.write_text(offender.read_text() + "\n" + offending_line + "\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, Path(relative_path).name)
    assert_nothing_written(out)


LEGAL_SOURCE = [
    pytest.param("const note = 'import x from y';", id="import-in-string"),
    pytest.param("const note = 'call import(y) later';", id="dynamic-import-in-string"),
    pytest.param("const note = `\nimport the data\n`;", id="import-line-in-template-literal"),
    pytest.param("/*\nexport notes\n*/", id="export-line-in-block-comment"),
    pytest.param("const a = { import: (n) => n };\na.import(1);", id="import-method-call"),
]


@pytest.mark.parametrize("line", LEGAL_SOURCE)
def test_build_accepts_legal_source_mentioning_import_or_export(fixture_tree, tmp_path, line):
    # test_case_id: build-refuses-import-in-source
    out = tmp_path / "out"
    stage = fixture_tree / "workflows-src" / "stages" / "trivial.mjs"
    stage.write_text(stage.read_text() + "\n" + line + "\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert result.returncode == 0, result.stderr
    assert (out / "trivial.js").exists(), "legal source must still build"


BAD_META_STAGES = [
    pytest.param("const x = 1;\n", id="no-meta"),
    pytest.param("const x = 1;\nexport const meta = { name: 'trivial' };\n", id="code-before-meta"),
    pytest.param(
        "export const meta = {\n  name: 'trivial',\n  extra: 1,\nconst x = 1;\n",
        id="unclosed-multiline-meta",
    ),
]


@pytest.mark.parametrize("stage_source", BAD_META_STAGES)
def test_build_refuses_stage_without_leading_meta(fixture_tree, tmp_path, stage_source):
    # test_case_id: build-refuses-stage-without-leading-meta
    out = tmp_path / "out"
    (fixture_tree / "workflows-src" / "stages" / "trivial.mjs").write_text(stage_source)

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "trivial.mjs")
    assert_nothing_written(out)


def test_build_refuses_duplicate_inline_name(fixture_tree, tmp_path):
    # test_case_id: build-refuses-malformed-inline-directive
    out = tmp_path / "out"
    stage = fixture_tree / "workflows-src" / "stages" / "trivial.mjs"
    stage.write_text(stage.read_text() + "\n// pb-inline ANSWER data/answer.json\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "trivial")
    assert_nothing_written(out)


MISPLACED_DIRECTIVES = [
    pytest.param(
        "stages/trivial.mjs", "  // pb-inline OTHER data/answer.json", id="indented-in-stage"
    ),
    pytest.param("shared/greet.mjs", "// pb-inline OTHER data/answer.json", id="in-shared-file"),
]


@pytest.mark.parametrize("relative_path, directive", MISPLACED_DIRECTIVES)
def test_build_refuses_misplaced_inline_directive(fixture_tree, tmp_path, relative_path, directive):
    # test_case_id: build-refuses-malformed-inline-directive
    out = tmp_path / "out"
    offender = fixture_tree / "workflows-src" / relative_path
    offender.write_text(offender.read_text() + "\n" + directive + "\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, Path(relative_path).name)
    assert_nothing_written(out)


MODULE_SOURCE = "export function twice(n) {\n  return n * 2;\n}\n\nexport const LIMIT = 3;\n"


def add_module(fixture_tree, source=MODULE_SOURCE, name="mod.mjs"):
    """Write a module under the fixture tree's shared-node/ and return its relative path."""
    directory = fixture_tree / "shared-node"
    directory.mkdir(exist_ok=True)
    (directory / name).write_text(source)
    return f"shared-node/{name}"


def declare_modules(fixture_tree, *paths):
    """Append one pb-inline-module directive per path to the trivial stage."""
    stage = fixture_tree / "workflows-src" / "stages" / "trivial.mjs"
    lines = "".join(f"\n// pb-inline-module {path}" for path in paths)
    stage.write_text(stage.read_text() + lines + "\n")


def test_module_directive_inlines_module_body(fixture_tree, tmp_path):
    # test_case_id: inlines-keys-and-labels
    out = tmp_path / "out"
    declare_modules(fixture_tree, add_module(fixture_tree))

    built = build_trivial_stage(fixture_tree, out).read_text()

    assert "function twice(n) {\n  return n * 2;\n}" in built, "the module body must be inlined"
    assert "const LIMIT = 3;" in built, "every export of the module must be inlined"
    assert "pb-inline-module" not in built, "the directive line must be removed from the output"


def test_module_export_keyword_is_stripped(fixture_tree, tmp_path):
    # test_case_id: export-keyword-stripped
    out = tmp_path / "out"
    declare_modules(fixture_tree, add_module(fixture_tree))

    built = build_trivial_stage(fixture_tree, out).read_text()

    exports = re.findall(r"^export .*$", built, re.MULTILINE)
    assert exports == [exports[0]] and exports[0].startswith("export const meta"), (
        f"only the meta may keep export: {exports}"
    )


def test_real_shared_node_modules_inline_into_code_config(tmp_path):
    # test_case_id: inlines-keys-and-labels
    out = tmp_path / "out"

    result = run_build(REPO_ROOT / "workflows-src", out, REPO_ROOT)

    assert result.returncode == 0, result.stderr
    built = (out / "code-config.js").read_text()
    for name in ("keys.mjs", "labels.mjs"):
        source = (REPO_ROOT / "shared-node" / name).read_text()
        body = re.sub(r"^export ", "", source, flags=re.MULTILINE).strip()
        assert body in built, f"{name} body must be inlined with export stripped"
    assert len(re.findall(r"^export ", built, re.MULTILINE)) == 1, "only meta may keep export"


def test_committed_code_config_matches_a_fresh_build():
    # test_case_id: built-output-passes-compile-checks
    result = run_node([BUILD_SCRIPT, "--check"])

    assert result.returncode == 0, result.stderr


def test_build_fails_when_module_path_missing(fixture_tree, tmp_path):
    # test_case_id: build-refuses-malformed-inline-directive
    out = tmp_path / "out"
    declare_modules(fixture_tree, "shared-node/absent.mjs")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "trivial.mjs")
    assert "shared-node/absent.mjs" in result.stderr, "the message must name the missing path"
    assert_nothing_written(out)


def test_build_refuses_module_inlined_twice(fixture_tree, tmp_path):
    # test_case_id: build-refuses-malformed-inline-directive
    out = tmp_path / "out"
    path = add_module(fixture_tree)
    declare_modules(fixture_tree, path, path)

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "trivial.mjs")
    assert "more than once" in result.stderr
    assert_nothing_written(out)


MODULE_FAILURES = [
    pytest.param("export function broken( {\n", id="syntax-error"),
    pytest.param("import x from 'y';\nexport const a = 1;\n", id="import-statement"),
    pytest.param("const a = 1;\nexport { a };\n", id="braced-export-left-behind"),
    pytest.param("const a = 1;\nexport {a};\n", id="braced-export-no-space"),
    pytest.param("const a = 1;\nexport\n{ a };\n", id="braced-export-split-over-lines"),
    pytest.param("export * from './other.mjs';\n", id="star-export"),
    pytest.param("export default 1;\n", id="default-export"),
    pytest.param("  export const a = 1;\n", id="indented-export"),
]


@pytest.mark.parametrize("source", MODULE_FAILURES)
def test_build_refuses_module_that_does_not_compile(fixture_tree, tmp_path, source):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    declare_modules(fixture_tree, add_module(fixture_tree, source, "bad.mjs"))

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "bad.mjs")
    assert_nothing_written(out)


def test_braced_export_failure_says_what_is_wrong(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    source = "const a = 1;\nexport { a };\n"
    declare_modules(fixture_tree, add_module(fixture_tree, source, "bad.mjs"))

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "bad.mjs")
    assert "export" in result.stderr, "the message must name the leftover export"


def add_shared(fixture_tree, name, source):
    """Write one more shared source file under the fixture tree."""
    (fixture_tree / "workflows-src" / "shared" / name).write_text(source)


def add_to_stage(fixture_tree, source):
    """Append source to the trivial stage body."""
    stage = fixture_tree / "workflows-src" / "stages" / "trivial.mjs"
    stage.write_text(stage.read_text() + "\n" + source)


DUPLICATE_DECLARATIONS = [
    pytest.param("function helper() {\n  return 1;\n}\n", id="function"),
    pytest.param("async function helper() {\n  return 1;\n}\n", id="async-function"),
    pytest.param("function* helper() {\n  yield 1;\n}\n", id="generator"),
    pytest.param("export function helper() {\n  return 1;\n}\n", id="exported-function"),
    pytest.param("const helper = 1;\n", id="const"),
    pytest.param("let helper = 1;\n", id="let"),
    pytest.param("var helper = 1;\n", id="var"),
    pytest.param("class helper {}\n", id="class"),
]


@pytest.mark.parametrize("declaration", DUPLICATE_DECLARATIONS)
def test_build_refuses_a_name_declared_by_two_modules(fixture_tree, tmp_path, declaration):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    first = add_module(fixture_tree, "function helper() {\n  return 2;\n}\n", "first.mjs")
    second = add_module(fixture_tree, declaration, "second.mjs")
    declare_modules(fixture_tree, first, second)

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "first.mjs")
    assert "second.mjs" in result.stderr, "the message must name both sources"
    assert "helper" in result.stderr, "the message must name the duplicate"
    assert_nothing_written(out)


def test_build_refuses_a_module_redeclaring_a_shared_function(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    add_shared(fixture_tree, "zhelper.mjs", "function helper() {\n  return 1;\n}\n")
    source = "function helper() {\n  return 2;\n}\n"
    declare_modules(fixture_tree, add_module(fixture_tree, source))

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "zhelper.mjs")
    assert "mod.mjs" in result.stderr, "the message must name both sources"
    assert_nothing_written(out)


def test_build_refuses_a_stage_redeclaring_a_module_function(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    source = "function helper() {\n  return 2;\n}\n"
    declare_modules(fixture_tree, add_module(fixture_tree, source))
    add_to_stage(fixture_tree, "function helper() {\n  return 3;\n}\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "trivial.mjs")
    assert "mod.mjs" in result.stderr, "the message must name both sources"
    assert_nothing_written(out)


def test_build_refuses_two_shared_files_declaring_one_function(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    add_shared(fixture_tree, "ahelper.mjs", "function helper() {\n  return 1;\n}\n")
    add_shared(fixture_tree, "zhelper.mjs", "function helper() {\n  return 2;\n}\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "ahelper.mjs")
    assert "zhelper.mjs" in result.stderr, "the message must name both sources"
    assert_nothing_written(out)


def test_build_allows_a_nested_name_matching_a_module_function(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    source = "export function outer() {\n  function helper() {}\n  return helper;\n}\n"
    other = "export function helper() {\n  return 2;\n}\n"
    declare_modules(
        fixture_tree, add_module(fixture_tree, source), add_module(fixture_tree, other, "b.mjs")
    )

    build_trivial_stage(fixture_tree, out)


def test_build_refuses_dynamic_import_in_module(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    source = "export async function load() {\n  return import('x');\n}\n"
    declare_modules(fixture_tree, add_module(fixture_tree, source, "dyn.mjs"))

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree)

    assert_clean_failure(result, "dyn.mjs")
    assert "dynamic import" in result.stderr
    assert_nothing_written(out)


def test_stage_without_directive_stays_golden_when_shared_node_exists(fixture_tree, tmp_path):
    # test_case_id: existing-stage-output-unchanged
    out = tmp_path / "out"
    add_module(fixture_tree)

    built = build_trivial_stage(fixture_tree, out)

    assert built.read_bytes() == (FIXTURE_ROOT / "expected" / "trivial.js").read_bytes()


def test_coding_skill_does_not_route_to_code_config():
    # test_case_id: coding-skill-unchanged
    skill = (REPO_ROOT / "skills" / "coding" / "SKILL.md").read_text()

    assert "code-config" not in skill, "no task type may route to code-config yet"


def test_build_writes_mod_contract_from_stages_json_and_check_reports_drift(fixture_tree, tmp_path):
    # test_case_id: built-output-passes-compile-checks
    out = tmp_path / "out"
    contract = {"v": 1, "defaultTaskType": "x"}
    (fixture_tree / "contracts").mkdir()
    (fixture_tree / "contracts" / "stages.json").write_text(json.dumps(contract))
    generated = fixture_tree / "shared-node" / "stages-contract.mjs"

    build_ok(fixture_tree, out)

    text = generated.read_text()
    assert text.startswith("// Generated from contracts/stages.json"), (
        "the file says it is generated"
    )
    assert json.loads(text.split("export default ", 1)[1]) == contract
    assert run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True).returncode == 0

    generated.write_text(text + "// edited\n")
    result = run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True)

    assert result.returncode != 0
    assert "differs: shared-node/stages-contract.mjs" in result.stderr
