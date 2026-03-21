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
RENDER_INTERVAL=0.08

# Build claude invocation
CLAUDE_ARGS=(-p --dangerously-skip-permissions --output-format text)

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
export PAIRINGBUDDY_PLAN_PATH="$PLAN_FILE"
export FORCE_COLOR=1

BRANCH=$(git branch --show-current)

if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    echo "Error: refusing to run Solo Buddy on $BRANCH — switch to a feature branch" >&2
    exit 1
fi

LAST_RENDER_LINES=0
SPINNER_INDEX=0

render_status() {
    # Braille spinner character set: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
    local spinner_chars=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
    local spinner_count=${#spinner_chars[@]}

    local status_file="$STATUS_FILE"
    local content
    if [[ -f "$status_file" ]]; then
        content=$(cat "$status_file")
    else
        content="Initializing autonomous execution..."
    fi

    # Advance spinner using a file to persist state across subshell calls
    local spinner_index_file
    spinner_index_file="$(dirname "$status_file")/.solo-spinner-index"
    mkdir -p "$(dirname "$spinner_index_file")" 2>/dev/null || true
    local idx=0
    if [[ -f "$spinner_index_file" ]]; then
        idx=$(cat "$spinner_index_file" 2>/dev/null || echo 0)
    fi
    local spinner_char="${spinner_chars[$idx]}"
    local next_idx=$(( (idx + 1) % spinner_count ))
    printf '%d' "$next_idx" > "$spinner_index_file"

    # Count lines in new content (spinner line + content lines)
    local new_lines
    new_lines=$(printf '%s\n' "$content" | wc -l | tr -d ' ')
    new_lines=$(( new_lines + 1 ))

    # Move cursor up and erase previous output using ANSI escape codes (TTY only)
    if [[ "$LAST_RENDER_LINES" -gt 0 ]] && [[ -t 1 ]]; then
        local n=0
        while [[ $n -lt $LAST_RENDER_LINES ]]; do
            printf "\033[1A\033[2K"
            n=$(( n + 1 ))
        done
    fi

    # Print spinner and status content
    printf '%s\n' "$spinner_char"
    printf '%s\n' "$content"

    LAST_RENDER_LINES=$new_lines
}

start_renderer() {
    # Redirect to /dev/tty so the renderer writes directly to the terminal
    # even when stdout is captured (e.g. during tests).
    # Test with actual write — [-w] can pass even when device is not configured.
    local tty_out="/dev/null"
    if (printf '' > /dev/tty) 2>/dev/null; then
        tty_out="/dev/tty"
    fi
    while true; do
        render_status
        sleep "$RENDER_INTERVAL"
    done >"$tty_out" 2>/dev/null &
    RENDERER_PID=$!
}

cleanup() {
    render_status
    kill "$RENDERER_PID" 2>/dev/null || true
    while kill -0 "$RENDERER_PID" 2>/dev/null; do sleep 0.1; done
}

clear_terminal() {
    if (printf '' > /dev/tty) 2>/dev/null; then
        printf '\033[2J\033[H' > /dev/tty 2>/dev/null || true
    fi
    return 0
}

print_header() {
    local header
    header="$(printf 'Pairing Buddy \xe2\x80\x94 Solo Mode\nPlan: %s\nBranch: %s\n' "$PLAN_FILE" "$BRANCH")"
    if (printf '%s\n' "$header" > /dev/tty) 2>/dev/null; then
        return 0
    fi
    printf '%s\n' "$header"
}

write_final_status() {
    clear_terminal
    local completed=0
    local total=0
    local task_lines=()
    local first_incomplete=true

    if [[ -f "$PLAN_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ "$line" =~ ^\-\ \[x\]\ (.*)$ ]]; then
                local task_text="${BASH_REMATCH[1]}"
                # Strip markdown: **, *, `
                task_text="${task_text//\*\*/}"
                task_text="${task_text//\*/}"
                task_text="${task_text//\`/}"
                task_lines+=("✓ ${task_text}")
                completed=$(( completed + 1 ))
                total=$(( total + 1 ))
            elif [[ "$line" =~ ^\-\ \[\ \]\ (.*)$ ]]; then
                local task_text="${BASH_REMATCH[1]}"
                task_text="${task_text//\*\*/}"
                task_text="${task_text//\*/}"
                task_text="${task_text//\`/}"
                if [[ "$first_incomplete" == "true" ]]; then
                    task_lines+=("→ ${task_text}")
                    first_incomplete=false
                else
                    task_lines+=("○ ${task_text}")
                fi
                total=$(( total + 1 ))
            fi
        done < "$PLAN_FILE"
    fi

    # Build progress bar
    local bar_width=30
    local filled=0
    local percent=0
    if [[ "$total" -gt 0 ]]; then
        filled=$(( completed * bar_width / total ))
        percent=$(( completed * 100 / total ))
    fi
    local empty=$(( bar_width - filled ))

    local bar=""
    local i=0
    while [[ $i -lt $filled ]]; do
        bar="${bar}█"
        i=$(( i + 1 ))
    done
    i=0
    while [[ $i -lt $empty ]]; do
        bar="${bar}░"
        i=$(( i + 1 ))
    done

    # Footer message
    local footer
    if [[ "$CLAUDE_EXIT" -eq 0 ]]; then
        footer="Session complete"
    else
        footer="Session interrupted"
    fi

    # Write to STATUS_FILE
    {
        if [[ ${#task_lines[@]} -gt 0 ]]; then
            for tl in "${task_lines[@]}"; do
                printf '%s\n' "$tl"
            done
            printf '\n'
        fi
        printf '[%d/%d] %s %d%%\n' "$completed" "$total" "$bar" "$percent"
        printf '%s\n' "$footer"
    } > "$STATUS_FILE"
}

PROMPT="Use /pairingbuddy:code to execute the plan at: ${PLAN_FILE}"

mkdir -p .pairingbuddy
clear_terminal
print_header
start_renderer
trap cleanup EXIT SIGTERM SIGINT

claude "${CLAUDE_ARGS[@]}" -- "$PROMPT"
CLAUDE_EXIT=$?

write_final_status

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
