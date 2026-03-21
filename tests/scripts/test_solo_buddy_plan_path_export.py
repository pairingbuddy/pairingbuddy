"""Tests for PAIRINGBUDDY_PLAN_PATH export in solo-buddy.sh."""

import os
import re

import pytest

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "solo-buddy.sh")


@pytest.fixture
def script_path() -> str:
    """Return the absolute path to solo-buddy.sh."""
    return os.path.abspath(SCRIPT_PATH)


@pytest.fixture
def script_content(script_path: str) -> str:
    """Return the full text of solo-buddy.sh."""
    with open(script_path) as f:
        return f.read()


class TestPlanPathExport:
    """Tests for PAIRINGBUDDY_PLAN_PATH export in solo-buddy.sh."""

    def test_plan_path_export_present(self, script_content):
        """The script exports PAIRINGBUDDY_PLAN_PATH."""
        assert re.search(r"export\s+PAIRINGBUDDY_PLAN_PATH", script_content), (
            "solo-buddy.sh must contain 'export PAIRINGBUDDY_PLAN_PATH'"
        )

    def test_plan_path_export_value_matches_plan_file(self, script_content):
        """The export references $PLAN_FILE variable."""
        assert re.search(
            r'export\s+PAIRINGBUDDY_PLAN_PATH=["\']?\$PLAN_FILE["\']?', script_content
        ), "export PAIRINGBUDDY_PLAN_PATH must be assigned the value of $PLAN_FILE"

    def test_plan_path_export_near_other_exports(self, script_content):
        """The export appears alongside other PAIRINGBUDDY_ exports."""
        lines = script_content.splitlines()
        plan_path_line = None
        for i, line in enumerate(lines):
            if re.search(r"export\s+PAIRINGBUDDY_PLAN_PATH", line):
                plan_path_line = i
                break

        assert plan_path_line is not None, (
            "solo-buddy.sh must contain 'export PAIRINGBUDDY_PLAN_PATH'"
        )

        window = lines[max(0, plan_path_line - 5) : plan_path_line + 6]
        nearby_exports = [
            line
            for line in window
            if re.search(r"export\s+PAIRINGBUDDY_", line)
            and not re.search(r"export\s+PAIRINGBUDDY_PLAN_PATH", line)
        ]
        assert nearby_exports, (
            "export PAIRINGBUDDY_PLAN_PATH must appear near other PAIRINGBUDDY_ exports"
        )
