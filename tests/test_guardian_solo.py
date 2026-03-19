"""
Guardian hook Solo mode tests.

Tests for hooks/guardian.mjs - Solo mode constants, environment detection,
hook registration, interval logic, and content injection.
"""

import datetime
import json
import os
import re
import subprocess
import time
from pathlib import Path

import pytest

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


class TestSoloModeConstants:
    """Test Solo mode constants defined in guardian.mjs."""

    @pytest.fixture(scope="class")
    def source(self):
        return GUARDIAN_PATH.read_text()

    def test_solo_interval_ms_constant_exists(self, source):
        """SOLO_INTERVAL_MS constant exists with value 150000 (2.5 minutes)."""
        # Use regex to match the const declaration pattern, not just a substring
        assert re.search(r"const\s+SOLO_INTERVAL_MS\s*=", source), (
            "Expected SOLO_INTERVAL_MS to be declared as const in guardian.mjs"
        )
        # The value 150000 must appear somewhere (as literal, underscore form, or in comment)
        assert re.search(r"150[_]?000", source), (
            "Expected 150000 (2.5 minutes) to appear in guardian.mjs for SOLO_INTERVAL_MS"
        )

    def test_solo_additions_constant_exists(self, source):
        """SOLO_ADDITIONS constant exists with Solo-specific constraint text."""
        assert re.search(r"\bSOLO_ADDITIONS\b", source), (
            "Expected SOLO_ADDITIONS constant in guardian.mjs"
        )
        assert "solo" in source.lower(), (
            "Expected SOLO_ADDITIONS to contain Solo-specific constraint text"
        )


class TestEnvironmentVariableDetection:
    """Test environment variable detection for Solo mode."""

    @pytest.fixture(scope="class")
    def source(self):
        return GUARDIAN_PATH.read_text()

    def test_references_pairingbuddy_solo_env_var(self, source):
        """Source code references process.env.PAIRINGBUDDY_SOLO."""
        assert "PAIRINGBUDDY_SOLO" in source, (
            "Expected guardian.mjs to reference process.env.PAIRINGBUDDY_SOLO"
        )


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


class TestSoloPostToolUseInterval:
    """Test PostToolUse interval logic in Solo mode."""

    def test_solo_injects_at_halved_interval(self, tmp_path):
        """When PAIRINGBUDDY_SOLO=true and last injection was 3 min ago, the hook injects."""
        three_minutes_ms = 3 * 60 * 1000

        output = _run_guardian(
            tmp_path,
            session_id="solo-inject-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            elapsed_ms=three_minutes_ms,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context != "", (
            "Expected hook to inject reminder when 3 min elapsed in solo mode (interval=2.5 min)"
        )

    def test_solo_skips_before_halved_interval(self, tmp_path):
        """Solo mode skips injection if only 1 min elapsed (interval=2.5 min)."""
        one_minute_ms = 1 * 60 * 1000

        output = _run_guardian(
            tmp_path,
            session_id="solo-skip-session",
            env_extra={"PAIRINGBUDDY_SOLO": "true"},
            elapsed_ms=one_minute_ms,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context == "", (
            "Expected hook to skip when 1 min elapsed in solo mode (interval=2.5 min)"
        )

    def test_interactive_skips_at_three_minutes(self, tmp_path):
        """Interactive mode skips injection if only 3 min elapsed (interval=5 min)."""
        three_minutes_ms = 3 * 60 * 1000

        output = _run_guardian(
            tmp_path,
            session_id="interactive-skip-session",
            env_extra={},
            elapsed_ms=three_minutes_ms,
        )

        additional_context = output["hookSpecificOutput"]["additionalContext"]
        assert additional_context == "", (
            "Expected hook to skip when 3 min elapsed in interactive mode (interval=5 min)"
        )


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
