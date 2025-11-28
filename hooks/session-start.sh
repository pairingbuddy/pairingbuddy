#!/usr/bin/env bash
# SessionStart hook for mimer-code plugin

set -euo pipefail

# Determine plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Read using-mimer-code content
using_mimer_code_content=$(cat "${PLUGIN_ROOT}/skills/using-mimer-code/SKILL.md" 2>&1 || echo "Error reading using-mimer-code skill")

# Escape outputs for JSON
using_mimer_code_escaped=$(echo "$using_mimer_code_content" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')

# Output context injection as JSON
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have mimer-code.\n\n**The content below is from skills/using-mimer-code/SKILL.md - your introduction to using skills:**\n\n${using_mimer_code_escaped}\n\n</EXTREMELY_IMPORTANT>"
  }
}
EOF

exit 0
