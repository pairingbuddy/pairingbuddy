"""Structural validation tests for reference skills."""

import re
from pathlib import Path

import frontmatter
import pytest
import yaml

PROJECT_ROOT = Path(__file__).parent.parent.parent
SKILLS_DIR = PROJECT_ROOT / "skills"
SKILL_CONFIG = PROJECT_ROOT / "contracts" / "skill-config.yaml"

# Maximum lengths per Claude Code docs
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_SKILL_LINES = 500
TOC_REQUIRED_LINE_THRESHOLD = 100


def load_skill_config():
    """Load skill configuration from YAML."""
    with open(SKILL_CONFIG) as f:
        return yaml.safe_load(f)


def get_reference_skills() -> list[str]:
    """Get list of reference skill names from config."""
    config = load_skill_config()
    return [name for name, cfg in config["skills"].items() if cfg.get("category") == "reference"]


# Parameterize tests over all reference skills
REFERENCE_SKILLS = get_reference_skills()


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_skill_file_exists(skill_name):
    """SKILL.md exists at expected path."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    assert skill_file.exists(), f"Skill file not found at {skill_file}"


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_skill_has_required_frontmatter(skill_name):
    """Frontmatter has name (≤64 chars) and description (≤1024 chars)."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        pytest.skip(f"Skill file does not exist: {skill_file}")

    post = frontmatter.load(skill_file)

    # Name must exist and be within length limit
    name = post.metadata.get("name")
    assert name is not None, "Frontmatter missing 'name' field"
    assert isinstance(name, str), "name must be a string"
    assert len(name) <= MAX_NAME_LENGTH, f"name exceeds {MAX_NAME_LENGTH} characters: {len(name)}"

    # Description must exist and be within length limit
    description = post.metadata.get("description")
    assert description is not None, "Frontmatter missing 'description' field"
    assert isinstance(description, str), "description must be a string"
    assert description.strip(), "description cannot be empty"
    assert len(description) <= MAX_DESCRIPTION_LENGTH, (
        f"description exceeds {MAX_DESCRIPTION_LENGTH} characters: {len(description)}"
    )


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_skill_name_matches_directory(skill_name):
    """Frontmatter name matches directory name."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        pytest.skip(f"Skill file does not exist: {skill_file}")

    post = frontmatter.load(skill_file)
    name = post.metadata.get("name")

    assert name == skill_name, f"Frontmatter name '{name}' does not match directory '{skill_name}'"


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_skill_under_500_lines(skill_name):
    """SKILL.md body under 500 lines."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        pytest.skip(f"Skill file does not exist: {skill_file}")

    post = frontmatter.load(skill_file)
    content_lines = post.content.strip().split("\n")
    line_count = len(content_lines)

    assert line_count <= MAX_SKILL_LINES, (
        f"SKILL.md has {line_count} lines, exceeds {MAX_SKILL_LINES} line limit"
    )


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_skill_has_required_sections(skill_name):
    """SKILL.md has required sections from config."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        pytest.skip(f"Skill file does not exist: {skill_file}")

    config = load_skill_config()
    required_sections = config["skills"][skill_name].get("sections", [])

    content = skill_file.read_text()

    for section in required_sections:
        heading = section["heading"]
        assert heading in content, f"Missing required section: '{heading}'"


def extract_markdown_links(content: str) -> list[str]:
    """Extract relative markdown links like [text](./file.md)."""
    # Match [text](./path) or [text](path.md) - relative links only
    pattern = r"\[([^\]]+)\]\((\./[^)]+|[^/)][^)]*\.md)\)"
    matches = re.findall(pattern, content)
    return [match[1] for match in matches]


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_skill_links_resolve(skill_name):
    """All markdown links [text](./file.md) point to existing files."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        pytest.skip(f"Skill file does not exist: {skill_file}")

    skill_dir = skill_file.parent
    content = skill_file.read_text()
    links = extract_markdown_links(content)

    missing = []
    for link in links:
        # Skip anchor links
        if link.startswith("#"):
            continue

        # Resolve relative path
        linked_file = (skill_dir / link).resolve()
        if not linked_file.exists():
            missing.append(link)

    assert not missing, f"Links to non-existent files: {missing}"


@pytest.mark.parametrize("skill_name", REFERENCE_SKILLS)
def test_linked_files_have_toc_if_over_100_lines(skill_name):
    """Files >100 lines have ## Contents section."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_file.exists():
        pytest.skip(f"Skill file does not exist: {skill_file}")

    skill_dir = skill_file.parent
    content = skill_file.read_text()
    links = extract_markdown_links(content)

    files_needing_toc = []
    for link in links:
        # Skip anchor links and non-md files
        if link.startswith("#") or not link.endswith(".md"):
            continue

        linked_file = (skill_dir / link).resolve()
        if not linked_file.exists():
            continue

        file_content = linked_file.read_text()
        line_count = len(file_content.strip().split("\n"))

        needs_toc = line_count > TOC_REQUIRED_LINE_THRESHOLD
        missing_toc = "## Contents" not in file_content
        if needs_toc and missing_toc:
            files_needing_toc.append(f"{link} ({line_count} lines)")

    assert not files_needing_toc, f"Files >100 lines missing '## Contents': {files_needing_toc}"
