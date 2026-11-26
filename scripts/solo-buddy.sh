#!/usr/bin/env bash
# solo-buddy.sh - Solo Buddy entry point for autonomous TDD execution
#
# Usage: solo-buddy.sh [OPTIONS] <plan_file>
#
# Options:
#   -n <retries>          Max retries (default: 5)
#   --max-turns <n>       Pass --max-turns to the AI session
#   --max-budget-usd <n>  Pass --max-budget-usd to the AI session
#   --plugin-dir <path>   Use a specific plugin directory instead of installed plugin
#   --use-api-key         Use ANTHROPIC_API_KEY for billing (default: unset to use subscription)
#   -h, --help            Show this help and exit
#
# Pushing and opening PRs belong to the publish stages, not to this script.

set -euo pipefail

MAX_RETRIES=5
USE_API_KEY=false
STATUS_FILE=".pairingbuddy/solo-status"
STREAM_FILE=".pairingbuddy/solo-stream.jsonl"
RENDER_INTERVAL=0.08

# Build invocation arguments
CLAUDE_ARGS=(-p --dangerously-skip-permissions --output-format stream-json --verbose)

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

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <plan_file>

Run Solo Buddy: autonomous execution of a tracer bullets plan.

Pushing and opening PRs belong to the publish stages, not to this script.

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
export PAIRINGBUDDY_GATE_POLICY=auto
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
FINAL_RENDERED=""
STOP_REASON=""
LEDGER_FILE=".pairingbuddy/run/task/ledger.json"
LEDGER_TEXT_CLIP=200
NOTES_DIR=".pairingbuddy/run/task/notes"
ROLLBACK_HEADING="## Rollback"
ATTEMPT_CAP_CODE="attempt-cap"
EXIT_UNFINISHED=1
NEEDS_HUMAN_GATE=""
UNFINISHED_STAGE=""

# True when the session exited 0 yet the task ledger holds a stop, waits on a human gate
# or has a stage still active: the run is unfinished
session_unfinished() {
    [[ "$CLAUDE_EXIT" -eq 0 && -n "${STOP_REASON}${NEEDS_HUMAN_GATE}${UNFINISHED_STAGE}" ]]
}

# Print what a JS snippet says about a state file: `text` is its contents, `state` its parsed JSON
# (undefined when the file is not one JSON document, as a JSONL stream is not).
# Prints nothing when the file is missing or unreadable: node exits non-zero on a throwing snippet or a
# missing binary, and `|| true` keeps set -e quiet.
read_state_line() {
    local file="$1" body="$2"
    [[ -f "$file" ]] || return 0
    node -e "const text = require('fs').readFileSync(process.argv[1], 'utf8'); let state; try { state = JSON.parse(text); } catch (error) {} const clip = (value, max = 60) => { const plain = String(value).replace(/[\\u0000-\\u001f\\u007f-\\u009f]+/g, ' ').trim(); return plain.length > max ? plain.slice(0, max - 1) + '…' : plain; }; ${body}" "$file" 2>/dev/null || true
}  # end read_state_line

# Print one clipped text field of the task ledger: read_ledger_text <object> <field> <max>
read_ledger_text() {
    local object="$1" field="$2" max="$3"
    read_state_line "$LEDGER_FILE" "if (state.${object} && state.${object}.${field}) console.log(clip(state.${object}.${field}, ${max}));"
}  # end read_ledger_text

render_status() {
    local spinner_chars=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
    local spinner_count=${#spinner_chars[@]}

    # Advance spinner
    local spinner_index_file=".pairingbuddy/.solo-spinner-index"
    mkdir -p .pairingbuddy 2>/dev/null || true
    local idx=0
    if [[ -f "$spinner_index_file" ]]; then
        idx=$(cat "$spinner_index_file" 2>/dev/null || echo 0)
    fi
    local spinner_char="${spinner_chars[$idx]}"
    local next_idx=$(( (idx + 1) % spinner_count ))
    printf '%d' "$next_idx" > "$spinner_index_file"

    # ANSI colors
    local green="" cyan="" dim="" bold="" bold_white="" reset=""
    if [[ "${FORCE_COLOR:-}" == "1" ]]; then
        green=$'\033[32m'
        cyan=$'\033[36m'
        dim=$'\033[2m'
        bold=$'\033[1m'
        bold_white=$'\033[1;37m'
        reset=$'\033[0m'
    fi

    local NL=$'\n'
    local content=""

    # Read plan file for task list and progress
    if [[ -f "$PLAN_FILE" ]]; then
        local completed=0 total=0
        local task_lines=()
        local first_incomplete=true

        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ "$line" =~ ^\-\ \[x\]\ (.*)$ ]]; then
                local task_text="${BASH_REMATCH[1]}"
                task_text="${task_text//\*\*/}"
                task_text="${task_text//\*/}"
                task_text="${task_text//\`/}"
                task_lines+=("  ${green}✓${reset} ${task_text}")
                completed=$(( completed + 1 ))
                total=$(( total + 1 ))
            elif [[ "$line" =~ ^\-\ \[\ \]\ (.*)$ ]]; then
                local task_text="${BASH_REMATCH[1]}"
                task_text="${task_text//\*\*/}"
                task_text="${task_text//\*/}"
                task_text="${task_text//\`/}"
                if [[ "$first_incomplete" == "true" ]]; then
                    task_lines+=("  ${cyan}→${reset} ${bold_white}${task_text}${reset}")
                    first_incomplete=false
                else
                    task_lines+=("  ${dim}○ ${task_text}${reset}")
                fi
                total=$(( total + 1 ))
            fi
        done < "$PLAN_FILE"

        # Build task list
        if [[ ${#task_lines[@]} -gt 0 ]]; then
            for tl in "${task_lines[@]}"; do
                content="${content}${tl}${NL}"
            done
            content="${content}${NL}"
        fi

        # Progress bar
        local bar_width=30 filled=0 percent=0
        if [[ "$total" -gt 0 ]]; then
            filled=$(( completed * bar_width / total ))
            percent=$(( completed * 100 / total ))
        fi
        local empty=$(( bar_width - filled ))
        local filled_str="" empty_str=""
        local i=0
        while [[ $i -lt $filled ]]; do filled_str="${filled_str}█"; i=$(( i + 1 )); done
        i=0
        while [[ $i -lt $empty ]]; do empty_str="${empty_str}░"; i=$(( i + 1 )); done
        local pct_str="${percent}%"
        if [[ "$percent" -gt 0 ]]; then pct_str="${bold}${percent}%${reset}"; fi
        content="${content}[${completed}/${total}] ${cyan}${filled_str}${reset}${dim}${empty_str}${reset} ${pct_str}${NL}"
    fi

    # Read the unit's branch and task count from run/unit.json
    local unit_line
    unit_line=$(read_state_line ".pairingbuddy/run/unit.json" '
        const n = Array.isArray(state.tasks) ? state.tasks.length : 0;
        const count = `(${n} ${n === 1 ? "task" : "tasks"})`;
        console.log(state.branch ? `${clip(state.branch)} ${count}` : count);
    ')
    if [[ -n "$unit_line" ]]; then
        content="${content}Unit: ${dim}${unit_line}${reset}${NL}"
    fi

    # Read the stop reason or the current stage, and the human gate it waits on, from the task ledger
    local ledger_line
    ledger_line=$(read_state_line "$LEDGER_FILE" '
        const s = state.stage;
        const attempt = s && s.attempt !== undefined ? `(attempt ${s.attempt})` : "";
        if (state.stop && state.stop.reason) console.log(`Stopped: ${clip(state.stop.reason)}`);
        else if (s && s.name) console.log(`Stage: ${[clip(s.name, 30), clip(s.status ?? "", 30), attempt].filter(Boolean).join(" ")}`);
        if (state.needsHuman && state.needsHuman.gate) console.log(`Waiting on: ${clip(state.needsHuman.gate)}`);
    ')
    if [[ -n "$ledger_line" ]]; then
        content="${content}${ledger_line}${NL}"
    fi

    # Read the captured claude stream once: show the description of the latest task_progress event and sum the
    # tokens the task_notification events report in their usage. A partial or invalid line is skipped.
    local stream_lines
    stream_lines=$(read_state_line "$STREAM_FILE" '
        const events = text.split("\n").map((line) => { try { return JSON.parse(line); } catch (error) { return null; } });
        const system = events.filter((event) => event && event.type === "system");
        const progress = system.filter((event) => event.subtype === "task_progress" && event.description);
        const last = progress.length ? clip(progress[progress.length - 1].description) : "";
        const tokens = system
            .filter((event) => event.subtype === "task_notification" && event.usage && event.usage.total_tokens !== null && event.usage.total_tokens !== undefined)
            .map((event) => Number(event.usage.total_tokens))
            .filter(Number.isFinite);
        const total = tokens.reduce((sum, count) => sum + count, 0);
        if (last) console.log(`Agent: ${last}`);
        if (tokens.length > 0) console.log(`Spend: ${total} tokens`);
    ')

    # Fallback if nothing to display; otherwise add the stream lines, with the spend unknown until a task_notification reports it
    if [[ -z "$content" && -z "$stream_lines" ]]; then
        content="  ${cyan}→${reset} ${bold_white:-}Initializing autonomous execution...${reset:-}${NL}"
    else
        [[ "$stream_lines" == *Spend:* ]] || stream_lines="${stream_lines:+${stream_lines}${NL}}Spend: unknown"
        content="${content}${stream_lines}${NL}"
    fi

    # Replace → with spinner char
    content="${content//→/$spinner_char}"

    # Print with ANSI cursor management
    local new_lines
    new_lines=$(printf '%s' "$content" | wc -l | tr -d ' ')

    if [[ "$LAST_RENDER_LINES" -gt 0 ]] && [[ -t 1 ]]; then
        local n=0
        while [[ $n -lt $LAST_RENDER_LINES ]]; do
            printf "\033[1A\033[2K"
            n=$(( n + 1 ))
        done
    fi

    printf '%s' "$content"
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

CAFFEINATE_PID=""

start_caffeinate() {
    if [[ "$(uname)" == "Darwin" ]]; then
        caffeinate -s &
        CAFFEINATE_PID=$!
    fi
}

stop_caffeinate() {
    if [[ -n "$CAFFEINATE_PID" ]]; then
        kill "$CAFFEINATE_PID" 2>/dev/null || true
    fi
}

cleanup() {
    stop_caffeinate
    if [[ "$FINAL_RENDERED" == "true" ]]; then
        : # Final render already done; skip to avoid overwriting final status
    else
        render_status
    fi
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
    local yellow="" dim="" reset=""
    if [[ "${FORCE_COLOR:-}" == "1" ]]; then
        yellow=$'\033[33m'
        dim=$'\033[2m'
        reset=$'\033[0m'
    fi
    local header
    local header
    header="$(printf '%s⚡%s Pairing Buddy — Solo Mode\n\nPlan: %s%s%s\nBranch: %s%s%s' \
        "$yellow" "$reset" \
        "$dim" "$PLAN_FILE" "$reset" \
        "$dim" "$BRANCH" "$reset")"
    # Trailing blank line for spacing before task list
    header="${header}"$'\n'
    if (printf '%s\n\n' "$header" > /dev/tty) 2>/dev/null; then
        return 0
    fi
    printf '%s\n\n' "$header"
}

# Print the lessons block: the first text line under each rollback heading in the active stage's notes file.
# Prints nothing when the ledger names no stage or the stage has no notes file yet.
read_rollback_lessons() {
    read_state_line "$LEDGER_FILE" "
        const stageName = state.stage && state.stage.name;
        const notesFile = '${NOTES_DIR}/' + stageName + '.md';
        const fs = require('fs');
        const lessons = [];
        if (stageName && fs.existsSync(notesFile)) {
            let afterHeading = false;
            for (const line of fs.readFileSync(notesFile, 'utf8').split('\\n')) {
                if (line.startsWith('${ROLLBACK_HEADING}')) { afterHeading = true; continue; }
                if (afterHeading && line.trim()) { lessons.push('- ' + clip(line, ${LEDGER_TEXT_CLIP})); afterHeading = false; }
            }
        }
        if (lessons.length) console.log('lessons:\\n' + lessons.join('\\n'));
    "
}  # end read_rollback_lessons

print_exit_summary() {
    local output
    if session_unfinished; then
        if [[ -n "$STOP_REASON" ]]; then
            output="✗ Session stopped: ${STOP_REASON}"
        elif [[ -n "$NEEDS_HUMAN_GATE" ]]; then
            output="✗ Session unfinished: waiting on a human at ${NEEDS_HUMAN_GATE}"
        else
            output="✗ Session unfinished: stage ${UNFINISHED_STAGE} is active"
        fi
    elif [[ "$CLAUDE_EXIT" -eq 0 ]]; then
        output="✓ Session complete"
    else
        output="✗ Session interrupted (exit code $CLAUDE_EXIT)"
    fi
    local attempts_line
    # The cap exists only in the stop reason's text ("... its cap of N"), so the line is skipped when that wording changes
    attempts_line=$(read_state_line "$LEDGER_FILE" "
        const cap = state.stop && state.stop.code === '${ATTEMPT_CAP_CODE}' && /its cap of (\\d+)/.exec(String(state.stop.reason));
        const rollbacks = state.fixes && state.fixes.rollbacks;
        if (cap && Array.isArray(rollbacks)) console.log(\`fixes undone: \${rollbacks.length} of \${cap[1]} allowed\`);
    ")
    if [[ -n "$attempts_line" ]]; then
        output="${output}
${attempts_line}"
        local lessons
        lessons=$(read_rollback_lessons)
        if [[ -n "$lessons" ]]; then
            output="${output}
${lessons}"
        fi
    fi
    if [[ -n "${REPORT_FILE:-}" ]] && [[ -f "${REPORT_FILE}" ]]; then
        output="${output}
  Report: ${REPORT_FILE}"
    fi
    if (printf '%s\n' "$output" > /dev/tty) 2>/dev/null; then
        return 0
    fi
    printf '%s\n' "$output"
}

write_final_status() {
    clear_terminal
    local completed=0
    local total=0
    local task_lines=()
    local first_incomplete=true

    # ANSI color codes gated by FORCE_COLOR
    local green="" cyan="" dim="" bold="" bold_white="" reset=""
    if [[ "${FORCE_COLOR:-}" == "1" ]]; then
        green=$'\033[32m'
        cyan=$'\033[36m'
        dim=$'\033[2m'
        bold=$'\033[1m'
        bold_white=$'\033[1;37m'
        reset=$'\033[0m'
    fi

    if [[ -f "$PLAN_FILE" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            if [[ "$line" =~ ^\-\ \[x\]\ (.*)$ ]]; then
                local task_text="${BASH_REMATCH[1]}"
                # Strip markdown: **, *, `
                task_text="${task_text//\*\*/}"
                task_text="${task_text//\*/}"
                task_text="${task_text//\`/}"
                task_lines+=("  ${green}✓${reset} ${task_text}")
                completed=$(( completed + 1 ))
                total=$(( total + 1 ))
            elif [[ "$line" =~ ^\-\ \[\ \]\ (.*)$ ]]; then
                local task_text="${BASH_REMATCH[1]}"
                task_text="${task_text//\*\*/}"
                task_text="${task_text//\*/}"
                task_text="${task_text//\`/}"
                if [[ "$first_incomplete" == "true" ]]; then
                    task_lines+=("  ${cyan}→${reset} ${bold_white}${task_text}${reset}")
                    first_incomplete=false
                else
                    task_lines+=("  ${dim}○ ${task_text}${reset}")
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

    local filled_str="" empty_str=""
    local i=0
    while [[ $i -lt $filled ]]; do
        filled_str="${filled_str}█"
        i=$(( i + 1 ))
    done
    i=0
    while [[ $i -lt $empty ]]; do
        empty_str="${empty_str}░"
        i=$(( i + 1 ))
    done
    local bar="${cyan}${filled_str}${reset}${dim}${empty_str}${reset}"

    local pct_str
    if [[ "$percent" -gt 0 ]]; then
        pct_str="${bold}${percent}%${reset}"
    else
        pct_str="${percent}%"
    fi

    # Footer message
    local footer
    if session_unfinished; then
        if [[ -n "$STOP_REASON" ]]; then
            footer="Session stopped"
        else
            footer="Session unfinished"
        fi
    elif [[ "$CLAUDE_EXIT" -eq 0 ]]; then
        footer="Session complete"
    else
        footer="Session interrupted"
    fi

    # Build header (matching print_header format, with FORCE_COLOR-gated ANSI)
    local yellow=""
    if [[ "${FORCE_COLOR:-}" == "1" ]]; then
        yellow=$'\033[33m'
    fi

    # Write to STATUS_FILE
    {
        printf '%s⚡%s Pairing Buddy — Solo Mode\n' "$yellow" "$reset"
        printf '\n'
        printf 'Plan: %s%s%s\n' "$dim" "$PLAN_FILE" "$reset"
        printf 'Branch: %s%s%s\n' "$dim" "$BRANCH" "$reset"
        printf '\n'
        if [[ ${#task_lines[@]} -gt 0 ]]; then
            for tl in "${task_lines[@]}"; do
                printf '%s\n' "$tl"
            done
            printf '\n'
        fi
        printf '[%d/%d] %s %s\n' "$completed" "$total" "$bar" "$pct_str"
        printf '%s\n' "$footer"
    } > "$STATUS_FILE"
}

PROMPT="Use /pairingbuddy:code to execute the plan at: ${PLAN_FILE}"

mkdir -p .pairingbuddy
clear_terminal
print_header
start_renderer
start_caffeinate
trap cleanup EXIT SIGTERM SIGINT

claude "${CLAUDE_ARGS[@]}" -- "$PROMPT" > "$STREAM_FILE"
CLAUDE_EXIT=$?

# An exit 0 with a stop in the task ledger is an unfinished run
STOP_REASON=$(read_ledger_text stop reason "$LEDGER_TEXT_CLIP")
NEEDS_HUMAN_GATE=$(read_ledger_text needsHuman gate "$LEDGER_TEXT_CLIP")
UNFINISHED_STAGE=$(read_state_line "$LEDGER_FILE" "if (state.stage && state.stage.status === 'active' && state.stage.name) console.log(clip(state.stage.name, ${LEDGER_TEXT_CLIP}));")

# Stop the renderer before writing final status
kill "$RENDERER_PID" 2>/dev/null || true
while kill -0 "$RENDERER_PID" 2>/dev/null; do sleep 0.1; done

write_final_status
render_status
FINAL_RENDERED=true

REPORT_FILE=".pairingbuddy/SOLO_BUDDY_REPORT.md"

print_exit_summary

if session_unfinished; then
    exit "$EXIT_UNFINISHED"
fi

exit $CLAUDE_EXIT
