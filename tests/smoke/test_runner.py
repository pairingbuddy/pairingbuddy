"""The smoke runner's cap and env handling, against a fake `claude`. Nothing here spends money.

The real runs are `tests/smoke/s1.py` and `tests/smoke/spike.py`, which pytest does not collect.
"""

import json
import os
import stat
import sys
from pathlib import Path

import pytest

from tests.smoke import runner
from tests.smoke.runner import Budget, SmokeError, SpendCapError, clean_env, run_claude
from tests.smoke.s1 import assert_control_flow
from tests.smoke.spike import clear_winner

FAKE_CLAUDE = """#!{python}
import json, os, sys
from pathlib import Path

here = Path(__file__).parent
same = lambda a, b: (a.st_dev, a.st_ino, a.st_rdev) == (b.st_dev, b.st_ino, b.st_rdev)
(here / "seen.jsonl").open("a").write(json.dumps({{
    "argv": sys.argv[1:],
    "env": dict(os.environ),
    "stdin_is_null": same(os.fstat(0), os.stat("/dev/null")),
    "own_session": os.getsid(0) == os.getpid(),
}}) + "\\n")
sys.stdout.write((here / "stream").read_text())
sys.exit(int((here / "exit").read_text()))
"""

FINISHED = {"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 0.5}
CAPPED = {
    "type": "result",
    "subtype": "error_max_budget_usd",
    "is_error": True,
    "terminal_reason": "budget_exhausted",
    "total_cost_usd": 3.1,
}


class FakeClaude:
    def __init__(self, directory):
        self.directory = directory
        path = directory / "claude"
        path.write_text(FAKE_CLAUDE.format(python=sys.executable))
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        self.answers([FINISHED])

    def answers(self, events, code=0):
        lines = [json.dumps(event) + "\n" for event in events]
        (self.directory / "stream").write_text("".join(lines))
        (self.directory / "exit").write_text(str(code))

    def calls(self):
        seen = self.directory / "seen.jsonl"
        return [json.loads(line) for line in seen.read_text().splitlines()]

    def last_flag(self, name):
        argv = self.calls()[-1]["argv"]
        return argv[argv.index(name) + 1]


@pytest.fixture
def fake(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    return FakeClaude(bin_dir)


def call(tmp_path, budget=None):
    return run_claude(tmp_path, "/x {}", budget or Budget(), tmp_path / "run.stream")


def test_clean_env_drops_policy_session_and_auth_variables_and_keeps_the_rest():
    inherited = {
        "PAIRINGBUDDY_GATE_POLICY": "auto",
        "PAIRINGBUDDY_SOLO": "true",
        "PB_INTEGRATION": "1",
        "CLAUDECODE": "1",
        "CLAUDE_CODE_SUBAGENT_MODEL": "opus",
        "CLAUDE_PLUGIN_ROOT": "/elsewhere",
        "ANTHROPIC_MODEL": "opus",
        "GIT_DIR": "/elsewhere/.git",
        "HOME": "/home/x",
        "PATH": "/bin",
    }

    env = clean_env(inherited)

    assert env == {
        "HOME": "/home/x",
        "PATH": "/bin",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-haiku-5-5",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-haiku-5-5",
    }


def test_the_spawned_run_gets_the_clean_env_and_not_the_policy_variable(
    fake, tmp_path, monkeypatch
):
    monkeypatch.setenv("PAIRINGBUDDY_GATE_POLICY", "auto")

    call(tmp_path)

    env = fake.calls()[0]["env"]
    assert "PAIRINGBUDDY_GATE_POLICY" not in env
    assert env["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "claude-haiku-5-5"


def test_the_run_loads_this_worktree_for_itself_alone_with_the_cap_and_no_stdin(fake, tmp_path):
    call(tmp_path)

    seen = fake.calls()[0]
    assert seen["argv"][:2] == ["-p", "/x {}"]
    assert fake.last_flag("--plugin-dir") == str(runner.REPO_ROOT)
    assert fake.last_flag("--max-budget-usd") == "3.0"
    assert fake.last_flag("--setting-sources") == "project,local"
    assert "--strict-mcp-config" in seen["argv"]
    assert seen["stdin_is_null"] is True
    assert seen["own_session"] is True


def test_a_finished_run_reports_its_cost_and_keeps_the_stream(fake, tmp_path):
    budget = Budget()

    run = call(tmp_path, budget)

    assert run.cost_usd == 0.5
    assert budget.spent == 0.5
    assert run.seconds >= 0
    assert json.loads(Path(tmp_path / "run.stream").read_text())["subtype"] == "success"


def test_the_highest_cost_in_the_stream_counts(fake, tmp_path):
    fake.answers([FINISHED | {"total_cost_usd": 0.2}, FINISHED | {"total_cost_usd": 0.7}])

    assert call(tmp_path).cost_usd == 0.7


def test_hitting_the_cap_fails_the_run_even_if_the_exit_code_is_zero(fake, tmp_path):
    fake.answers([CAPPED], code=0)

    with pytest.raises(SpendCapError, match="cap"):
        call(tmp_path)


def test_a_cap_result_before_a_later_success_still_fails(fake, tmp_path):
    fake.answers([CAPPED, FINISHED])

    with pytest.raises(SpendCapError):
        call(tmp_path)


def test_a_run_that_ends_at_or_over_the_cap_fails_though_it_reported_success(fake, tmp_path):
    fake.answers([FINISHED | {"total_cost_usd": 3.0}])

    with pytest.raises(SpendCapError):
        call(tmp_path)


def test_a_capped_run_is_charged_so_the_caller_sees_the_spend(fake, tmp_path):
    fake.answers([CAPPED], code=1)
    budget = Budget()

    with pytest.raises(SpendCapError):
        call(tmp_path, budget)

    assert budget.spent == 3.1


def test_the_cap_covers_the_whole_smoke_so_a_second_stage_gets_what_is_left(fake, tmp_path):
    budget = Budget()
    fake.answers([FINISHED | {"total_cost_usd": 1.25}])

    call(tmp_path, budget)
    call(tmp_path, budget)

    assert fake.last_flag("--max-budget-usd") == "1.75"


def test_no_budget_left_refuses_without_starting_claude(fake, tmp_path):
    budget = Budget()
    budget.charge(3.0)

    with pytest.raises(SpendCapError):
        call(tmp_path, budget)

    assert not (fake.directory / "seen.jsonl").exists()


@pytest.mark.parametrize(
    ("events", "code", "cause"),
    [
        ([FINISHED], 1, "exit 1"),
        ([], 0, "no result"),
        ([FINISHED | {"is_error": True, "subtype": "error_during_execution"}], 0, "error"),
    ],
)
def test_a_run_that_did_not_finish_cleanly_fails(fake, tmp_path, events, code, cause):
    fake.answers(events, code=code)

    with pytest.raises(SmokeError, match=cause):
        call(tmp_path)


def test_a_timeout_fails_and_marks_the_spend_unknown(fake, tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "RUN_TIMEOUT_S", 0.01)
    bad = fake.directory / "claude"
    bad.write_text(f"#!{sys.executable}\nimport time\ntime.sleep(5)\n")
    budget = Budget()

    with pytest.raises(SmokeError, match="timed out"):
        call(tmp_path, budget)

    assert budget.cost_known is False


LEDGER = {
    "stages": [
        {"name": "code-config", "status": "done"},
        {"name": "code-safety-net", "status": "done"},
    ],
    "gates": {"G:task-end": {"source": "auto"}},
    "policy": {"mode": "auto", "source": "permission_mode"},
}


def test_s1_passes_on_the_control_flow_it_names():
    assert_control_flow(LEDGER, ["chore: anything a model wrote", "init"])


@pytest.mark.parametrize(
    ("ledger", "commits", "cause"),
    [
        (LEDGER | {"stages": LEDGER["stages"][::-1]}, ["c", "init"], "stage order"),
        (LEDGER | {"stages": LEDGER["stages"][:1]}, ["c", "init"], "stage order"),
        (
            LEDGER | {"stages": [LEDGER["stages"][0] | {"status": "failed"}, LEDGER["stages"][1]]},
            ["c", "init"],
            "stage order",
        ),
        (LEDGER, ["init"], "commit"),
        (LEDGER, ["c", "d", "init"], "commit"),
        (LEDGER | {"gates": {"G:task-end": {"source": "human"}}}, ["c", "init"], "gate source"),
        (LEDGER | {"gates": {}}, ["c", "init"], "gate source"),
        (
            LEDGER | {"policy": {"mode": "auto", "source": "PAIRINGBUDDY_GATE_POLICY"}},
            ["c", "init"],
            "policy",
        ),
    ],
)
def test_s1_fails_when_the_control_flow_differs(ledger, commits, cause):
    with pytest.raises(SmokeError, match=cause):
        assert_control_flow(ledger, commits)


def tally(**runs):
    return {
        name: [{"passed": passed, "cost_usd": 0.1} for passed in outcome]
        for name, outcome in runs.items()
    }


def test_no_winner_is_called_before_the_third_round():
    assert clear_winner(tally(a=[True, True], b=[False, False])) is None


def test_a_flawless_task_wins_early_when_every_other_has_failed_twice():
    assert clear_winner(tally(a=[True] * 3, b=[False, True, False], c=[False, False, True])) == "a"


def test_one_failure_elsewhere_is_not_yet_a_clear_winner():
    assert clear_winner(tally(a=[True] * 3, b=[True, True, False])) is None


def test_after_all_rounds_the_most_reliable_task_wins_then_the_cheapest():
    runs = tally(a=[True] * 5, b=[True] * 5, c=[True, True, True, True, False])
    runs["a"] = [{"passed": True, "cost_usd": 0.2} for _ in range(5)]

    assert clear_winner(runs) == "b"


def test_only_the_entry_points_stay_out_of_pytest_collection():
    collected = {path.name for path in Path(runner.__file__).parent.glob("test_*.py")}

    assert collected == {"test_runner.py"}, "S1 and the spike spend money, so pytest must miss them"
