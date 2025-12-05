"""Schema-based structural validation tests for skill files."""

from pathlib import Path

import frontmatter

from tests.contracts.schema_loader import load_schema
from tests.contracts.structure_validator import (
    validate_directories,
    validate_frontmatter,
    validate_sections,
)

SKILLS_DIR = Path(__file__).parent.parent / "skills"
SCHEMA = load_schema()


def test_frontmatter(old_skill_name):
    """Validate skill frontmatter against schema (OLD - will be removed in Phase 10)."""
    skill_md = SKILLS_DIR / old_skill_name / "SKILL.md"
    post = frontmatter.load(skill_md)
    category = SCHEMA.get_category_for_skill(old_skill_name)

    assert category is not None, f"Unknown skill: {old_skill_name}"

    errors = validate_frontmatter(post.metadata, SCHEMA)

    assert not errors, "\n".join(errors)


def test_sections(old_skill_name):
    """Validate skill sections against schema (OLD - will be removed in Phase 10)."""
    skill_md = SKILLS_DIR / old_skill_name / "SKILL.md"
    category = SCHEMA.get_category_for_skill(old_skill_name)

    assert category is not None, f"Unknown skill: {old_skill_name}"

    content = skill_md.read_text()
    errors = validate_sections(content, category)

    assert not errors, "\n".join(errors)


def test_directories(old_skill_name):
    """Validate skill directories against schema (OLD - will be removed in Phase 10)."""
    skill_dir = SKILLS_DIR / old_skill_name
    category = SCHEMA.get_category_for_skill(old_skill_name)

    assert category is not None, f"Unknown skill: {old_skill_name}"

    errors = validate_directories(skill_dir, category)

    assert not errors, "\n".join(errors)
