"""Validation tests for agent solo mode sections.

Tests that agents with Step 3 Human Review have a ## Solo Mode section in their
MD files, and agents without Step 3 do not.
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


AGENTS_WITH_STEP3 = get_all_agents_with_step3()
ALL_AGENTS = get_all_agents()
UNFLAGGED_AGENTS = get_unflagged_agents()


# =============================================================================
# Solo Mode Section Tests
# =============================================================================


@pytest.mark.parametrize("agent_name", AGENTS_WITH_STEP3)
def test_solo_mode_section_exists_for_flagged_agent(agent_name):
    """Verify agents with workflow_step3_human_review have a ## Solo Mode section."""
    agent_md = AGENTS_DIR / f"{agent_name}.md"

    assert agent_md.exists(), f"Agent file not found: {agent_md}"

    content = agent_md.read_text()

    assert "## Solo Mode" in content, (
        f"Agent '{agent_name}' has workflow_step3_human_review but lacks "
        f"'## Solo Mode' section. Please add it to {agent_md}"
    )


@pytest.mark.parametrize("agent_name", UNFLAGGED_AGENTS)
def test_solo_mode_section_absent_for_unflagged_agent(agent_name):
    """Verify agents without workflow_step3_human_review lack ## Solo Mode section."""
    agent_md = AGENTS_DIR / f"{agent_name}.md"

    if not agent_md.exists():
        pytest.skip(f"Agent file not found: {agent_md}")

    content = agent_md.read_text()

    assert "## Solo Mode" not in content, (
        f"Agent '{agent_name}' lacks workflow_step3_human_review but has "
        f"'## Solo Mode' section. Remove it or add workflow_step3_human_review."
    )
