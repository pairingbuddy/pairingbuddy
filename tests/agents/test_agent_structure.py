"""Structural validation tests for plugin agents."""

import json
import re
from pathlib import Path

import frontmatter
import pytest
import yaml

from tests.contracts.markdown import extract_headings

PROJECT_ROOT = Path(__file__).parent.parent.parent
AGENTS_DIR = PROJECT_ROOT / "agents"
PLUGIN_JSON = PROJECT_ROOT / ".claude-plugin" / "plugin.json"
AGENT_CONFIG = PROJECT_ROOT / "contracts" / "agent-config.yaml"

# Maximum description length per Claude Code docs
MAX_DESCRIPTION_LENGTH = 1024


def load_agent_config():
    """Load agent configuration from YAML."""
    with open(AGENT_CONFIG) as f:
        return yaml.safe_load(f)


def load_plugin_json():
    """Load plugin.json."""
    with open(PLUGIN_JSON) as f:
        return json.load(f)


def get_agent_names():
    """Get list of agent names from config."""
    config = load_agent_config()
    return list(config["agents"].keys())


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_file_exists(agent_name):
    """Agent file must exist at agents/<name>.md."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    assert agent_file.exists(), f"Agent file not found: {agent_file}"


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_registered_in_plugin_json(agent_name):
    """Agent must be registered in plugin.json agents array."""
    plugin = load_plugin_json()
    agents = plugin.get("agents", [])

    expected_path = f"./agents/{agent_name}.md"
    assert expected_path in agents, (
        f"Agent '{agent_name}' not registered in plugin.json. "
        f"Expected '{expected_path}' in agents array."
    )


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_has_required_frontmatter_fields(agent_name):
    """Agent must have name, description, model, and color in frontmatter."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    post = frontmatter.load(agent_file)

    for field in ["name", "description", "model", "color"]:
        assert field in post.metadata, f"Missing frontmatter field: {field}"


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_name_matches_filename(agent_name):
    """Agent frontmatter name must match the filename."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    post = frontmatter.load(agent_file)
    assert post.metadata.get("name") == agent_name, (
        f"Agent name '{post.metadata.get('name')}' doesn't match filename '{agent_name}'"
    )


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_description_valid(agent_name):
    """Agent description must be non-empty and within max length."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    post = frontmatter.load(agent_file)
    description = post.metadata.get("description")

    assert isinstance(description, str), "description must be a string"
    assert description.strip(), "description cannot be empty"
    assert len(description) <= MAX_DESCRIPTION_LENGTH, (
        f"description exceeds {MAX_DESCRIPTION_LENGTH} characters"
    )


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_color_matches_config(agent_name):
    """Agent color must match the expected value from agent-config.yaml."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    config = load_agent_config()
    expected_color = config["agents"][agent_name]["color"]

    post = frontmatter.load(agent_file)
    assert post.metadata.get("color") == expected_color, (
        f"Agent color '{post.metadata.get('color')}' doesn't match expected '{expected_color}'"
    )


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_model_matches_config(agent_name):
    """Agent model must match the expected value from agent-config.yaml."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    config = load_agent_config()
    expected_model = config["agents"][agent_name]["model"]

    post = frontmatter.load(agent_file)
    assert post.metadata.get("model") == expected_model, (
        f"Agent model '{post.metadata.get('model')}' doesn't match expected '{expected_model}'"
    )


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_skills_match_config(agent_name):
    """Agent skills must match the expected list from agent-config.yaml."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    config = load_agent_config()
    expected_skills = config["agents"][agent_name].get("skills", [])

    post = frontmatter.load(agent_file)
    actual_skills = post.metadata.get("skills", [])

    # Normalize to list if string
    if isinstance(actual_skills, str):
        actual_skills = [actual_skills]

    assert actual_skills == expected_skills, (
        f"Agent skills {actual_skills} don't match expected {expected_skills}"
    )


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_has_required_sections_in_order(agent_name):
    """Agent must have required sections in order per agent-config.yaml."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    config = load_agent_config()
    required_sections = config["agents"][agent_name]["sections"]

    content = agent_file.read_text()
    headings = extract_headings(content)
    heading_texts = [h["text"] for h in headings]

    last_index = -1
    for section in required_sections:
        expected_heading = section["heading"].lstrip("# ").strip()

        assert expected_heading in heading_texts, (
            f"Missing required section: '{section['heading']}'"
        )

        index = heading_texts.index(expected_heading)
        assert index > last_index, f"Section '{section['heading']}' is out of order"
        last_index = index


SKILLS_DIR = PROJECT_ROOT / "skills"


@pytest.mark.parametrize("agent_name", get_agent_names())
def test_agent_skill_references_resolve(agent_name):
    """Agent skills must reference existing skill directories with SKILL.md."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    post = frontmatter.load(agent_file)
    skills = post.metadata.get("skills", [])

    # Normalize to list if string
    if isinstance(skills, str):
        skills = [skills]

    for skill_name in skills:
        skill_dir = SKILLS_DIR / skill_name
        skill_file = skill_dir / "SKILL.md"

        assert skill_dir.exists(), (
            f"Agent '{agent_name}' references skill '{skill_name}' "
            f"but directory not found: {skill_dir}"
        )
        assert skill_file.exists(), (
            f"Agent '{agent_name}' references skill '{skill_name}' "
            f"but SKILL.md not found: {skill_file}"
        )


def extract_section_content(content: str, heading: str) -> str | None:
    """Extract the content of a markdown section by heading.

    Args:
        content: Full markdown content
        heading: The heading to find (e.g., "## Human Review")

    Returns:
        The section content (stripped), or None if not found.
    """
    # Escape special regex chars in heading and match it
    escaped_heading = re.escape(heading.lstrip("# ").strip())
    section_pattern = rf"^## {escaped_heading}\s*$"
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


def get_sections_with_content_refs():
    """Get list of (agent_name, section_heading, content_key) for sections with content refs."""
    config = load_agent_config()
    result = []
    for agent_name, agent_config in config["agents"].items():
        for section in agent_config.get("sections", []):
            if "content" in section:
                result.append((agent_name, section["heading"], section["content"]))
    return result


@pytest.mark.parametrize(
    "agent_name,section_heading,content_key",
    get_sections_with_content_refs(),
    ids=lambda x: x if isinstance(x, str) else None,
)
def test_agent_section_content_matches_canonical(agent_name, section_heading, content_key):
    """Agent section with content reference must contain canonical content verbatim."""
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        pytest.skip(f"Agent file not found: {agent_file}")

    config = load_agent_config()

    # Get canonical content from the referenced key
    canonical = config.get(content_key, {}).get("content", "")
    assert canonical, f"No content found at config key '{content_key}'"
    canonical = canonical.strip()

    # Extract section content from agent
    content = agent_file.read_text()
    section_content = extract_section_content(content, section_heading)
    assert section_content is not None, f"Agent {agent_name} missing section '{section_heading}'"

    assert canonical in section_content, (
        f"Agent {agent_name} section '{section_heading}' does not contain canonical content.\n"
        f"Expected:\n{canonical}\n\n"
        f"Found:\n{section_content}"
    )
