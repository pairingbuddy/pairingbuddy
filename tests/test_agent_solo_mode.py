"""Validation tests for agent solo_mode flags and sections.

Tests that agents with Step 3 Human Review have solo_mode flags in config
and corresponding ## Solo Mode sections in their MD files.
"""

from pathlib import Path

import pytest
import yaml

AGENTS_DIR = Path(__file__).parent.parent / "agents"
CONFIG_PATH = Path(__file__).parent.parent / "contracts" / "agent-config.yaml"

with open(CONFIG_PATH) as _f:
    CONFIG = yaml.safe_load(_f)


def get_all_agents_with_step3():
    """Get agents that have workflow_step3_human_review in their section config."""
    agents_with_step3 = []

    for agent_name, agent_def in CONFIG.get("agents", {}).items():
        sections = agent_def.get("sections", [])
        for section in sections:
            if section.get("content") == "workflow_step3_human_review":
                agents_with_step3.append(agent_name)
                break

    return agents_with_step3


def get_all_agents():
    """Get all agent names from config."""
    return list(CONFIG.get("agents", {}).keys())


def get_unflagged_agents():
    """Get agent names that do not have workflow_step3_human_review."""
    unflagged = []
    for agent_name, agent_def in CONFIG.get("agents", {}).items():
        sections = agent_def.get("sections", [])
        has_step3 = any(
            section.get("content") == "workflow_step3_human_review" for section in sections
        )
        if not has_step3:
            unflagged.append(agent_name)
    return unflagged


def get_agents_without_solo_mode():
    """Get agent names that do not have solo_mode: true in config."""
    return [
        agent_name
        for agent_name, agent_def in CONFIG.get("agents", {}).items()
        if agent_def.get("solo_mode") is not True
    ]


AGENTS_WITH_STEP3 = get_all_agents_with_step3()
ALL_AGENTS = get_all_agents()
UNFLAGGED_AGENTS = get_unflagged_agents()
AGENTS_WITHOUT_SOLO_MODE = get_agents_without_solo_mode()


# =============================================================================
# Solo Mode Flag Tests
# =============================================================================


@pytest.mark.parametrize("agent_name", AGENTS_WITH_STEP3)
def test_flagged_agents_have_solo_mode_true(agent_name):
    """Each agent with workflow_step3_human_review has solo_mode: true in agent-config.yaml."""
    agent_def = CONFIG.get("agents", {}).get(agent_name, {})

    solo_mode = agent_def.get("solo_mode")

    assert solo_mode is True, (
        f"Agent '{agent_name}' has workflow_step3_human_review but solo_mode is not true. "
        f"Got: {solo_mode}"
    )


@pytest.mark.parametrize("agent_name", UNFLAGGED_AGENTS)
def test_unflagged_agents_lack_solo_mode(agent_name):
    """Each agent without workflow_step3_human_review does not have solo_mode: true."""
    agent_def = CONFIG.get("agents", {}).get(agent_name, {})

    solo_mode = agent_def.get("solo_mode")

    assert solo_mode is not True, (
        f"Agent '{agent_name}' does not have workflow_step3_human_review "
        f"but solo_mode is true. This is inconsistent."
    )


# =============================================================================
# Solo Mode Section Tests
# =============================================================================


@pytest.mark.parametrize("agent_name", AGENTS_WITH_STEP3)
def test_solo_mode_section_exists_for_flagged_agent(agent_name):
    """For every agent with solo_mode: true, agents/<name>.md contains a ## Solo Mode section."""
    agent_md = AGENTS_DIR / f"{agent_name}.md"

    assert agent_md.exists(), f"Agent file not found: {agent_md}"

    content = agent_md.read_text()

    assert "## Solo Mode" in content, (
        f"Agent '{agent_name}' has solo_mode: true but does not contain a '## Solo Mode' section. "
        f"Please add the Solo Mode section to {agent_md}"
    )


@pytest.mark.parametrize("agent_name", AGENTS_WITHOUT_SOLO_MODE)
def test_solo_mode_section_absent_for_unflagged_agent(agent_name):
    """For every agent without solo_mode: true, agents/<name>.md does not contain ## Solo Mode."""
    agent_md = AGENTS_DIR / f"{agent_name}.md"

    if not agent_md.exists():
        pytest.skip(f"Agent file not found: {agent_md}")

    content = agent_md.read_text()

    assert "## Solo Mode" not in content, (
        f"Agent '{agent_name}' does not have solo_mode: true "
        f"but contains a '## Solo Mode' section. Remove it or add solo_mode: true to config."
    )
