"""Contract tests for skill file structure."""

from pathlib import Path

import frontmatter

SKILLS_DIR = Path(__file__).parent.parent / "skills"


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
