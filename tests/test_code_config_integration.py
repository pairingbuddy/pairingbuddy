"""Integration check: the built code-config workflow, started by slash command, really changes
the file, and its return lands through the tap.

A workflow's `completed` status proves nothing (T0 outcome, P13A), so the checks are on the
effects: the changed file, the artifact, the runId the tap stores and an empty tap error log.

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
LEDGER = REPO_ROOT / "shared-node" / "ledger.mjs"
BUDGET_USD = "0.50"
PB_KEY = "code-config.apply-config-change.-.r1.a1"

requires_opt_in = pytest.mark.skipif(
    os.environ.get("PB_INTEGRATION") != "1" or shutil.which("claude") is None,
    reason="integration check: set PB_INTEGRATION=1 and put `claude` on PATH to run (spends money)",
)


def git(repo, *args):
    command = ["git", "-C", str(repo), "-c", "commit.gpgsign=false", *args]
    subprocess.run(command, check=True, capture_output=True, text=True)


def workflow_prompt(args):
    """The slash command that starts the workflow. The runtime parses the JSON into its args."""
    return f"/pairingbuddy:code-config {json.dumps(args)}"


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


@pytest.mark.integration
@requires_opt_in
def test_code_config_stage_changes_the_file_and_lands_artifact_through_tap(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "feature")
    git(repo, "config", "user.email", "integration@example.invalid")
    git(repo, "config", "user.name", "integration")
    (repo / ".pairingbuddy").mkdir()
    (repo / ".pairingbuddy" / "test-config.json").write_text("{}")
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
    task_dir = repo / ".pairingbuddy" / "run" / "task"
    setup = (
        f"import {{ updateLedger }} from {json.dumps(LEDGER.as_uri())};"
        f"updateLedger({json.dumps(str(task_dir / 'ledger.json'))}, (l) => ({{ ...l, "
        "stage: { name: 'code-config', status: 'running', runId: null, attempt: 1 } }));"
    )
    subprocess.run(
        ["node", "--input-type=module", "-e", setup], check=True, capture_output=True, text=True
    )

    task = {
        "description": "Set feature.enabled to true in settings.json",
        "context": "config change only",
    }
    prompt = workflow_prompt({"attempt": 1, "pluginRoot": str(REPO_ROOT), "task": task})
    run = subprocess.run(
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
            "--output-format",
            "text",
        ],
        cwd=repo,
        env=clean_env(),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=600,
    )

    output = f"stdout:\n{run.stdout}\nstderr:\n{run.stderr}"
    assert run.returncode == 0, output
    assert json.loads((repo / "settings.json").read_text())["feature"]["enabled"] is True, output
    tap_errors = task_dir / "tap-errors.log"
    assert not tap_errors.exists() or tap_errors.read_text() == "", tap_errors.read_text()
    assert isinstance(json.loads((task_dir / "ledger.json").read_text())["stage"]["runId"], str), (
        f"the tap sets runId only for the matching Workflow call\n{output}"
    )
    artifact = task_dir / "artifacts" / f"{PB_KEY}.json"
    assert artifact.is_file(), f"the tap must land the artifact for the stage key\n{output}"
    landed = json.loads(artifact.read_text())
    assert landed["pb_key"] == PB_KEY, output
    assert landed["ambiguity"] == "", output
    assert "settings.json" in landed["files_changed"], output
