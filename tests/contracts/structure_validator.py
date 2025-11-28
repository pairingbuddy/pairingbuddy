from pathlib import Path

from .markdown import extract_headings
from .schema_loader import CategorySchema, SkillSchema


def validate_frontmatter(metadata: dict, schema: SkillSchema) -> list[str]:
    errors = []
    for rule in schema.frontmatter:
        if rule.name not in metadata:
            errors.append(f"Missing frontmatter field: {rule.name}")
            continue

        value = metadata[rule.name]

        if rule.type == "string" and not isinstance(value, str):
            errors.append(f"Frontmatter '{rule.name}' must be a string")

        if rule.min_length and len(str(value)) < rule.min_length:
            errors.append(f"Frontmatter '{rule.name}' must be at least {rule.min_length} chars")

    return errors


def validate_sections(content: str, category: CategorySchema) -> list[str]:
    errors = []
    headings = extract_headings(content)
    heading_texts = [f"## {h['text']}" for h in headings if h["level"] == 2]

    last_index = -1
    for section in category.sections:
        try:
            index = heading_texts.index(section.heading)
            if index < last_index:
                errors.append(f"Section out of order: {section.heading}")
            last_index = index
        except ValueError:
            errors.append(f"Missing section: {section.heading}")

    return errors


def validate_directories(skill_dir: Path, category: CategorySchema) -> list[str]:
    errors = []
    for dir_name in category.directories:
        if not (skill_dir / dir_name).exists():
            errors.append(f"Missing directory: {dir_name}")
    return errors
