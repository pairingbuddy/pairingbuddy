"""Validation tests for skill files.

Tests skill structure (frontmatter, sections, directories) and
references (file links, skill references).
"""

from pathlib import Path

import frontmatter
import pytest
import yaml

from tests.contracts.parsers import (
    extract_file_references,
    extract_skill_references,
    find_bare_references,
)
from tests.contracts.schema_loader import load_schema
from tests.contracts.structure_validator import (
    validate_directories,
    validate_frontmatter,
    validate_sections,
)

SKILLS_DIR = Path(__file__).parent.parent / "skills"
CONFIG_PATH = Path(__file__).parent.parent / "contracts" / "skill-config.yaml"
SCHEMA = load_schema()


def load_config():
    """Load the skill config."""
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def get_all_skills():
    """Get all skill names from config."""
    return list(load_config()["skills"].keys())


ALL_SKILLS = get_all_skills()


# =============================================================================
# Structure Tests
# =============================================================================


@pytest.mark.parametrize("skill_name", ALL_SKILLS)
def test_frontmatter(skill_name):
    """Validate skill frontmatter against schema."""
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    post = frontmatter.load(skill_md)
    category = SCHEMA.get_category_for_skill(skill_name)

    assert category is not None, f"Unknown skill: {skill_name}"

    errors = validate_frontmatter(post.metadata, SCHEMA)

    assert not errors, "\n".join(errors)


@pytest.mark.parametrize("skill_name", ALL_SKILLS)
def test_sections(skill_name):
    """Validate skill sections against skill-specific schema."""
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    skill_def = SCHEMA.get_skill_definition(skill_name)

    assert skill_def is not None, f"Unknown skill: {skill_name}"

    content = skill_md.read_text()
    errors = validate_sections(content, skill_def)

    assert not errors, "\n".join(errors)


@pytest.mark.parametrize("skill_name", ALL_SKILLS)
def test_directories(skill_name):
    """Validate skill directories against skill-specific schema."""
    skill_dir = SKILLS_DIR / skill_name
    skill_def = SCHEMA.get_skill_definition(skill_name)

    assert skill_def is not None, f"Unknown skill: {skill_name}"

    errors = validate_directories(skill_dir, skill_def)

    assert not errors, "\n".join(errors)


# =============================================================================
# Reference Tests
# =============================================================================


@pytest.mark.parametrize("skill_name", ALL_SKILLS)
def test_file_references_use_markdown_links(skill_name):
    """Verify all file/URL references use markdown link syntax [text](path).

    Bare references like `path/file.md` or bare URLs are not allowed.
    Code blocks are excluded from this check.
    """
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_md.exists():
        return  # Other tests will catch missing SKILL.md

    content = skill_md.read_text()
    bare_refs = find_bare_references(content)

    assert not bare_refs, (
        f"Skill '{skill_name}': Non-markdown-link references found - use [text](path) syntax:\n"
        + "\n".join(f"  - {ref}" for ref in bare_refs)
    )


@pytest.mark.parametrize("skill_name", ALL_SKILLS)
def test_file_references_exist(skill_name):
    """Verify all files referenced via markdown links exist."""
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return  # Other tests will catch missing SKILL.md

    content = skill_md.read_text()
    file_refs = extract_file_references(content)

    for file_path in file_refs:
        full_path = skill_dir / file_path
        assert full_path.exists(), (
            f"Skill '{skill_name}': References non-existent file '{file_path}'"
        )


@pytest.mark.parametrize("skill_name", ALL_SKILLS)
def test_skill_references_valid(skill_name):
    """Verify all skill references are valid (local or declared external)."""
    skill_dir = SKILLS_DIR / skill_name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return  # Other tests will catch missing SKILL.md

    content = skill_md.read_text()
    skill_refs = extract_skill_references(content)

    if not skill_refs:
        return  # No skill references to validate

    config = load_config()
    plugin_name = config.get("plugin_name", "pairingbuddy")
    local_skills = set(config.get("skills", {}).keys())
    external_skills = config.get("external_skills", {})

    for ref_plugin, ref_skill in skill_refs:
        if ref_plugin == plugin_name:
            # Internal reference - skill must exist locally
            assert ref_skill in local_skills, (
                f"Skill '{skill_name}': References unknown local skill "
                f"'@{ref_plugin}:{ref_skill}' - not found in skills list"
            )
        else:
            # External reference - must be declared in external_skills
            declared_external = external_skills.get(ref_plugin, [])
            assert ref_skill in declared_external, (
                f"Skill '{skill_name}': References external skill "
                f"'@{ref_plugin}:{ref_skill}' - not declared in external_skills"
            )
