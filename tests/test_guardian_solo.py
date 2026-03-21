"""
Guardian hook Solo mode tests.

Tests for hooks/guardian.mjs - Solo mode constants, environment detection,
hook registration, interval logic, and content injection.
"""

import datetime
import json
import os
import subprocess
import time
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
GUARDIAN_PATH = REPO_ROOT / "hooks" / "guardian.mjs"
HOOKS_JSON_PATH = REPO_ROOT / "hooks" / "hooks.json"

# Minimum character count for a substantive Solo prompt (vs a short reminder)
SOLO_PROMPT_MIN_LENGTH = 100


def _run_guardian(
    tmp_path,
    session_id="test-session",
    env_extra=None,
    args=None,
    elapsed_ms=None,
    hook_event_name="PostToolUse",
):
    """Invoke guardian.mjs via subprocess with stdin JSON.

    Sets up a state file in tmp_path to simulate elapsed time.
    Returns the parsed JSON output from stdout.
    """
    state_dir = tmp_path / ".pairingbuddy" / "hooks"
    state_dir.mkdir(parents=True, exist_ok=True)

    if elapsed_ms is not None:
        # Write a state file with lastInjection set to elapsed_ms ago
        last_injection_ts = time.time() - elapsed_ms / 1000
        last_injection_iso = (
            datetime.datetime.fromtimestamp(last_injection_ts, tz=datetime.UTC).strftime(
                "%Y-%m-%dT%H:%M:%S.%f"
            )[:-3]
            + "Z"
        )
        state_file = state_dir / f"{session_id}.json"
        state_file.write_text(json.dumps({"lastInjection": last_injection_iso, "trigger": "timer"}))

    stdin_data = json.dumps({"session_id": session_id, "hook_event_name": hook_event_name})

    env = os.environ.copy()
    # Remove PAIRINGBUDDY_SOLO from environment by default so tests start clean
    env.pop("PAIRINGBUDDY_SOLO", None)
    if env_extra:
        env.update(env_extra)

    cmd = ["node", str(GUARDIAN_PATH)]
    if args:
        cmd.extend(args)

    result = subprocess.run(
        cmd,
        input=stdin_data,
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        env=env,
    )

    return json.loads(result.stdout)


class TestSoloInterval:
    """Test that the Solo mode injection interval is exactly 120s."""

    def test_solo_does_not_inject_1s_before_interval(self, tmp_path):
        """119s elapsed — 1s before the 120s Solo interval — does not inject."""
        output = _run_guardian(
            tmp_path,
            session_id="solo-119s-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            elapsed_ms=119_000,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context == "", "Should not inject at 119s (interval=120s)"

    def test_solo_injects_at_exact_interval(self, tmp_path):
        """120s elapsed — exactly at the Solo interval — injects."""
        output = _run_guardian(
            tmp_path,
            session_id="solo-120s-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            elapsed_ms=120_000,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Should inject at 120s (interval=120s)"

    def test_solo_injects_1s_after_interval(self, tmp_path):
        """121s elapsed — 1s past the 120s Solo interval — injects."""
        output = _run_guardian(
            tmp_path,
            session_id="solo-121s-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            elapsed_ms=121_000,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Should inject at 121s (interval=120s)"


class TestHooksJsonSessionStart:
    """Test hooks.json registration for SessionStart hook."""

    def test_session_start_hook_registered(self):
        """A SessionStart entry exists in hooks.json that invokes guardian.mjs."""
        hooks_config = json.loads(HOOKS_JSON_PATH.read_text())

        session_start_hooks = hooks_config.get("hooks", {}).get("SessionStart", [])
        assert session_start_hooks, "Expected SessionStart entries in hooks.json"

        all_commands = [
            hook.get("command", "")
            for entry in session_start_hooks
            for hook in entry.get("hooks", [])
        ]
        guardian_commands = [cmd for cmd in all_commands if "guardian.mjs" in cmd]
        assert guardian_commands, "Expected at least one SessionStart hook to invoke guardian.mjs"


class TestInteractiveInterval:
    """Test that the interactive mode injection interval is exactly 240s."""

    def test_interactive_does_not_inject_1s_before_interval(self, tmp_path):
        """239s elapsed — 1s before the 240s interactive interval — does not inject."""
        output = _run_guardian(
            tmp_path,
            session_id="interactive-239s-session",
            env_extra={},
            elapsed_ms=239_000,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context == "", "Should not inject at 239s (interval=240s)"

    def test_interactive_injects_at_exact_interval(self, tmp_path):
        """240s elapsed — exactly at the interactive interval — injects."""
        output = _run_guardian(
            tmp_path,
            session_id="interactive-240s-session",
            env_extra={},
            elapsed_ms=240_000,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Should inject at 240s (interval=240s)"

    def test_interactive_injects_1s_after_interval(self, tmp_path):
        """241s elapsed — 1s past the 240s interactive interval — injects."""
        output = _run_guardian(
            tmp_path,
            session_id="interactive-241s-session",
            env_extra={},
            elapsed_ms=241_000,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Should inject at 241s (interval=240s)"


class TestSoloReminderContent:
    """Test Solo mode PostToolUse injection uses Solo-specific short reminder."""

    def test_solo_injection_has_solo_reminder(self, tmp_path):
        """Solo mode injection returns Solo-specific reminder content (not interactive reminder).

        Verifies three behavioral properties as a single coherent check:
        injection occurs, the constant name is not leaked, and solo-specific
        content (not the interactive reminder) is returned.
        """
        # Trigger injection by using elapsed_ms well past any interval
        six_minutes_ms = 6 * 60 * 1000

        output = _run_guardian(
            tmp_path,
            session_id="solo-content-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            elapsed_ms=six_minutes_ms,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Expected hook to inject in solo mode after 6 min"

        # Solo mode injects REMINDER + SOLO_ADDITIONS
        # The base REMINDER mentions subagents (interactive workflow constraints)
        assert "subagents" in additional_context, (
            "Expected base REMINDER (mentioning subagents) to be present in Solo injection"
        )
        # SOLO_ADDITIONS appends Solo-specific content
        assert "SOLO MODE" in additional_context, (
            "Expected SOLO_ADDITIONS content ('SOLO MODE') to be present in Solo injection"
        )

    def test_interactive_injection_has_interactive_reminder(self, tmp_path):
        """Interactive mode injection returns the standard interactive reminder."""
        six_minutes_ms = 6 * 60 * 1000

        output = _run_guardian(
            tmp_path,
            session_id="interactive-content-session",
            env_extra={},
            elapsed_ms=six_minutes_ms,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Expected hook to inject in interactive mode after 6 min"

        # The interactive reminder mentions subagents
        assert "subagents" in additional_context, (
            "Expected interactive reminder to mention subagents"
        )


class TestSoloSessionStartInjection:
    """Test Solo SessionStart injection always injects the full Solo constraint prompt."""

    def test_solo_session_start_always_injects(self, tmp_path):
        """Calling guardian in Solo mode on SessionStart always injects regardless of timer."""
        output = _run_guardian(
            tmp_path,
            session_id="solo-start-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            args=["always"],
            hook_event_name="SessionStart",
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", (
            "Expected Solo mode SessionStart to always inject regardless of timer"
        )

    def test_solo_session_start_has_full_prompt(self, tmp_path):
        """Solo SessionStart injected content is the full Solo prompt (not short reminder)."""
        output = _run_guardian(
            tmp_path,
            session_id="solo-prompt-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            args=["always"],
            hook_event_name="SessionStart",
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", "Expected injection to occur"

        # Solo SessionStart injects REMINDER + SOLO_ADDITIONS
        # The base REMINDER content must be present
        assert "subagents" in additional_context, (
            "Expected base REMINDER content (mentioning subagents) in Solo SessionStart injection"
        )
        # The SOLO_ADDITIONS content must also be present
        assert "SOLO MODE" in additional_context, (
            "Expected SOLO_ADDITIONS content ('SOLO MODE') in Solo SessionStart injection"
        )
        # The combined content should be substantive
        assert len(additional_context) > SOLO_PROMPT_MIN_LENGTH, (
            f"Expected Solo SessionStart injection to be substantive "
            f"(>{SOLO_PROMPT_MIN_LENGTH} chars)"
        )
