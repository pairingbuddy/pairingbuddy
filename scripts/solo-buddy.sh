#!/usr/bin/env bash
# solo-buddy.sh - Solo Buddy entry point for autonomous TDD execution
#
# Usage: solo-buddy.sh [OPTIONS] <plan_file>
#
# Options:
#   -n <retries>          Max retries (default: 5)
#   --max-turns <n>       Pass --max-turns to claude
#   --max-budget-usd <n>  Pass --max-budget-usd to claude
#   --plugin-dir <path>   Use a specific plugin directory instead of installed plugin
#   --use-api-key         Use ANTHROPIC_API_KEY for billing (default: unset to use subscription)
#   -h, --help            Show this help and exit
#
# On success, creates a GitHub PR via `gh pr create`. The PR title is derived
# from the current branch name (e.g. feature/my-thing -> My thing). When
# .pairingbuddy/SOLO_BUDDY_REPORT.md exists it is used as the PR body.

set -euo pipefail

MAX_RETRIES=5
USE_API_KEY=false
STATUS_FILE=".pairingbuddy/solo-status"
RENDER_INTERVAL=5

# Build claude invocation
CLAUDE_ARGS=(-p --dangerously-skip-permissions --output-format json)

require_arg() {
    local flag="$1"
    local value="${2:-}"
    if [[ -z "$value" ]]; then
        echo "Error: $flag requires a value" >&2
        exit 1
    fi
}

require_positive_integer() {
    local flag="$1"
    local value="$2"
    if ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: $flag requires a positive integer, got: $value" >&2
        exit 1
    fi
}

require_positive_number() {
    local flag="$1"
    local value="$2"
    if ! [[ "$value" =~ ^(0*[1-9][0-9]*([.][0-9]+)?|0+[.][0-9]*[1-9][0-9]*)$ ]]; then
        echo "Error: $flag requires a positive number, got: $value" >&2
        exit 1
    fi
}

sanitize_branch_name() {
    local branch="$1"
    # Strip common prefixes (feature/, fix/, bugfix/, hotfix/, chore/, etc.)
    local name="${branch#*/}"
    if [[ "$name" == "$branch" ]]; then
        # No prefix found, use as-is
        name="$branch"
    fi
    # Replace hyphens and underscores with spaces
    name="${name//-/ }"
    name="${name//_/ }"
    # Capitalize first letter (portable, works with bash 3)
    name="$(printf '%s' "$name" | awk '{$1=toupper(substr($1,1,1)) substr($1,2); print}')"
    echo "$name"
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <plan_file>

Run Solo Buddy: autonomous execution of a tracer bullets plan.

On success, creates a GitHub PR via \`gh pr create\`. The PR title is derived
from the current branch name (e.g. feature/my-thing -> My thing). When
.pairingbuddy/SOLO_BUDDY_REPORT.md exists it is used as the PR body.

Options:
  -n <retries>          Max retries (default: 5)
  --max-turns <n>       Pass --max-turns to claude
  --max-budget-usd <n>  Pass --max-budget-usd to claude
  --plugin-dir <path>   Use a specific plugin directory instead of installed plugin
  --use-api-key         Use ANTHROPIC_API_KEY for billing (default: unset to use subscription)
  -h, --help            Show this help and exit

Arguments:
  plan_file   Path to the plan file to execute
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -n)
            require_arg "-n" "${2:-}"
            require_positive_integer "-n" "$2"
            MAX_RETRIES="$2"
            shift 2
            ;;
        --max-turns)
            require_arg "--max-turns" "${2:-}"
            require_positive_integer "--max-turns" "$2"
            CLAUDE_ARGS+=(--max-turns "$2")
            shift 2
            ;;
        --max-budget-usd)
            require_arg "--max-budget-usd" "${2:-}"
            require_positive_number "--max-budget-usd" "$2"
            CLAUDE_ARGS+=(--max-budget-usd "$2")
            shift 2
            ;;
        --plugin-dir)
            require_arg "--plugin-dir" "${2:-}"
            CLAUDE_ARGS+=(--plugin-dir "$2")
            shift 2
            ;;
        --use-api-key)
            USE_API_KEY=true
            shift
            ;;
        --)
            shift
            break
            ;;
        -*)
            echo "Error: Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            break
            ;;
    esac
done

if [[ $# -lt 1 ]]; then
    echo "Error: plan_file argument is required" >&2
    usage >&2
    exit 1
fi

PLAN_FILE="$1"

if [[ ! -f "$PLAN_FILE" ]]; then
    echo "Error: Plan file not found: $PLAN_FILE" >&2
    exit 1
fi

# By default, unset ANTHROPIC_API_KEY to use subscription billing (Max/Pro).
# Use --use-api-key to explicitly opt in to API billing.
if [[ "$USE_API_KEY" != "true" ]]; then
    unset ANTHROPIC_API_KEY 2>/dev/null || true
fi

export PAIRINGBUDDY_SOLO=true
export PAIRINGBUDDY_SOLO_MAX_RETRIES="$MAX_RETRIES"

render_status() {
    local status_file="$STATUS_FILE"
    echo "----------------------------------------"
    if [[ -f "$status_file" ]]; then
        cat "$status_file"
    else
        echo "Waiting for first agent..."
    fi
}

start_renderer() {
    # Redirect to /dev/tty so the renderer writes directly to the terminal
    # even when stdout is captured (e.g. during tests).
    local tty_out="/dev/tty"
    [[ -w "$tty_out" ]] || tty_out="/dev/null"
    while true; do
        render_status
        sleep "$RENDER_INTERVAL"
    done >"$tty_out" 2>"$tty_out" &
    RENDERER_PID=$!
}

cleanup() {
    kill "$RENDERER_PID" 2>/dev/null || true
    while kill -0 "$RENDERER_PID" 2>/dev/null; do sleep 0.1; done
}

PROMPT="Use /pairingbuddy:code to execute the plan at: ${PLAN_FILE}"

start_renderer
trap cleanup EXIT SIGTERM SIGINT

claude "${CLAUDE_ARGS[@]}" -- "$PROMPT"
CLAUDE_EXIT=$?

if [[ $CLAUDE_EXIT -eq 0 ]]; then
    BRANCH=$(git branch --show-current)

    # Never push to main/master
    if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
        echo "Warning: refusing to push/create PR on $BRANCH" >&2
    else
        # Push branch to remote first (gh pr create needs it)
        git push -u origin "$BRANCH" 2>/dev/null || \
            echo "Warning: git push failed" >&2

        PR_TITLE=$(sanitize_branch_name "$BRANCH")
        REPORT_FILE=".pairingbuddy/SOLO_BUDDY_REPORT.md"
        if [[ -f "$REPORT_FILE" ]]; then
            gh pr create --title "$PR_TITLE" --body-file "$REPORT_FILE" || \
                echo "Warning: gh pr create failed" >&2
        else
            gh pr create --title "$PR_TITLE" || \
                echo "Warning: gh pr create failed" >&2
        fi
    fi
fi

exit $CLAUDE_EXIT
