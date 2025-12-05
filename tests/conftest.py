# Shared pytest fixtures for pairingbuddy tests
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).parent.parent
SYNC_SCRIPT = PROJECT_ROOT / "scripts" / "sync-shared-files.py"


def load_manifest():
    """Load the skill-manifest.yaml."""
    yaml_path = Path(__file__).parent / "skill-manifest.yaml"
    with open(yaml_path) as f:
        return yaml.safe_load(f)


@pytest.fixture(scope="session", autouse=True)
def sync_shared_files():
    """Run sync script before any tests execute.

    This ensures tests always run against fresh copies of shared files.
    Session-scoped so it only runs once per test session.
    """
    if not SYNC_SCRIPT.exists():
        pytest.skip(f"Sync script not found: {SYNC_SCRIPT}")

    result = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT)],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
    )

    if result.returncode != 0:
        # Print output for debugging but don't fail - source files may not exist yet
        print(f"Sync script output:\n{result.stdout}")
        if result.stderr:
            print(f"Sync script errors:\n{result.stderr}")


def pytest_generate_tests(metafunc):
    """Generate parametrized tests for skill names (OLD - will be removed in Phase 10)."""
    if "old_skill_name" in metafunc.fixturenames:
        config = load_manifest()
        metafunc.parametrize("old_skill_name", config["skills"])
