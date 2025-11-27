"""Contract tests for skill file structure."""

from pathlib import Path

import frontmatter
import yaml

from tests.contracts.markdown import extract_headings

SKILLS_DIR = Path(__file__).parent.parent / "skills"
TESTS_DIR = Path(__file__).parent


def load_structure_spec():
    """Load the skill structure specification."""
    with open(TESTS_DIR / "skill-structure-spec.yaml") as f:
        return yaml.safe_load(f)


def get_skill_category(skill_name: str, spec: dict) -> tuple[str, list[str]]:
    """Find the category and required sections for a skill."""
    for category_name, category in spec["categories"].items():
        if skill_name in category["skills"]:
            return category_name, category["required_sections"]
    return "unknown", []


def test_skill_md_exists(skill_name):
    """Verify each skill has SKILL.md file in its directory."""
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"

    assert skill_dir.exists(), f"Skill '{skill_name}' missing directory at {skill_dir}"
    assert skill_md.exists(), f"Skill '{skill_name}' missing SKILL.md file at {skill_md}"


def test_valid_frontmatter(skill_name):
    """Verify each SKILL.md has valid frontmatter with required fields."""
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    sut = frontmatter.load(skill_md)

    assert "name" in sut.metadata, f"Skill '{skill_name}': Missing required field 'name'"
    assert isinstance(sut.metadata["name"], str), f"Skill '{skill_name}': 'name' must be a string"

    assert "description" in sut.metadata, (
        f"Skill '{skill_name}': Missing required field 'description'"
    )
    assert isinstance(sut.metadata["description"], str), (
        f"Skill '{skill_name}': 'description' must be a string"
    )
    assert len(sut.metadata["description"]) >= 20, (
        f"Skill '{skill_name}': Description too short "
        f"(min 20 chars, got {len(sut.metadata['description'])})"
    )


def test_required_sections(skill_name):
    """Verify each SKILL.md has required sections for its category."""
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    sut = skill_md.read_text()

    spec = load_structure_spec()
    category, required_sections = get_skill_category(skill_name, spec)

    assert category != "unknown", (
        f"Skill '{skill_name}' not found in any category in skill-structure-spec.yaml"
    )

    headings = extract_headings(sut)
    heading_texts = [f"## {h['text']}" for h in headings if h["level"] == 2]

    for section in required_sections:
        assert section in heading_texts, (
            f"Skill '{skill_name}' ({category}): Missing required section '{section}'"
        )
