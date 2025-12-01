"""Structural validation tests for plugin.json."""

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
PLUGIN_JSON = PROJECT_ROOT / ".claude-plugin" / "plugin.json"


def load_plugin_json():
    """Load plugin.json."""
    with open(PLUGIN_JSON) as f:
        return json.load(f)


def test_plugin_json_exists():
    """plugin.json must exist."""
    assert PLUGIN_JSON.exists(), f"plugin.json not found at {PLUGIN_JSON}"


def test_plugin_agent_paths_exist():
    """Every agent path in plugin.json must point to an existing file."""
    plugin = load_plugin_json()
    agents = plugin.get("agents", [])

    for agent_path in agents:
        # Resolve relative path from plugin.json location
        full_path = PROJECT_ROOT / agent_path.lstrip("./")
        assert full_path.exists(), f"Agent file not found: {agent_path} (resolved to {full_path})"


def test_plugin_skills_path_exists():
    """Skills path in plugin.json must point to an existing directory."""
    plugin = load_plugin_json()
    skills_path = plugin.get("skills")

    if skills_path:
        full_path = PROJECT_ROOT / skills_path.lstrip("./")
        assert full_path.exists(), (
            f"Skills directory not found: {skills_path} (resolved to {full_path})"
        )


def test_plugin_commands_path_exists():
    """Commands path in plugin.json must point to an existing directory."""
    plugin = load_plugin_json()
    commands_path = plugin.get("commands")

    if commands_path:
        full_path = PROJECT_ROOT / commands_path.lstrip("./")
        assert full_path.exists(), (
            f"Commands directory not found: {commands_path} (resolved to {full_path})"
        )
