"""Contract tests for skill file structure."""

from pathlib import Path


def test_skill_md_exists(skill_name):
    """Verify each skill has SKILL.md file in its directory.

    Parametrized test that checks:
    1. Skill directory exists at skills/{skill_name}/
    2. SKILL.md file exists in that directory
    """
    skills_dir = Path(__file__).parent.parent / "skills"
    skill_dir = skills_dir / skill_name

    assert skill_dir.exists(), f"Skill '{skill_name}' missing directory at {skill_dir}"

    skill_md = skill_dir / "SKILL.md"
    assert skill_md.exists(), f"Skill '{skill_name}' missing SKILL.md file at {skill_md}"
