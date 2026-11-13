// Scenario: sound-preference (configuration side). The plugin declares the alertSound user config, and the bundled
// alert audio file exists at the path the mod plays and is a valid WAV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pluginJsonPath = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const alertSourceUrl = new URL("../../mod/alert.ts", import.meta.url);
const repoRootUrl = new URL("../../", import.meta.url);

test("preference-declared-as-user-config", () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, "utf8"));

  const alertSound = plugin.userConfig?.alertSound;

  assert.ok(alertSound, "plugin.json userConfig.alertSound is declared");
  assert.equal(alertSound.type, "boolean", "alertSound type");
  assert.equal(alertSound.default, true, "alertSound default");
  assert.equal(typeof alertSound.title, "string", "alertSound title is a string");
  assert.ok(alertSound.title.trim().length > 0, "alertSound title is non-empty");
});

test("alert-asset-file-exists", () => {
  const source = readFileSync(alertSourceUrl, "utf8");
  const assetPath = /SOUND\s*=\s*\{\s*asset:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  assert.ok(assetPath, "mod/alert.ts declares the SOUND asset path");

  const audio = readFileSync(new URL(assetPath, repoRootUrl));

  assert.ok(audio.length > 12, `${assetPath} is long enough to hold a WAV header`);
  assert.equal(audio.toString("ascii", 0, 4), "RIFF", "WAV container marker");
  assert.equal(audio.toString("ascii", 8, 12), "WAVE", "WAV format marker");
});
