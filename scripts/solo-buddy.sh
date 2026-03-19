#!/usr/bin/env bash
# solo-buddy.sh - Solo Buddy entry point for autonomous TDD execution
#
# Usage: solo-buddy.sh [OPTIONS] <plan_file>
#
# Options:
#   -n <retries>          Max retries (default: 5)
#   --max-turns <n>       Pass --max-turns to claude
#   --max-budget-usd <n>  Pass --max-budget-usd to claude
#   -h, --help            Show this help and exit

set -euo pipefail

MAX_RETRIES=5

# Build claude invocation
CLAUDE_ARGS=(-p --dangerously-skip-permissions --output-format json)

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <plan_file>

Run Solo Buddy: autonomous Claude Code execution of a TDD plan.

Options:
  -n <retries>          Max retries (default: 5)
  --max-turns <n>       Pass --max-turns to claude
  --max-budget-usd <n>  Pass --max-budget-usd to claude
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
            if [[ -z "${2:-}" ]]; then
                echo "Error: -n requires a value" >&2
                exit 1
            fi
            MAX_RETRIES="$2"
            shift 2
            ;;
        --max-turns)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --max-turns requires a value" >&2
                exit 1
            fi
            CLAUDE_ARGS+=(--max-turns "$2")
            shift 2
            ;;
        --max-budget-usd)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --max-budget-usd requires a value" >&2
                exit 1
            fi
            CLAUDE_ARGS+=(--max-budget-usd "$2")
            shift 2
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

export PAIRINGBUDDY_SOLO=true
export PAIRINGBUDDY_SOLO_MAX_RETRIES="$MAX_RETRIES"

PROMPT="Execute the plan at: ${PLAN_FILE}"

exec claude "${CLAUDE_ARGS[@]}" "$PROMPT"
