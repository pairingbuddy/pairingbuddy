"""The ledger validator and contracts/schemas/ledger.schema.json must agree.

tests/fixtures/ledger/validity-table.json holds one valid base ledger plus small cases, each a patch
over the base. The table is materialized here, then checked by the JS validator
(shared-node/ledger.mjs, through a small node script fed on stdin) and by jsonschema.
"""

import copy
import json
import subprocess
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "ledger" / "validity-table.json"
SCHEMA = ROOT / "contracts" / "schemas" / "ledger.schema.json"

NODE_VALIDATE = """
import { readFileSync } from "node:fs";
const { validateLedger } = await import(process.argv[1]);
const cases = JSON.parse(readFileSync(0, "utf8"));
const verdicts = {};
for (const { name, ledger } of cases) verdicts[name] = validateLedger(ledger).valid;
process.stdout.write(JSON.stringify(verdicts));
"""


def _walk(document, dotted):
    *parents, last = dotted.split(".")
    node = document
    for part in parents:
        node = node[int(part)] if isinstance(node, list) else node[part]
    return node, (int(last) if isinstance(node, list) else last)


def _materialize(base, case):
    if "replace" in case:
        return copy.deepcopy(case["replace"])
    ledger = copy.deepcopy(base)
    for path, value in case.get("set", {}).items():
        node, key = _walk(ledger, path)
        node[key] = value
    for path in case.get("remove", []):
        node, key = _walk(ledger, path)
        del node[key]
    return ledger


def _table():
    raw = json.loads(FIXTURE.read_text())
    base = raw["base"]
    return base, [
        {"name": case["name"], "ledger": _materialize(base, case), "expected": expected}
        for group, expected in (("valid", True), ("invalid", False))
        for case in raw[group]
    ]


BASE, CASES = _table()


def _js_verdicts():
    module_url = (ROOT / "shared-node" / "ledger.mjs").as_uri()
    payload = json.dumps([{"name": c["name"], "ledger": c["ledger"]} for c in CASES])
    result = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_VALIDATE, module_url],
        input=payload,
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=30,
    )
    assert result.returncode == 0, f"node validator script failed: {result.stderr}"
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def verdicts():
    schema = json.loads(SCHEMA.read_text())
    jsonschema.Draft202012Validator.check_schema(schema)
    validator = jsonschema.Draft202012Validator(schema)
    js = _js_verdicts()
    return {c["name"]: (js[c["name"]], validator.is_valid(c["ledger"])) for c in CASES}


# ledger-validation
@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_validator_matches_schema_on_fixture_table(verdicts, case):
    name, expected = case["name"], case["expected"]
    js_verdict, schema_verdict = verdicts[name]

    js_msg = f"{name}: JS validator said {js_verdict}, fixture says {expected}"
    schema_msg = f"{name}: jsonschema said {schema_verdict}, fixture says {expected}"
    assert js_verdict == expected, js_msg
    assert schema_verdict == expected, schema_msg


# ledger-validation
def test_every_required_top_level_key_has_a_missing_field_case():
    required = json.loads(SCHEMA.read_text())["required"]
    names = {c["name"] for c in CASES if not c["expected"]}

    missing = [key for key in required if f"missing-{key}" not in names]

    assert missing == [], f"fixture lacks a missing-field case for: {missing}"


# ledger-validation
def test_every_case_but_minimal_differs_from_the_base():
    unchanged = [c["name"] for c in CASES if c["ledger"] == BASE and c["name"] != "minimal"]

    assert unchanged == [], f"cases that patch nothing prove nothing: {unchanged}"


# ledger-validation
def test_null_stop_and_needs_human_are_covered_by_the_base():
    assert BASE["stop"] is None, "base carries a null stop"
    assert BASE["needsHuman"] is None, "base carries a null needsHuman"
