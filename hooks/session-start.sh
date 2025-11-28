#!/usr/bin/env bash
# SessionStart hook for pairingbuddy plugin

set -euo pipefail

# Determine plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Read using-pairingbuddy content
using_pairingbuddy_content=$(cat "${PLUGIN_ROOT}/skills/using-pairingbuddy/SKILL.md" 2>&1 || echo "Error reading using-pairingbuddy skill")

# Escape outputs for JSON
using_pairingbuddy_escaped=$(echo "$using_pairingbuddy_content" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')

# Output context injection as JSON
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have pairingbuddy.\n\n**The content below is from skills/using-pairingbuddy/SKILL.md - your introduction to using skills:**\n\n${using_pairingbuddy_escaped}\n\n</EXTREMELY_IMPORTANT>"
  }
}
EOF

exit 0
