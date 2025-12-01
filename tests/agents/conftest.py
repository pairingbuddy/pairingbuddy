# Shared pytest fixtures for agent tests
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).parent.parent.parent
AGENTS_DIR = PROJECT_ROOT / "agents"
SKILLS_DIR = PROJECT_ROOT / "skills"
PLUGIN_JSON = PROJECT_ROOT / ".claude-plugin" / "plugin.json"


@pytest.fixture
def project_root():
    """Return the project root path."""
    return PROJECT_ROOT


@pytest.fixture
def agents_dir():
    """Return the agents directory path."""
    return AGENTS_DIR


@pytest.fixture
def skills_dir():
    """Return the skills directory path."""
    return SKILLS_DIR


@pytest.fixture
def plugin_json_path():
    """Return the plugin.json path."""
    return PLUGIN_JSON
