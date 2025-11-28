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


def load_shared_files_manifest():
    """Load the shared files manifest."""
    with open(TESTS_DIR / "shared-files.yaml") as f:
        return yaml.safe_load(f)


def get_skill_expected_files(skill_name: str, manifest: dict) -> list[str]:
    """Get list of files a skill should have based on its bundles."""
    skill_bundles = manifest.get("skill_files", {}).get(skill_name, [])
    bundles = manifest.get("bundles", {})

    files = []
    for bundle_name in skill_bundles:
        bundle_files = bundles.get(bundle_name, [])
        files.extend(bundle_files)

    return files


def get_skill_category(skill_name: str, spec: dict) -> dict:
    """Find the category info for a skill.

    Returns dict with 'name', 'required_sections', 'required_directories'.
    """
    for category_name, category in spec["categories"].items():
        if skill_name in category["skills"]:
            return {
                "name": category_name,
                "required_sections": category.get("required_sections", []),
                "required_directories": category.get("required_directories", []),
            }
    return {"name": "unknown", "required_sections": [], "required_directories": []}


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
    category = get_skill_category(skill_name, spec)

    assert category["name"] != "unknown", (
        f"Skill '{skill_name}' not found in any category in skill-structure-spec.yaml"
    )

    headings = extract_headings(sut)
    heading_texts = [f"## {h['text']}" for h in headings if h["level"] == 2]

    for section in category["required_sections"]:
        assert section in heading_texts, (
            f"Skill '{skill_name}' ({category['name']}): Missing required section '{section}'"
        )


def test_required_directories(skill_name):
    """Verify each skill has required subdirectories for its category."""
    skill_dir = SKILLS_DIR / skill_name

    spec = load_structure_spec()
    category = get_skill_category(skill_name, spec)

    for dir_name in category["required_directories"]:
        required_dir = skill_dir / dir_name
        assert required_dir.exists(), (
            f"Skill '{skill_name}' ({category['name']}): Missing required directory '{dir_name}'"
        )


def test_shared_files_exist(skill_name):
    """Verify each skill has all shared files it should receive."""
    skill_dir = SKILLS_DIR / skill_name

    manifest = load_shared_files_manifest()
    expected_files = get_skill_expected_files(skill_name, manifest)

    for file_path in expected_files:
        full_path = skill_dir / file_path
        assert full_path.exists(), f"Skill '{skill_name}' missing shared file '{file_path}'"


def get_all_source_files(manifest: dict) -> set[str]:
    """Get all unique source file paths from all bundles.

    Bundle paths are like '_shared/reference/foo.md'.
    Source files are in 'skills/_shared/reference/foo.md'.
    Returns paths relative to skills/_shared/ (e.g., 'reference/foo.md').
    """
    files = set()
    for bundle_files in manifest.get("bundles", {}).values():
        for file_path in bundle_files:
            # Strip _shared/ prefix to get source path
            if file_path.startswith("_shared/"):
                source_path = file_path[len("_shared/") :]
            else:
                source_path = file_path
            files.add(source_path)
    return files


def test_shared_source_files_exist():
    """Verify all source files referenced in bundles exist in skills/_shared/."""
    shared_source_dir = SKILLS_DIR / "_shared"
    manifest = load_shared_files_manifest()
    source_files = get_all_source_files(manifest)

    for source_path in sorted(source_files):
        full_path = shared_source_dir / source_path
        assert full_path.exists(), (
            f"Shared source file '{source_path}' missing from skills/_shared/"
        )
