"""Tests that agents have verbatim definitions from test-terminology.yaml.

Agents specified in test-terminology.yaml MUST have a ## Definitions section
containing the exact content from that file.
"""

import re
from pathlib import Path

import pytest
import yaml

PROJECT_ROOT = Path(__file__).parent.parent.parent
AGENTS_DIR = PROJECT_ROOT / "agents"
CONTRACTS_DIR = PROJECT_ROOT / "contracts"


def load_terminology_config():
    """Load test terminology configuration from YAML."""
    config_path = CONTRACTS_DIR / "test-terminology.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)


def extract_definitions_section(content: str) -> str | None:
    """Extract the ## Definitions section content from agent markdown."""
    section_pattern = r"^## Definitions\s*$"
    section_match = re.search(section_pattern, content, re.MULTILINE)
    if not section_match:
        return None

    section_start = section_match.end()
    next_section = re.search(r"^## ", content[section_start:], re.MULTILINE)
    if next_section:
        section_content = content[section_start : section_start + next_section.start()]
    else:
        section_content = content[section_start:]

    return section_content.strip()


config = load_terminology_config()
AGENTS_REQUIRING_DEFINITIONS = config["agents_requiring_definitions"]


@pytest.mark.parametrize("agent_name", AGENTS_REQUIRING_DEFINITIONS)
def test_agent_definitions_match_canonical(agent_name):
    """Test that agent's Definitions section contains the canonical content verbatim."""
    agent_path = AGENTS_DIR / f"{agent_name}.md"
    if not agent_path.exists():
        pytest.skip(f"Agent file {agent_path} does not exist")

    with open(agent_path) as f:
        content = f.read()

    definitions = extract_definitions_section(content)
    assert definitions is not None, f"Agent {agent_name} missing ## Definitions section"

    canonical = config["definitions_content"].strip()

    assert canonical in definitions, (
        f"Agent {agent_name} Definitions section does not contain canonical content.\n"
        f"Expected:\n{canonical}\n\n"
        f"Found:\n{definitions}"
    )
