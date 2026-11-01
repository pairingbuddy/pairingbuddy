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
