"""Integration check: the built stages, started by slash command, pass the gate, really change the
file, and land their returns through the tap. The end-to-end check runs config then safety-net, with
`pb gate eval` and `pb task end`, and asserts the one commit and the removed run/task.

A workflow's `completed` status proves nothing (T0 outcome, P13A), so the checks are on the
effects: the changed file, the artifact, the active stage the gate marks, the runId the tap stores
and an empty tap error log. A main context that calls the agent directly gets a deny, so it must
recover by starting the workflow; if it does not, the file stays unchanged and this check fails.

Skipped by default because it spends money on a real `claude -p` run. Enable with
PB_INTEGRATION=1 and a `claude` binary on PATH. Agent models are pinned to haiku.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CLI = REPO_ROOT / "cli" / "pb.mjs"
BUDGET_USD = "0.50"
PB_KEY = "code-config.apply-config-change.-.r1.a1"
DOCS_KEY = "code-safety-net.update-documentation.-.r1.a1"
PASSING_TESTS = {
    "source_directory": ".",
    "runners": {
        "node": {
            "name": "node",
            "command": "node check.mjs",
            "test_directory": ".",
            "file_pattern": "check.mjs",
            "run_args": [],
        }
    },
    "default_runner": "node",
}
NO_DOCS = {"in_repo_docs": [], "external_docs": [], "last_verified": "2026-01-01T00:00:00Z"}

requires_opt_in = pytest.mark.skipif(
    os.environ.get("PB_INTEGRATION") != "1" or shutil.which("claude") is None,
    reason="integration check: set PB_INTEGRATION=1 and put `claude` on PATH to run (spends money)",
)


def git(repo, *args):
    command = ["git", "-C", str(repo), "-c", "commit.gpgsign=false", *args]
    subprocess.run(command, check=True, capture_output=True, text=True)


def workflow_prompt(args, stage="code-config"):
    """The slash command that starts the workflow. The runtime parses the JSON into its args."""
    return f"/pairingbuddy:{stage} {json.dumps(args)}"


def test_workflow_is_started_by_slash_command_without_naming_the_tool():
    prompt = workflow_prompt({"attempt": 1, "pluginRoot": "/x", "task": {"description": "t"}})

    assert prompt.startswith("/pairingbuddy:code-config {")
    assert "Workflow" not in prompt, "a prompt naming the tool made the agent do no work (P13A)"


def clean_env():
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("CLAUDE", "PAIRINGBUDDY", "ANTHROPIC_"))
    }
    haiku = "claude-haiku-5-5"
    return env | {"ANTHROPIC_DEFAULT_OPUS_MODEL": haiku, "ANTHROPIC_DEFAULT_SONNET_MODEL": haiku}


def open_run_repo(tmp_path, test_config=None, doc_config=None):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "feature")
    git(repo, "config", "user.email", "integration@example.invalid")
    git(repo, "config", "user.name", "integration")
    (repo / ".pairingbuddy").mkdir()
    config_text = json.dumps(test_config or PASSING_TESTS)
    (repo / ".pairingbuddy" / "test-config.json").write_text(config_text)
    if doc_config is not None:
        (repo / ".pairingbuddy" / "doc-config.json").write_text(json.dumps(doc_config))
    (repo / "check.mjs").write_text("process.exit(0);\n")
    (repo / "settings.json").write_text(
        json.dumps({"feature": {"enabled": False}}, indent=2) + "\n"
    )
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")

    subprocess.run(
        ["node", str(CLI), "run", "open", "--kind", "code"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return repo, repo / ".pairingbuddy" / "run" / "task"


def run_claude(repo, prompt, *output_args):
    return subprocess.run(
        [
            "claude",
            "-p",
            prompt,
            "--plugin-dir",
            str(REPO_ROOT),
            "--model",
            "haiku",
            "--effort",
            "low",
            "--setting-sources",
            "project,local",
            "--strict-mcp-config",
            "--permission-mode",
            "auto",
            "--max-budget-usd",
            BUDGET_USD,
            *output_args,
        ],
        cwd=repo,
        env=clean_env(),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=600,
    )


@pytest.mark.integration
@requires_opt_in
def test_code_config_stage_changes_the_file_and_lands_artifact_through_tap(tmp_path):
    repo, task_dir = open_run_repo(tmp_path, PASSING_TESTS)

    task = {
        "description": "Set feature.enabled to true in settings.json",
        "context": "config change only",
    }
    prompt = workflow_prompt({"attempt": 1, "pluginRoot": str(REPO_ROOT), "task": task})
    run = run_claude(repo, prompt, "--output-format", "text")

    output = f"stdout:\n{run.stdout}\nstderr:\n{run.stderr}"
    assert run.returncode == 0, output
    assert json.loads((repo / "settings.json").read_text())["feature"]["enabled"] is True, output
    tap_errors = task_dir / "tap-errors.log"
    assert not tap_errors.exists() or tap_errors.read_text() == "", tap_errors.read_text()
    stage = json.loads((task_dir / "ledger.json").read_text())["stage"]
    assert (stage["name"], stage["status"], stage["attempt"]) == ("code-config", "done", 1), (
        f"the gate marks the stage active, and the runner's stage finish closes it\n{output}"
    )
    assert isinstance(stage["runId"], str), (
        f"the tap sets runId only for the matching Workflow call\n{output}"
    )
    artifact = task_dir / "artifacts" / f"{PB_KEY}.json"
    assert artifact.is_file(), f"the tap must land the artifact for the stage key\n{output}"
    landed = json.loads(artifact.read_text())
    assert landed["pb_key"] == PB_KEY, output
    assert landed["ambiguity"] == "", output
    assert "settings.json" in landed["files_changed"], output


def pb(repo, *args):
    run = subprocess.run(
        ["node", str(CLI), *args], cwd=repo, env=clean_env(), capture_output=True, text=True
    )
    assert run.returncode == 0, f"pb {' '.join(args)}: {run.stdout}{run.stderr}"
    return json.loads(run.stdout)


def commit_subjects(repo):
    log = ["git", "-C", str(repo), "log", "--format=%s"]
    return subprocess.run(log, check=True, capture_output=True, text=True).stdout.split("\n")[:-1]


def run_stage(repo, stage, task):
    args = {"attempt": 1, "pluginRoot": str(REPO_ROOT), "task": task}
    run = run_claude(repo, workflow_prompt(args, stage), "--output-format", "text")
    output = f"{stage}\nstdout:\n{run.stdout}\nstderr:\n{run.stderr}"
    assert run.returncode == 0, output
    return output


def assert_stage_done(task_dir, stage, output):
    ledger = json.loads((task_dir / "ledger.json").read_text())
    tap_log = task_dir / "tap-errors.log"
    assert not tap_log.exists() or tap_log.read_text() == "", tap_log.read_text()
    assert ledger["stop"] is None, f"{ledger['stop']}\n{output}"
    done = [entry["name"] for entry in ledger["stages"] if entry["status"] == "done"]
    assert stage in done, f"the runner's stage finish must close {stage}: {ledger}\n{output}"
    return ledger


@pytest.mark.integration
@requires_opt_in
def test_both_stages_run_end_to_end_to_one_commit_and_no_run_state(tmp_path):
    repo, task_dir = open_run_repo(tmp_path, PASSING_TESTS, NO_DOCS)
    task = {"description": "Set feature.enabled to true in settings.json"}

    output = run_stage(repo, "code-config", task)
    assert json.loads((repo / "settings.json").read_text())["feature"]["enabled"] is True, output
    assert_stage_done(task_dir, "code-config", output)

    output = run_stage(repo, "code-safety-net", task)
    ledger = assert_stage_done(task_dir, "code-safety-net", output)
    assert ledger["tests"]["full"]["passed"] is True, output
    docs = [entry for entry in ledger["checkpoints"] if entry["step"] == "docs"]
    assert docs and docs[0]["key"] == DOCS_KEY and docs[0]["committed"] is False, ledger

    gate = pb(repo, "gate", "eval")
    assert (gate["result"], gate["gate"], gate["source"]) == ("auto-pass", "G:task-end", "auto")
    pb(repo, "task", "end")

    assert not task_dir.exists(), "pb task end removes run/task"
    subjects = commit_subjects(repo)
    assert len(subjects) == 2 and subjects[0].startswith("chore: "), subjects
    assert subjects[1] == "init", subjects


@pytest.mark.integration
@requires_opt_in
def test_direct_pipeline_agent_call_is_denied_by_the_real_hook(tmp_path):
    repo, task_dir = open_run_repo(tmp_path)

    prompt = (
        "Call the Agent tool with subagent_type pairingbuddy:apply-config-change and ask it to "
        "set feature.enabled to true in settings.json."
    )
    run = run_claude(repo, prompt, "--output-format", "stream-json", "--verbose")

    output = f"stdout:\n{run.stdout}\nstderr:\n{run.stderr}"
    assert "Direct Agent call for" in run.stdout, f"the gate must deny the call\n{output}"
    assert "Start the workflow pairingbuddy:code-config instead." in run.stdout, output
    artifact = task_dir / "artifacts" / f"{PB_KEY}.json"
    stage = json.loads((task_dir / "ledger.json").read_text())["stage"]
    assert not artifact.exists() or isinstance(stage["runId"], str), (
        f"an agent result may land only through a started workflow\n{output}"
    )
