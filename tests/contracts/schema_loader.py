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
class SkillSchema:
    frontmatter: list[FrontmatterRule]
    categories: dict[str, CategorySchema]

    def get_category_for_skill(self, skill_name: str) -> CategorySchema | None:
        for category in self.categories.values():
            if skill_name in category.skills:
                return category
        return None


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
    categories: dict[str, CategorySchema] = {}
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
        # Use sections from skill definition (all skills in same category have same structure)
        if not categories[cat_name].sections and "sections" in skill_def:
            categories[cat_name].sections = [
                SectionRule(heading=s["heading"]) for s in skill_def["sections"]
            ]

    return SkillSchema(frontmatter=frontmatter, categories=categories)
