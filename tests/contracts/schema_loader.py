from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class FrontmatterRule:
    name: str
    type: str
    min_length: int | None = None


@dataclass
class SectionRule:
    heading: str


@dataclass
class CategorySchema:
    name: str
    skills: list[str]
    sections: list[SectionRule]
    directories: list[str]


@dataclass
class SkillDefinition:
    name: str
    category: str
    sections: list[SectionRule]
    directories: list[str]


@dataclass
class SkillSchema:
    frontmatter: list[FrontmatterRule]
    categories: dict[str, CategorySchema]
    skills: dict[str, SkillDefinition]

    def get_category_for_skill(self, skill_name: str) -> CategorySchema | None:
        """Get category schema for backward compatibility."""
        for category in self.categories.values():
            if skill_name in category.skills:
                return category
        return None

    def get_skill_definition(self, skill_name: str) -> SkillDefinition | None:
        """Get skill-specific definition with its own sections."""
        return self.skills.get(skill_name)


def load_schema(schema_path: Path | None = None) -> SkillSchema:
    if schema_path is None:
        schema_path = Path(__file__).parent.parent.parent / "contracts" / "skill-config.yaml"

    with open(schema_path) as f:
        raw = yaml.safe_load(f)

    frontmatter = []
    for name, rules in raw["frontmatter"]["required"].items():
        frontmatter.append(
            FrontmatterRule(
                name=name,
                type=rules["type"],
                min_length=rules.get("min_length"),
            )
        )

    # Build categories by grouping skills by their category field
    # Also build per-skill definitions for skill-specific section validation
    categories: dict[str, CategorySchema] = {}
    skills: dict[str, SkillDefinition] = {}

    for skill_name, skill_def in raw["skills"].items():
        cat_name = skill_def["category"]
        if cat_name not in categories:
            categories[cat_name] = CategorySchema(
                name=cat_name,
                skills=[],
                sections=[],
                directories=[],
            )
        categories[cat_name].skills.append(skill_name)

        # Store per-skill definition with its own sections
        skill_sections = []
        if "sections" in skill_def:
            skill_sections = [SectionRule(heading=s["heading"]) for s in skill_def["sections"]]

        skills[skill_name] = SkillDefinition(
            name=skill_name,
            category=cat_name,
            sections=skill_sections,
            directories=skill_def.get("directories", []),
        )

        # For backward compatibility, also populate category sections from first skill
        if not categories[cat_name].sections and skill_sections:
            categories[cat_name].sections = skill_sections

    return SkillSchema(frontmatter=frontmatter, categories=categories, skills=skills)
