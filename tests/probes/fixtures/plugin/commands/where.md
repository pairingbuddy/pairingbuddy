---
description: Probe of CLAUDE_PLUGIN_ROOT in a command body
---
Inline shell output: !`cat "${CLAUDE_PLUGIN_ROOT}/marker.txt"`

Do these two things and nothing else:
1. Run the Bash command `cat ${CLAUDE_PLUGIN_ROOT}/marker.txt`.
2. Call the Workflow tool with name `pbprobe:open` and args `{"pluginRoot": "${CLAUDE_PLUGIN_ROOT}", "attempt": 1}`.
