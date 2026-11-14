#!/bin/bash

SCREEN_ID="37D8832A-2D66-02CA-B9F7-8F30A301B230"
INITIAL_CONNECTED_MODE="res:1512x982 hz:120 color_depth:8 scaling:on"
INITIAL_DISCONNECTED_MODE="res:1800x1169 hz:120 color_depth:8 scaling:on"
LOG_PREDICATE='subsystem == "com.apple.universalcontrol" AND category == "EVNT"'
DISPLAYPLACER="/opt/homebrew/bin/displayplacer"
STATE_DIR="$HOME/Library/Application Support/uc-resolution"
STATE_FILE="$STATE_DIR/state"
TRANSITION_LOG="$STATE_DIR/transition.log"

mkdir -p "$STATE_DIR"

classify() {
	case "$1" in
	*"IDS "*": Disconnected"*) echo "disconnected" ;;
	*"IDS "*": Connected"*) echo "connected" ;;
	esac
}

recorded_state() {
	cat "$STATE_FILE" 2>/dev/null || echo "unknown"
}

mode_file() {
	echo "$STATE_DIR/$1.mode"
}

init_mode() {
	[[ -f "$(mode_file "$1")" ]] || echo "$2" > "$(mode_file "$1")"
}

current_mode() {
	"$DISPLAYPLACER" list 2>/dev/null | awk -v id="$SCREEN_ID" '
		/^Persistent screen id:/ { screen = $4 }
		screen == id && / <-- current mode/ { sub(/^ *mode [0-9]+: /, ""); sub(/ <-- current mode.*/, ""); print; exit }
	'
}

remember_mode() {
	[[ "$1" == "connected" || "$1" == "disconnected" ]] || return 0
	mode=$(current_mode)
	[[ -n "$mode" ]] || return 0
	echo "$mode" > "$(mode_file "$1")"
}

apply_state() {
	current_state="$1"
	previous_state="$2"
	[[ "$current_state" == "$previous_state" ]] && return 0
	remember_mode "$previous_state"
	"$DISPLAYPLACER" "id:$SCREEN_ID $(cat "$(mode_file "$current_state")")" 2>/dev/null
	echo "$current_state" > "$STATE_FILE"
	echo "$(date '+%Y-%m-%d %H:%M:%S') -> $current_state" >> "$TRANSITION_LOG"
}

seed_state() {
	last_marker=$(
		/usr/bin/log show --last 30m --predicate "$LOG_PREDICATE" --style compact 2>/dev/null |
			grep -E "IDS [0-9A-F]{8}: (Connected|Disconnected)" |
			tail -1
	)
	if [[ -n "$last_marker" ]]; then
		apply_state "$(classify "$last_marker")" "unknown"
	else
		apply_state "disconnected" "unknown"
	fi
}

watch_stream() {
	old_state=$(recorded_state)
	/usr/bin/log stream --style compact --predicate "$LOG_PREDICATE" 2>/dev/null |
		while read -r line; do
			new_state=$(classify "$line")
			if [[ -n "$new_state" ]]; then
				apply_state "$new_state" "$old_state"
				old_state=$new_state
			fi
		done
}

init_mode connected "$INITIAL_CONNECTED_MODE"
init_mode disconnected "$INITIAL_DISCONNECTED_MODE"
remember_mode "$(recorded_state)"
seed_state
watch_stream
