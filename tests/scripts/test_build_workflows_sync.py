"""Tests for the workflow sync check and output pruning.

Covers scenario sync-test-detects-drift. The sync test rebuilds to a temp directory
and compares bytes against the built workflows/*.js, using node via subprocess.
"""

from tests.scripts.bundler_helpers import (
    BUILD_SCRIPT,
    assert_clean_failure,
    build_ok,
    run_build,
    run_node,
)


def test_sync_passes_when_built_files_match_source(fixture_tree, tmp_path):
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True)

    assert result.returncode == 0, result.stdout + result.stderr


def test_sync_fails_when_built_file_edited(fixture_tree, tmp_path):
    # test_case_id: sync-fails-when-built-file-edited
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    built_file = out / "trivial.js"
    built_file.write_text(built_file.read_text().replace("hello", "jello"))
    edited_bytes = built_file.read_bytes()

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True)

    assert result.returncode == 1, result.stdout + result.stderr
    assert built_file.read_bytes() == edited_bytes, "--check must leave the edited file untouched"


def test_sync_fails_when_built_file_stale(fixture_tree, tmp_path):
    # test_case_id: sync-fails-when-built-file-stale
    out = tmp_path / "workflows"
    src = fixture_tree / "workflows-src"
    build_ok(fixture_tree, out)
    shared_file = src / "shared" / "greet.mjs"
    shared_file.write_text(shared_file.read_text() + "\nconst staleMarker = 1;\n")

    result = run_build(src, out, fixture_tree, check=True)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "differs: trivial.js" in result.stderr, result.stderr


def test_sync_fails_on_extra_built_file(fixture_tree, tmp_path):
    # test_case_id: sync-fails-on-extra-or-missing-built-file
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    (out / "orphan.js").write_text("// not produced by source\n")

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "extra: orphan.js" in result.stderr, result.stderr


def test_sync_fails_on_missing_built_file(fixture_tree, tmp_path):
    # test_case_id: sync-fails-on-extra-or-missing-built-file
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    (out / "trivial.js").unlink()

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "missing: trivial.js" in result.stderr, result.stderr


def test_committed_workflows_match_source():
    # test_case_id: committed-workflows-match-source
    result = run_node([BUILD_SCRIPT, "--check"])

    assert result.returncode == 0, result.stdout + result.stderr


def test_rebuild_removes_output_of_deleted_stage(fixture_tree, tmp_path):
    # test_case_id: rebuild-removes-output-of-deleted-stage
    out = tmp_path / "workflows"
    src = fixture_tree / "workflows-src"
    build_ok(fixture_tree, out)
    (src / "stages" / "trivial.mjs").unlink()

    rebuild = run_build(src, out, fixture_tree)
    check = run_build(src, out, fixture_tree, check=True)

    assert rebuild.returncode == 0, rebuild.stderr
    assert not (out / "trivial.js").exists(), (
        "rebuild must remove the built file of a deleted stage"
    )
    assert check.returncode == 0, check.stdout + check.stderr


def test_missing_explicit_src_fails_and_leaves_out_alone(fixture_tree, tmp_path):
    # test_case_id: rebuild-fails-on-missing-explicit-src
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    before = {p.name: p.read_bytes() for p in out.iterdir()}

    result = run_build(tmp_path / "does-not-exist", out, fixture_tree)

    assert_clean_failure(result, "does-not-exist")
    after = {p.name: p.read_bytes() for p in out.iterdir()}
    assert after == before, "a failed build must leave --out unchanged"


def test_explicit_src_without_stages_fails_and_leaves_out_alone(fixture_tree, tmp_path):
    # test_case_id: rebuild-fails-on-explicit-src-without-stages
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    empty_src = tmp_path / "empty-src"
    empty_src.mkdir()

    result = run_build(empty_src, out, fixture_tree)

    assert_clean_failure(result, "empty-src")
    after = {p.name: p.read_bytes() for p in out.iterdir()}
    assert after == before, "a failed build must leave --out unchanged"


def test_missing_explicit_root_fails(fixture_tree, tmp_path):
    # test_case_id: rebuild-fails-on-missing-explicit-root
    out = tmp_path / "workflows"
    stage = fixture_tree / "workflows-src" / "stages" / "trivial.mjs"
    stage.write_text(stage.read_text().replace("// pb-inline ANSWER data/answer.json", ""))

    result = run_build(fixture_tree / "workflows-src", out, tmp_path / "no-such-root")

    assert_clean_failure(result, "no-such-root")
    assert not out.exists(), "a failed build must not create --out"


def test_rebuild_leaves_non_built_file_in_out(fixture_tree, tmp_path):
    # test_case_id: rebuild-keeps-non-built-files
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    (out / "keep.js").write_text("// hand written, not a bundler output\n")

    build_ok(fixture_tree, out)

    assert (out / "keep.js").read_text() == "// hand written, not a bundler output\n"


def test_check_reports_non_built_file_left_by_rebuild_as_extra(fixture_tree, tmp_path):
    # test_case_id: rebuild-keeps-non-built-files
    out = tmp_path / "workflows"
    build_ok(fixture_tree, out)
    (out / "keep.js").write_text("// hand written, not a bundler output\n")
    build_ok(fixture_tree, out)

    result = run_build(fixture_tree / "workflows-src", out, fixture_tree, check=True)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "extra: keep.js" in result.stderr, result.stderr
