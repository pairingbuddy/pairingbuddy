// Every StructuredOutput call in the workflow agents' transcripts of tests/smoke/recordings/s4-t85-run4, read the way
// tests/smoke/run-recorder.mjs reads them for calls.jsonl (t from the line's timestamp against the recording's start).
// Local paths are replaced by <plugin>, <smoke> and <transcripts>.
export default [
 {
  "t": 47.285,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a0c95bf9c8863385c",
  "input": {
   "pb_key": "code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1",
   "ambiguity": "",
   "scenarios": [
    {
     "scenario_id": "apply-discount-percent",
     "description": "apply_discount subtracts a percentage discount from the price. The task scopes this to one regression case, where a 10% discount on 100 gives 90.",
     "test_cases": [
      {
       "test_case_id": "apply-discount-10-percent-on-100-returns-90",
       "description": "apply_discount(100, 10) returns 90, not 10."
      }
     ]
    }
   ]
  }
 },
 {
  "t": 49.795,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a046c7fd79050a165",
  "input": {
   "pb_key": "code-scenarios.runner.-.r1.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"paths\":[],\"taskType\":\"bug_fix\",\"rolledBack\":0}"
  }
 },
 {
  "t": 52.03,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aafdec40a58718096",
  "input": {
   "pb_key": "code-scenarios.lens.necessity.r1.a1",
   "ambiguity": null,
   "findings": []
  }
 },
 {
  "t": 54.944,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aaff1db8587d8313b",
  "input": {
   "pb_key": "code-scenarios.runner.-.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"stage\":\"code-scenarios\",\"attempt\":1,\"agents\":4,\"report\":\"<smoke>/repo/.pairingbuddy/run/task/report.json\"}"
  }
 },
 {
  "t": 66.459,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a9efd91f5d51c51c6",
  "input": {
   "pb_key": "code-tdd.runner.-.r1.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"taskType\":\"bug_fix\",\"scenarios\":\".pairingbuddy/run/task/artifacts/code-scenarios.enumerate-scenarios-and-test-cases.-.r1.a1.json\",\"tests\":null,\"red\":[],\"green\":[],\"covered\":[],\"testRunners\":{\"pytest\":{\"test_directory\":\"tests\",\"file_pattern\":\"test_*.py\"}}}"
  }
 },
 {
  "t": 76.689,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ac614987d406af2fd",
  "input": {
   "pb_key": "code-tdd.create-test-placeholders.-.r1.a1",
   "ambiguity": "",
   "commit_subject": "test: add placeholder for apply_discount(100, 10) returning 90",
   "files_changed": [
    "tests/test_discount.py"
   ],
   "tests": [
    {
     "test_id": "apply-discount-10-percent-100-returns-90",
     "test_case_id": "apply-discount-10-percent-on-100-returns-90",
     "scenario_id": "apply-discount-percent",
     "runner_id": "pytest",
     "test_file": "tests/test_discount.py",
     "test_function": "test_apply_discount_10_percent_on_100_returns_90"
    }
   ]
  }
 },
 {
  "t": 79.696,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a179508dddd1e9d02",
  "input": {
   "pb_key": "code-tdd.runner.-.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"placeholders\",\"key\":\"code-tdd.create-test-placeholders.-.r1.a1\",\"committed\":true,\"sha\":\"aa15bc159435d47d693f419e7c4344403c0f5ea5\",\"message\":\"test: add placeholder for apply_discount(100, 10) returning 90\",\"paths\":[\"tests/test_discount.py\"],\"hookRetried\":false}"
  }
 },
 {
  "t": 91.629,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a2bf30b22206e6e9f",
  "input": {
   "pb_key": "code-tdd.implement-tests.apply-discount-10-percent-100-returns-90.r1.a1",
   "ambiguity": "",
   "commit_subject": "test: assert apply_discount(100, 10) returns 90",
   "files_changed": [
    "tests/test_discount.py"
   ]
  }
 },
 {
  "t": 95.143,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a8b10520ea0e6141e",
  "input": {
   "pb_key": "code-tdd.runner.apply-discount-10-percent-100-returns-90.r1.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"red\",\"key\":\"code-tdd.implement-tests.apply-discount-10-percent-100-returns-90.r1.a1\",\"committed\":true,\"sha\":\"a8cc3713a274270712cd5109e113a719aaa89168\",\"message\":\"test: assert apply_discount(100, 10) returns 90\",\"paths\":[\"tests/test_discount.py\"],\"hookRetried\":false}"
  }
 },
 {
  "t": 104.414,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a2cf1725cf233b2b2",
  "input": {
   "pb_key": "code-tdd.implement-code.apply-discount-10-percent-100-returns-90.r1.a1",
   "ambiguity": "",
   "commit_subject": "fix: apply_discount returns price after discount",
   "files_changed": [
    "discount.py"
   ]
  }
 },
 {
  "t": 108.412,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a826fec0308830363",
  "input": {
   "pb_key": "code-tdd.runner.apply-discount-10-percent-100-returns-90.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"green\",\"key\":\"code-tdd.implement-code.apply-discount-10-percent-100-returns-90.r1.a1\",\"committed\":true,\"sha\":\"13807d701b7ba7dd12f8a5a0f574f316c836a77d\",\"message\":\"fix: apply_discount returns price after discount\",\"paths\":[\"discount.py\"],\"hookRetried\":false}"
  }
 },
 {
  "t": 115.187,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ad00cb1c640a7833e",
  "input": {
   "pb_key": "code-tdd.verify-test-coverage.-.r1.a1",
   "ambiguity": "",
   "status": "complete",
   "scenarios_covered": 1,
   "scenarios_total": 1,
   "test_cases_covered": 1,
   "test_cases_total": 1,
   "gaps": []
  }
 },
 {
  "t": 118.29,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a60741545070c460e",
  "input": {
   "pb_key": "code-tdd.runner.-.r3.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"stage\":\"code-tdd\",\"attempt\":1,\"agents\":9,\"report\":\"<smoke>/repo/.pairingbuddy/run/task/report.json\"}"
  }
 },
 {
  "t": 128.713,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a20682f4f2f7fb85a",
  "input": {
   "pb_key": "code-safety-net.runner.-.r1.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"paths\":[\".gitignore\",\"README.md\",\"pytest.ini\"],\"taskType\":\"bug_fix\",\"rolledBack\":0}"
  }
 },
 {
  "t": 134.036,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a9b5e6d1baaec264d",
  "input": {
   "pb_key": "code-safety-net.lens.code.r1.a1",
   "ambiguity": null,
   "findings": [
    {
     "rule": "",
     "severity": "low",
     "kind": "fix-here",
     "claim": "The new test binds `sut = apply_discount` and calls `sut(100, 10)` for no reason. Calling apply_discount(100, 10) directly is clearer and matches the rest of the file. The fix itself, price * (100 - percent) / 100, correctly yields 90.0 for (100, 10).",
     "where": "tests/test_discount.py:21"
    }
   ]
  }
 },
 {
  "t": 134.414,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aa9f8983e41a71966",
  "input": {
   "pb_key": "code-safety-net.lens.corpus-misalignment.r1.a1",
   "ambiguity": null,
   "findings": [
    {
     "rule": "",
     "severity": "medium",
     "kind": "fix-here",
     "claim": "README.md line 3 documents that apply_discount(price, percent) returns the discount amount, so apply_discount(100, 10) is 10. The diff changes discount.py to return the price after discount (90), so the README now states the old, incorrect behavior and contradicts the code.",
     "where": "README.md:3"
    }
   ]
  }
 },
 {
  "t": 134.423,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a8adc8191c10f9b5b",
  "input": {
   "pb_key": "code-safety-net.lens.tests.r1.a1",
   "ambiguity": null,
   "findings": [
    {
     "rule": "",
     "severity": "low",
     "kind": "drift",
     "claim": "The new test binds `sut = apply_discount` before calling it, which adds an indirection that the other test in the file does not use and does nothing for the regression check. Calling apply_discount(100, 10) directly would be clearer.",
     "where": "tests/test_discount.py:20-25"
    }
   ]
  }
 },
 {
  "t": 137.959,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aaec73b4839fb2989",
  "input": {
   "pb_key": "code-safety-net.refuter.corpus-misalignment-1.r1.a1",
   "finding_id": "corpus-misalignment-1",
   "verdict": "survives",
   "ambiguity": null
  }
 },
 {
  "t": 138.31,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a1e99ff9d256a11e8",
  "input": {
   "pb_key": "code-safety-net.refuter.tests-1.r1.a1",
   "finding_id": "tests-1",
   "verdict": "survives",
   "ambiguity": "The finding's assumption is that `sut = apply_discount` is a pure alias with no effect on the test. The file confirms this: lines 9-11 bind the function and call it once, with no mocking, patching, or parametrization that the alias would enable. The finding is a style point, and the rule field is empty, so it carries no severity beyond clarity. I did not check the other test beyond reading it, and I did not check whether the repo's style guide prefers aliasing."
  }
 },
 {
  "t": 139.629,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a0f7351bc3f024d37",
  "input": {
   "pb_key": "code-safety-net.refuter.code-1.r1.a1",
   "finding_id": "code-1",
   "verdict": "survives",
   "ambiguity": "The finding cites tests/test_discount.py:21, but the file has only 14 lines and the alias is at line 9. The finding's substance still matches the code at lines 8-13. The claim that the alias `sut = apply_discount` adds nothing holds, since the test calls the function directly through the alias. The claim that the fix yields 90 for (100, 10) also holds: 100 * 90 / 100 = 90.0, which equals 90. The \"matches the rest of the file\" part is only loosely supported, because the other test calls apply_discount directly, which is consistent with the finding."
  }
 },
 {
  "t": 147.564,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a5b413a4e1a9c5070",
  "input": {
   "pb_key": "code-safety-net.fix.g1.r2.a1",
   "ambiguity": "",
   "commit_subject": "test: call apply_discount directly in 10% discount test",
   "approach": "Remove the unnecessary `sut` alias and call apply_discount(100, 10) directly in the test body.",
   "files_changed": [
    "tests/test_discount.py"
   ]
  }
 },
 {
  "t": 151.064,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a720205b99293d075",
  "input": {
   "pb_key": "code-safety-net.runner.g1.r2.a1",
   "cli_exit_code": 1,
   "cli_output": "Exit code 1\npb: the tests failed, so nothing was committed: exit codes 1"
  }
 },
 {
  "t": 155.866,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aea61131cdf6bb584",
  "input": {
   "pb_key": "code-safety-net.runner.g1-rollback.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"key\":\"code-safety-net.fix.g1.r2.a1\",\"note\":\"smoke S4 fixture: the first safety-net fix's test run is forced red\\n\",\"failedAttempts\":1,\"maxAttempts\":5,\"stopped\":false}"
  }
 },
 {
  "t": 163.454,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aa137156e85d43660",
  "input": {
   "pb_key": "code-safety-net.fix.g1.r3.a1",
   "ambiguity": "No change made. The only fix for finding code-1 (inline apply_discount in the test, dropping the `sut` alias) is the approach listed in rejected_approaches, and an earlier attempt with it was rolled back. The finding is low severity and non-blocking, and the test already passes with the alias, so there is no other approach that resolves it without cosmetic churn. The working tree is clean and tests/test_discount.py and discount.py are unchanged.",
   "commit_subject": "",
   "approach": "",
   "files_changed": []
  }
 },
 {
  "t": 165.951,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ada27c78172015e6f",
  "input": {
   "pb_key": "code-safety-net.runner.g1.r3.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"fix\",\"key\":\"code-safety-net.fix.g1.r3.a1\",\"committed\":false}"
  }
 },
 {
  "t": 173.049,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a94b703ee4b2c2000",
  "input": {
   "pb_key": "code-safety-net.fix.g2.r4.a1",
   "ambiguity": "",
   "commit_subject": "docs: README states apply_discount returns price after discount",
   "approach": "Correct the stale README sentence so it describes the price-after-discount return value and gives 90 for apply_discount(100, 10).",
   "files_changed": [
    "README.md"
   ]
  }
 },
 {
  "t": 176.361,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a0a5745d1958aebb4",
  "input": {
   "pb_key": "code-safety-net.runner.g2.r4.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"fix\",\"key\":\"code-safety-net.fix.g2.r4.a1\",\"committed\":true,\"sha\":\"27d48fce359b7c31ed4807b44f21bc2848b86ada\",\"message\":\"refactor: README states apply_discount returns price after discount\",\"paths\":[\"README.md\"],\"hookRetried\":false}"
  }
 },
 {
  "t": 180.17,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "acec86e5187b53820",
  "input": {
   "pb_key": "code-safety-net.course-checker.g2.r4.a1",
   "finding_id": "corpus-misalignment-1",
   "verdict": "better",
   "mistake": "none",
   "what_went_wrong": ""
  }
 },
 {
  "t": 188.893,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ad95ff85bb1a9e422",
  "input": {
   "pb_key": "code-safety-net.fix.g3.r5.a1",
   "ambiguity": "",
   "commit_subject": "test: call apply_discount directly in 10% discount regression test",
   "approach": "Inline the apply_discount call in the regression test and drop the sut alias, leaving the test name and assertion unchanged.",
   "files_changed": [
    "tests/test_discount.py"
   ]
  }
 },
 {
  "t": 192.173,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a686207fab23aa926",
  "input": {
   "pb_key": "code-safety-net.runner.g3.r5.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"fix\",\"key\":\"code-safety-net.fix.g3.r5.a1\",\"committed\":true,\"sha\":\"ca0cd1a487723c335b683bf7a8388c99dcfb0e40\",\"message\":\"test: call apply_discount directly in 10% discount regression test\",\"paths\":[\"tests/test_discount.py\"],\"hookRetried\":false}"
  }
 },
 {
  "t": 195.8,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a8067855fee0882db",
  "input": {
   "pb_key": "code-safety-net.course-checker.g3.r5.a1",
   "finding_id": "tests-1",
   "verdict": "better",
   "mistake": "none",
   "what_went_wrong": ""
  }
 },
 {
  "t": 199.067,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a06b8550a990d5760",
  "input": {
   "pb_key": "code-safety-net.update-documentation.-.r1.a1",
   "ambiguity": "",
   "commit_subject": "",
   "files_changed": []
  }
 },
 {
  "t": 206.558,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a27f8ce20a9f69cda",
  "input": {
   "pb_key": "code-safety-net.runner.-.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"step\":\"docs\",\"key\":\"code-safety-net.update-documentation.-.r1.a1\",\"committed\":false}\n{\"ok\":true,\"key\":\"full\",\"stage\":\"code-safety-net\",\"attempt\":1,\"passed\":true,\"red\":false,\"runs\":[{\"runner\":\"pytest\",\"argv\":[\"node\",\"<plugin>/tests/smoke/force-red.mjs\",\"<smoke>/force-red.marker\",\"uv\",\"run\",\"--no-project\",\"--with\",\"pytest\",\"pytest\",\"tests\",\"-q\"],\"exitCode\":0,\"signal\":null,\"timedOut\":false,\"durationMs\":392,\"excerpt\":\"..                                                                       [100%]\\n2 passed in 0.00s\\n\",\"excerptTruncated\":false}],\"head\":\"ca0cd1a487723c335b683bf7a8388c99dcfb0e40\"}\n{\"ok\":true,\"stage\":\"code-safety-net\",\"attempt\":1,\"agents\":20,\"report\":\"<smoke>/repo/.pairingbuddy/run/task/report.json\"}"
  }
 },
 {
  "t": 242.303,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aab0b2c1e1527dc95",
  "input": {
   "pb_key": "pr-draft.draft-pull-request.-.r1.a1",
   "title": "fix: apply_discount returns price after discount",
   "body": "## Summary\n\n`apply_discount(price, percent)` returned the discount amount instead of the price after the discount, so `apply_discount(100, 10)` gave 10 rather than 90. It now returns the price after taking off `percent`, and the README describes that behaviour.\n\n## Impact\n\nCallers of `apply_discount` now receive the discounted price. Any caller that read the return value as the discount amount will see a different number for every non-zero percent.\n\n## Changes\n\n- `apply_discount` returns `price * (100 - percent) / 100`, the price after the discount, instead of `price * percent / 100`.\n- The README states that `apply_discount` returns the price after the discount, with `apply_discount(100, 10)` equal to 90.\n- A regression test asserts that `apply_discount(100, 10)` returns 90.\n\n## Verification\n\nGates recorded for the task: scenarios (auto) and task end (human-cli). No separate report summary was recorded.",
   "labels": [],
   "base": "develop",
   "coordination": null
  }
 },
 {
  "t": 245.474,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ae3b0eb7ffd376899",
  "input": {
   "pb_key": "pr-draft.runner.-.r1.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"paths\":[\".gitignore\",\"pytest.ini\"],\"taskType\":\"publish\",\"rolledBack\":0}"
  }
 },
 {
  "t": 249.976,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ad767a1d0a24214c1",
  "input": {
   "pb_key": "pr-draft.runner.-.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"failures\":[],\"bodyHash\":\"078a49a3ec7d8c3e509f979f57298ad0ef25859dbbb532f81a4f2aebaf041f22\"}"
  }
 },
 {
  "t": 256.079,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a62af184cefbe08f7",
  "input": {
   "pb_key": "pr-draft.lens.permanence.r1.a1",
   "ambiguity": null,
   "findings": [
    {
     "rule": "Read the body as it will read in git log a year from now; flag text true only while the PR is open",
     "severity": "medium",
     "kind": "fix-here",
     "claim": "The Verification section reports workflow gate state ('Gates recorded for the task: scenarios (auto) and task end (human-cli). No separate report summary was recorded.'). This describes the review process for this PR, not the code, and will be meaningless or misleading in git log on main.",
     "where": ".pairingbuddy/run/task/artifacts/pr-draft.draft-pull-request.-.r1.a1.json (body, Verification section); also .pairingbuddy/run/pr-body.md lines 15-17"
    },
    {
     "rule": "Read the body as it will read in git log a year from now; flag text true only while the PR is open",
     "severity": "low",
     "kind": "fix-here",
     "claim": "The phrase 'It now returns the price after taking off percent' and 'Callers ... now receive' use 'now' relative to the time of the change, which reads ambiguously once the commit is years old. Stating the behaviour directly (returns the price after the discount) would be permanent.",
     "where": ".pairingbuddy/run/task/artifacts/pr-draft.draft-pull-request.-.r1.a1.json (body, Summary and Impact sections)"
    }
   ]
  }
 },
 {
  "t": 257.688,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a8f1e41af545b686d",
  "input": {
   "pb_key": "pr-draft.lens.claims.r1.a1",
   "ambiguity": null,
   "findings": [
    {
     "rule": "",
     "severity": "low",
     "kind": "fix-here",
     "claim": "The Impact section says callers will see a different number 'for every non-zero percent', but the diff's change (price * percent / 100 to price * (100 - percent) / 100) gives the same value when percent is 50, e.g. both return 50 for price 100. The statement is not supported by the diff.",
     "where": ".pairingbuddy/run/pr-body.md (Impact section, line 7)"
    }
   ]
  }
 },
 {
  "t": 267.054,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "aa8695da54dc32160",
  "input": {
   "pb_key": "pr-draft.fix.g1.r2.a1",
   "title": "fix: apply_discount returns price after discount",
   "body": "## Summary\n\n`apply_discount(price, percent)` returned the discount amount instead of the price after the discount, so `apply_discount(100, 10)` gave 10 rather than 90. It returns the price after taking off `percent`, and the README describes that behaviour.\n\n## Impact\n\nCallers of `apply_discount` receive the price after the discount. Any caller that read the return value as the discount amount will get a different number for every non-zero percent.\n\n## Changes\n\n- `apply_discount` returns `price * (100 - percent) / 100`, the price after the discount, instead of `price * percent / 100`.\n- The README states that `apply_discount` returns the price after the discount, with `apply_discount(100, 10)` equal to 90.\n- A regression test asserts that `apply_discount(100, 10)` returns 90.\n\n## Verification\n\nA regression test asserts that `apply_discount(100, 10)` returns 90, the case that returned 10 before this change.",
   "labels": [],
   "base": "develop",
   "coordination": null
  }
 },
 {
  "t": 269.831,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a135064194f41eb34",
  "input": {
   "pb_key": "pr-draft.runner.g1.r2.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"failures\":[],\"bodyHash\":\"50e4cfd7fa04d954988730a50cc642b3acef8044db54cc5cd5951392c339fa81\"}"
  }
 },
 {
  "t": 273.673,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a745c28f54fadfc1d",
  "input": {
   "pb_key": "pr-draft.course-checker.g1.r2.a1",
   "finding_id": "permanence-1",
   "verdict": "better",
   "mistake": "none",
   "what_went_wrong": ""
  }
 },
 {
  "t": 282.229,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a6265067529e3355e",
  "input": {
   "pb_key": "pr-draft.fix.g2.r3.a1",
   "title": "fix: apply_discount returns price after discount",
   "body": "## Summary\n\n`apply_discount(price, percent)` returned the discount amount instead of the price after the discount, so `apply_discount(100, 10)` gave 10 rather than 90. It returns the price after taking off `percent`, and the README describes that behaviour.\n\n## Impact\n\nCallers of `apply_discount` receive the price after the discount. Any caller that read the return value as the discount amount will get a different number for most inputs; the two agree only when `percent` is 50 or `price` is 0.\n\n## Changes\n\n- `apply_discount` returns `price * (100 - percent) / 100`, the price after the discount, instead of `price * percent / 100`.\n- The README states that `apply_discount` returns the price after the discount, with `apply_discount(100, 10)` equal to 90.\n- A regression test asserts that `apply_discount(100, 10)` returns 90.\n\n## Verification\n\nA regression test asserts that `apply_discount(100, 10)` returns 90, the case that returned 10 before this change.",
   "labels": [],
   "base": "develop",
   "coordination": null
  }
 },
 {
  "t": 284.869,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a89c653b6a18c5e06",
  "input": {
   "pb_key": "pr-draft.runner.g2.r3.a1",
   "cli_exit_code": 0,
   "cli_output": "{\"ok\":true,\"failures\":[],\"bodyHash\":\"c48397465af5d7d886d2e65bfced9f9d6cc758ced3c2240b0781112844a18ccf\"}"
  }
 },
 {
  "t": 289.621,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "a955aeef5a9317ed2",
  "input": {
   "pb_key": "pr-draft.course-checker.g2.r3.a1",
   "finding_id": "claims-1",
   "verdict": "better",
   "mistake": "none",
   "what_went_wrong": ""
  }
 },
 {
  "t": 295.161,
  "kind": "tool_call",
  "tool": "StructuredOutput",
  "agentId": "ac689675be2e9a679",
  "input": {
   "pb_key": "pr-draft.runner.-.r3.a1",
   "cli_exit_code": 0,
   "cli_output": "$ node <plugin>/cli/pb.mjs pr lint\n{\"ok\":true,\"failures\":[],\"bodyHash\":\"c48397465af5d7d886d2e65bfced9f9d6cc758ced3c2240b0781112844a18ccf\"}\n$ node <plugin>/cli/pb.mjs stage finish\n{\"ok\":true,\"stage\":\"pr-draft\",\"attempt\":1,\"agents\":12,\"report\":\"<smoke>/repo/.pairingbuddy/run/task/report.json\"}"
  }
 }
]
