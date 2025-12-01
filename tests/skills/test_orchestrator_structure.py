"""Structural validation tests for the orchestrator skill."""

import ast
import re
from pathlib import Path

import frontmatter
import yaml

from tests.contracts.markdown import extract_headings

SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"
ORCHESTRATOR_SKILL = SKILLS_DIR / "coding" / "SKILL.md"
SKILL_CONFIG = Path(__file__).parent / "skill-config.yaml"

# Maximum description length per Claude Code docs
MAX_DESCRIPTION_LENGTH = 1024


def load_skill_config():
    """Load skill configuration from YAML."""
    with open(SKILL_CONFIG) as f:
        return yaml.safe_load(f)


def test_orchestrator_skill_exists():
    """The orchestrator skill must exist at skills/coding/SKILL.md."""
    assert ORCHESTRATOR_SKILL.exists(), f"Orchestrator skill not found at {ORCHESTRATOR_SKILL}"


def test_orchestrator_has_required_frontmatter():
    """Orchestrator skill must have name and description in frontmatter."""
    post = frontmatter.load(ORCHESTRATOR_SKILL)

    # Name must be exactly "coding"
    assert post.metadata.get("name") == "coding", (
        f"Expected name 'coding', got '{post.metadata.get('name')}'"
    )

    # Description must be a non-empty string within max length
    description = post.metadata.get("description")
    assert isinstance(description, str), "description must be a string"
    assert description.strip(), "description cannot be empty"
    assert len(description) <= MAX_DESCRIPTION_LENGTH, (
        f"description exceeds {MAX_DESCRIPTION_LENGTH} characters"
    )


def test_orchestrator_has_required_sections_in_order():
    """Orchestrator skill must have required sections in order per skill-config.yaml."""
    config = load_skill_config()
    required_sections = config["skills"]["coding"]["sections"]

    content = ORCHESTRATOR_SKILL.read_text()
    headings = extract_headings(content)
    heading_texts = [h["text"] for h in headings]

    last_index = -1
    for section in required_sections:
        # Extract just the heading text (without ##)
        expected_heading = section["heading"].lstrip("# ").strip()

        assert expected_heading in heading_texts, (
            f"Missing required section: '{section['heading']}'"
        )

        index = heading_texts.index(expected_heading)
        assert index > last_index, f"Section '{section['heading']}' is out of order"
        last_index = index


def test_sections_requiring_python_code_block():
    """Sections with requires_python_code_block must contain a Python code block."""
    config = load_skill_config()
    sections = config["skills"]["coding"]["sections"]
    content = ORCHESTRATOR_SKILL.read_text()

    for section in sections:
        if section.get("requires_python_code_block"):
            heading = section["heading"].lstrip("# ").strip()

            # Find the section and check for python code block
            # Pattern: ## <heading> followed by ```python before next ## heading
            pattern = rf"## {re.escape(heading)}\s*(.*?)(?=\n## |\Z)"
            match = re.search(pattern, content, re.DOTALL)

            assert match, f"Could not find section: ## {heading}"

            section_content = match.group(1)
            assert "```python" in section_content, (
                f"Section '## {heading}' must contain a ```python code block"
            )


def extract_python_code_block(content: str, section_heading: str) -> str | None:
    """Extract Python code block from a section."""
    # Find the section
    pattern = rf"## {re.escape(section_heading)}\s*(.*?)(?=\n## |\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return None

    section_content = match.group(1)

    # Extract python code block
    code_pattern = r"```python\s*(.*?)```"
    code_match = re.search(code_pattern, section_content, re.DOTALL)
    if not code_match:
        return None

    return code_match.group(1).strip()


def test_workflow_pseudocode_is_valid_python():
    """The Python code block in Workflow section must be syntactically valid."""
    config = load_skill_config()
    sections = config["skills"]["coding"]["sections"]
    content = ORCHESTRATOR_SKILL.read_text()

    for section in sections:
        if section.get("requires_python_code_block"):
            heading = section["heading"].lstrip("# ").strip()
            code = extract_python_code_block(content, heading)

            assert code is not None, f"Could not extract Python code block from ## {heading}"

            try:
                ast.parse(code)
            except SyntaxError as e:
                raise AssertionError(f"Python code in ## {heading} has syntax error: {e}") from e
