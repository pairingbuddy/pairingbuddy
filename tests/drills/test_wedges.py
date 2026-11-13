"""Forces each wedge of `tests/drills/force_wedge.mjs`, then runs its recipe from CONTRIBUTING.md.

The recipes run as written: their bash blocks are read out of the document and executed against
the forced wedge, so a recipe that stops working fails here. What needs a live session is listed
in the recipe's own "Not verified" section.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / "tests" / "drills" / "force_wedge.mjs"
RECIPE_DOC = REPO_ROOT / "CONTRIBUTING.md"
WEDGES = {
    "gate-throw": "gate.mjs crash or throw",
    "gate-parse": "gate.mjs parse failure",
    "gate-boot-parse": "gate-boot.mjs parse failure",
    "stranded-stage": "Stranded active stage",
    "killed-session": "Killed session mid-stage",
    "killed-at-gate": "Killed session at a gate",
    "sha-mismatch": "Ledger SHA mismatch",
    "second-session": "Second session in the same worktree",
    "no-unit": "A run with no unit",
    "broken-cli": "Broken CLI",
}
RUN_STATE = Path(".pairingbuddy") / "run"
LEDGER = RUN_STATE / "task" / "ledger.json"
SESSION_B = "drill-session-b"


def clean_env(tmp_path, **extra):
    dropped = ("GIT_", "PAIRINGBUDDY", "CLAUDE")
    env = {k: v for k, v in os.environ.items() if not k.startswith(dropped)}
    return {**env, "TMPDIR": str(tmp_path), **extra}


def run_script(tmp_path, *args, **extra):
    return subprocess.run(
        ["node", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env=clean_env(tmp_path, **extra),
        cwd=tmp_path,
    )


def force(tmp_path, wedge):
    result = run_script(tmp_path, f"--{wedge}")
    assert result.returncode == 0, result.stderr
    return Path(re.search(r"^Drill clone: (.+)$", result.stdout, re.M)[1])


def ledger_of(clone):
    return json.loads((clone / LEDGER).read_text())


def hook(clone, tmp_path, name, payload):
    return subprocess.run(
        ["node", str(clone / "hooks" / name)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=clean_env(tmp_path, CLAUDE_PLUGIN_ROOT=str(clone)),
        cwd=clone,
    )


def gate_call(clone, tmp_path, tool, tool_input, session=SESSION_B, mode="default"):
    return hook(
        clone,
        tmp_path,
        "gate-boot.mjs",
        {
            "session_id": session,
            "cwd": str(clone),
            "tool_name": tool,
            "permission_mode": mode,
            "tool_input": tool_input,
        },
    )


def write_call(clone, tmp_path, **kwargs):
    return gate_call(clone, tmp_path, "Write", {"file_path": str(clone / "x.txt")}, **kwargs)


def bash_call(clone, tmp_path, **kwargs):
    return gate_call(clone, tmp_path, "Bash", {"command": "git status"}, **kwargs)


def workflow_call(clone, tmp_path, stage, attempt, **kwargs):
    tool_input = {
        "name": f"pairingbuddy:{stage}",
        "args": {"pluginRoot": str(clone), "attempt": attempt},
    }
    return gate_call(clone, tmp_path, "Workflow", tool_input, **kwargs)


def denial(result):
    assert result.returncode == 0, result.stderr
    decision = json.loads(result.stdout)["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    return decision["permissionDecisionReason"]


def assert_allowed(result):
    assert (result.returncode, result.stdout) == (0, ""), result.stdout + result.stderr


def pb(clone, tmp_path, *args):
    return subprocess.run(
        ["node", str(clone / "cli" / "pb.mjs"), *args],
        capture_output=True,
        text=True,
        env=clean_env(tmp_path),
        cwd=clone,
    )


def section(heading):
    text = RECIPE_DOC.read_text()
    assert f"### {heading}\n" in text, f"no recipe section: {heading}"
    return re.split(r"\n##+ ", text.split(f"### {heading}\n", 1)[1], maxsplit=1)[0]


def bash_blocks(heading):
    return re.findall(r"```bash\n(.*?)```", section(heading), re.S)


def run_recipe(clone, tmp_path, text):
    setup = "".join(bash_blocks("Before you start"))
    return subprocess.run(
        ["bash", "-c", f"set -euo pipefail\n{setup}\n{text}"],
        capture_output=True,
        text=True,
        env=clean_env(tmp_path, ROOT=str(clone), PLUGIN=str(clone)),
        cwd=tmp_path,
    )


def recover(clone, tmp_path, wedge, block=0):
    result = run_recipe(clone, tmp_path, bash_blocks(WEDGES[wedge])[block])
    assert result.returncode == 0, result.stdout + result.stderr
    return result


def tree_snapshot():
    return subprocess.run(
        ["git", "status", "--porcelain", "--ignored"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        env=clean_env(Path("/tmp")),
    ).stdout


class TestScriptOutput:
    @pytest.mark.parametrize("wedge", WEDGES)
    def test_prints_the_clone_and_the_start_line(self, tmp_path, wedge):
        result = run_script(tmp_path, f"--{wedge}")

        assert result.returncode == 0, result.stderr
        clone = re.search(r"^Drill clone: (.+)$", result.stdout, re.M)[1]
        assert f"cd {clone} && claude --plugin-dir {clone}\n" in result.stdout
        assert f'Recipe: CONTRIBUTING.md, "{WEDGES[wedge]}"' in result.stdout
        assert (Path(clone) / ".git").is_dir()

    def test_every_recipe_has_a_section_with_what_you_see_and_commands(self):
        for heading in WEDGES.values():
            assert "**What you see:**" in section(heading)
            assert bash_blocks(heading), heading

    def test_the_clone_cannot_reach_the_source(self, tmp_path):
        clone = force(tmp_path, "no-unit")

        remotes = subprocess.run(
            ["git", "remote"], capture_output=True, text=True, cwd=clone
        ).stdout

        assert remotes == ""

    def test_lists_every_wedge(self, tmp_path):
        result = run_script(tmp_path, "--list")

        assert sorted(result.stdout.split()) == sorted(f"--{w}" for w in WEDGES)

    @pytest.mark.parametrize("args", [[], ["--no-such-wedge"], ["--no-unit", "--gate-parse"]])
    def test_refuses_anything_but_one_wedge(self, tmp_path, args):
        result = run_script(tmp_path, *args)

        assert result.returncode == 2
        assert list(tmp_path.glob("pb-drill-*")) == []


class TestRefusals:
    def assert_refused(self, result):
        assert result.returncode == 1, result.stdout
        assert "refus" in result.stderr.lower()
        assert "Drill clone:" not in result.stdout

    def test_refuses_this_worktree(self, tmp_path):
        before = tree_snapshot()

        result = run_script(tmp_path, "--no-unit", "--clone", str(REPO_ROOT))

        self.assert_refused(result)
        assert tree_snapshot() == before

    def test_refuses_a_directory_inside_this_worktree(self, tmp_path):
        result = run_script(tmp_path, "--no-unit", "--clone", str(REPO_ROOT / "hooks"))

        self.assert_refused(result)

    def test_refuses_any_other_repo(self, tmp_path):
        repo = tmp_path / "other"
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        (repo / "keep.txt").write_text("keep")

        result = run_script(tmp_path, "--no-unit", "--clone", str(repo))

        self.assert_refused(result)
        assert (repo / "keep.txt").read_text() == "keep"

    def test_refuses_a_copy_of_a_throwaway_clone(self, tmp_path):
        clone = force(tmp_path, "no-unit")
        copy = tmp_path / "copy"
        subprocess.run(["cp", "-R", str(clone), str(copy)], check=True)

        result = run_script(tmp_path, "--no-unit", "--clone", str(copy))

        self.assert_refused(result)

    def test_refuses_a_temp_directory_inside_this_worktree(self, tmp_path):
        result = run_script(tmp_path, "--no-unit", TMPDIR=str(REPO_ROOT / "tests"))

        self.assert_refused(result)

    def test_an_inherited_git_dir_cannot_point_it_at_this_worktree(self, tmp_path):
        before = tree_snapshot()
        common = subprocess.run(
            ["git", "rev-parse", "--absolute-git-dir"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            env=clean_env(tmp_path),
        ).stdout.strip()

        result = run_script(tmp_path, "--no-unit", GIT_DIR=common, GIT_WORK_TREE=str(REPO_ROOT))

        assert result.returncode == 0, result.stderr
        assert tree_snapshot() == before

    def test_takes_its_own_clone_again_and_resets_it(self, tmp_path):
        clone = force(tmp_path, "gate-parse")

        result = run_script(tmp_path, "--stranded-stage", "--clone", str(clone))

        assert result.returncode == 0, result.stderr
        assert_allowed(hook(clone, tmp_path, "gate-boot.mjs", {"cwd": "/"}))
        assert ledger_of(clone)["stage"]["status"] == "active"


class TestGateThrow:
    def test_denies_every_call_until_the_hook_is_restored(self, tmp_path):
        clone = force(tmp_path, "gate-throw")

        assert "Gate error during a run" in denial(write_call(clone, tmp_path))
        assert "Gate error during a run" in denial(bash_call(clone, tmp_path))

        recover(clone, tmp_path, "gate-throw")

        assert_allowed(write_call(clone, tmp_path))
        assert pb(clone, tmp_path, "status").returncode == 0


class TestGateParseFailure:
    def test_denies_every_call_until_the_hook_is_restored(self, tmp_path):
        clone = force(tmp_path, "gate-parse")
        into_run = {"file_path": str(clone / RUN_STATE / "task" / "x.txt")}

        assert "checkout -- hooks" in denial(gate_call(clone, tmp_path, "Write", into_run))
        assert "checkout -- hooks" in denial(write_call(clone, tmp_path))
        assert "checkout -- hooks" in denial(bash_call(clone, tmp_path))
        assert not (clone / RUN_STATE / "task" / "x.txt").exists()

        result = recover(clone, tmp_path, "gate-parse")

        assert "ledger.json" in result.stdout
        assert_allowed(write_call(clone, tmp_path))


class TestGateBootParseFailure:
    def test_exits_one_with_no_decision_until_the_hook_is_restored(self, tmp_path):
        clone = force(tmp_path, "gate-boot-parse")

        wedged = write_call(clone, tmp_path)

        assert wedged.returncode == 1
        assert wedged.stdout == ""
        assert "SyntaxError" in wedged.stderr

        result = recover(clone, tmp_path, "gate-boot-parse")

        assert "ledger.json" in result.stdout
        assert_allowed(write_call(clone, tmp_path))


class TestStrandedStage:
    def test_blocks_the_next_stage_until_stage_fail(self, tmp_path):
        clone = force(tmp_path, "stranded-stage")

        assert ledger_of(clone)["stage"]["status"] == "active"
        assert ledger_of(clone)["stage"]["runId"] is not None
        wedged = denial(workflow_call(clone, tmp_path, "code-safety-net", 1))
        assert "is active at attempt 1" in wedged
        assert "cleared by the human running pb stage fail" in wedged

        recover(clone, tmp_path, "stranded-stage")

        assert ledger_of(clone)["stage"]["status"] == "failed"
        assert_allowed(workflow_call(clone, tmp_path, "code-config", 2))
        assert ledger_of(clone)["stage"]["attempt"] == 2


class TestKilledSession:
    def test_leaves_a_lock_and_files_until_the_lock_goes_stale(self, tmp_path):
        clone = force(tmp_path, "killed-session")

        assert (clone / f"{LEDGER}.lock").exists()
        refused = pb(clone, tmp_path, "stage", "fail")
        assert refused.returncode == 1
        assert "could not take the ledger lock" in refused.stderr

        result = recover(clone, tmp_path, "killed-session")

        assert "drill-half-done.txt" in result.stdout
        assert not (clone / f"{LEDGER}.lock").exists()
        assert ledger_of(clone)["stage"]["status"] == "failed"
        assert_allowed(workflow_call(clone, tmp_path, "code-config", 2))


class TestKilledAtGate:
    def test_only_a_human_approval_clears_it(self, tmp_path):
        clone = force(tmp_path, "killed-at-gate")

        assert ledger_of(clone)["needsHuman"]["gate"] == "G:task-end"
        assert pb(clone, tmp_path, "stage", "fail").returncode == 1

        recover(clone, tmp_path, "killed-at-gate")

        ledger = ledger_of(clone)
        assert ledger["needsHuman"] is None
        assert ledger["gates"]["G:task-end"] == {"source": "human-cli", "answer": "approve"}


class TestShaMismatch:
    def test_refuses_until_a_human_accepts(self, tmp_path):
        clone = force(tmp_path, "sha-mismatch")

        refused = pb(clone, tmp_path, "status")
        assert refused.returncode == 1
        assert "sha mismatch" in refused.stderr
        assert "human accept" in refused.stderr
        assert "sha mismatch" in denial(write_call(clone, tmp_path))

        recover(clone, tmp_path, "sha-mismatch")

        assert pb(clone, tmp_path, "status").returncode == 0
        assert_allowed(write_call(clone, tmp_path))
        assert len(ledger_of(clone)["acceptances"]) == 1


class TestSecondSession:
    def test_the_second_session_has_no_say_until_handed_the_run(self, tmp_path):
        clone = force(tmp_path, "second-session")
        first = ledger_of(clone)["owner"]["sessionId"]

        assert_allowed(bash_call(clone, tmp_path, mode="acceptEdits"))
        assert ledger_of(clone)["owner"]["sessionId"] == first
        assert ledger_of(clone)["policy"]["mode"] == "default"
        assert pb(clone, tmp_path, "run", "open", "--kind", "code").returncode == 1
        assert "is active at attempt 1" in denial(
            workflow_call(clone, tmp_path, "code-safety-net", 1)
        )

        recover(clone, tmp_path, "second-session")

        assert_allowed(workflow_call(clone, tmp_path, "code-config", 2, mode="acceptEdits"))
        ledger = ledger_of(clone)
        assert ledger["owner"]["sessionId"] == SESSION_B
        assert ledger["policy"]["mode"] == "acceptEdits"


class TestNoUnit:
    def test_has_no_cli_way_out(self, tmp_path):
        clone = force(tmp_path, "no-unit")

        assert not (clone / RUN_STATE / "unit.json").exists()
        ended = pb(clone, tmp_path, "task", "end")
        assert ended.returncode == 1
        assert "cannot end" in ended.stderr
        abandon = pb(clone, tmp_path, "human", "abandon")
        assert abandon.returncode == 2
        assert "unknown verb" in abandon.stderr

        recover(clone, tmp_path, "no-unit")

        assert not (clone / RUN_STATE).exists()
        assert "no run here" in pb(clone, tmp_path, "status").stderr
        assert_allowed(write_call(clone, tmp_path))
        assert pb(clone, tmp_path, "run", "open", "--kind", "code").returncode == 0


class TestBrokenCli:
    def assert_wedged(self, clone, tmp_path):
        broken = pb(clone, tmp_path, "status")
        assert broken.returncode != 0
        assert "SyntaxError" in broken.stderr
        assert "Gate error during a run" in denial(write_call(clone, tmp_path))

    def test_restoring_the_files_keeps_the_run(self, tmp_path):
        clone = force(tmp_path, "broken-cli")
        self.assert_wedged(clone, tmp_path)

        recover(clone, tmp_path, "broken-cli", block=0)

        assert pb(clone, tmp_path, "status").returncode == 0
        assert_allowed(write_call(clone, tmp_path))

    def test_with_no_good_code_a_human_deletes_the_run(self, tmp_path):
        clone = force(tmp_path, "broken-cli")
        self.assert_wedged(clone, tmp_path)

        recover(clone, tmp_path, "broken-cli", block=1)

        assert not (clone / RUN_STATE).exists()
        assert pb(clone, tmp_path, "status").returncode != 0
        assert_allowed(write_call(clone, tmp_path))
