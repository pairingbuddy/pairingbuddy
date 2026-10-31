# P12: marketplace install loads `modules`

Decides whether the mod ships in this plugin. About 8 minutes.

The lab holds a local marketplace and its own `CLAUDE_CONFIG_DIR`, so your real plugins and settings are not touched. That config is empty, so you log in once. This lab also serves P19 part 2.

## Setup

```sh
python3 tests/probes/human/lab.py setup P12
```

Paste the line it prints. It adds the marketplace, installs two fixture plugins, then starts a session.

## Steps

1. Finish first-run prompts, and run `/login` if asked. Trust the folder if asked.
2. Type `/exit`, then paste the same `sh` line again. It reports the plugins as already present, which is fine, and this session keeps your login.
3. Paste this prompt:

   ```
   Call the Workflow tool with name `pbprobe:stage1`. Wait for it to finish, then stop.
   ```

4. Type `/exit`.

```sh
python3 tests/probes/human/lab.py show P12
```

## Observe

The `mod.jsonl` section, and the `hookonly-mod.log` section.

## PASS

`mod.jsonl` has lines, including a `spawn` for `stage:one`. Plugin-installed modules ran alongside shell hooks, which appear in the hook payload list.

FAIL: no `mod.jsonl`, with shell hook payloads present. INCONCLUSIVE: no hook payloads either, since then the plugin did not load at all.

## Report back

The first 3 lines of the `mod.jsonl` section.
