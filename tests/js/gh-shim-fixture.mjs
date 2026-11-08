// The recording `gh` of gh-shim.mjs for the tests of pb publish. The shim dir is made under the per-file TMPDIR, which
// isolated-tmpdir.mjs removes on exit.
import "./isolated-tmpdir.mjs";

export { FAKE_PR_URL, GH_FAILURE, flagValues, installGhShim, viewEnv } from "./gh-shim.mjs";
