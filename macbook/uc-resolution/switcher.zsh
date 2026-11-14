#!/bin/zsh -f

zmodload zsh/datetime zsh/zselect

SCREEN_ID="37D8832A-2D66-02CA-B9F7-8F30A301B230"
STUDIO_MODEL="Mac13,1"
GRACE_SECONDS=15
LOOKBACK="1d"
DISPLAYPLACER="/opt/homebrew/bin/displayplacer"
STATE_DIR="$HOME/Library/Application Support/uc-resolution"
CABLE_WATCH="$STATE_DIR/cable-watch"
LOG_PREDICATE='subsystem == "com.apple.universalcontrol" AND ((category == "EVNT" AND eventMessage BEGINSWITH "Connected Devices IDS") OR (category == "sleep" AND eventMessage BEGINSWITH "=== Display "))'

cable=""
uc=""
display=""
applied=""
deadline=0

state_file() { print -r -- "$STATE_DIR/state" }
mode_file() { print -r -- "$STATE_DIR/$1.mode" }

note() {
	local now=$EPOCHREALTIME
	local stamp
	strftime -s stamp '%Y-%m-%d %H:%M:%S' ${now%.*}
	print -r -- "$stamp.${${now#*.}[1,3]} $*" >> "$STATE_DIR/transition.log"
}

current_mode() {
	"$DISPLAYPLACER" list 2>/dev/null | awk -v id="$SCREEN_ID" '
		/^Persistent screen id:/ { screen = $4 }
		screen == id && / <-- current mode/ { sub(/^ *mode [0-9]+: /, ""); sub(/ <-- current mode.*/, ""); print; exit }
	'
}

remember_mode() {
	local mode=$(current_mode)
	[[ -n $mode ]] || return 0
	print -r -- "$mode" > "$(mode_file $1)"
}

switch_to() {
	local target=$1 reason=$2
	[[ $applied == $target ]] && return 0
	[[ -n $applied ]] && remember_mode $applied
	[[ -s "$(mode_file $target)" ]] || remember_mode $target
	local mode=$(<"$(mode_file $target)")
	if ! "$DISPLAYPLACER" "id:$SCREEN_ID $mode" >/dev/null 2>&1; then
		note "switch to $target failed ($reason): $mode"
		return 0
	fi
	applied=$target
	print -r -- $target > "$(state_file)"
	note "-> $target ($reason): $mode"
}

decide() {
	local trigger=$1
	if (( cable || uc )); then
		deadline=0
		switch_to connected $trigger
		return 0
	fi
	if (( ! display )) || [[ $applied == disconnected ]]; then
		deadline=0
		return 0
	fi
	if [[ $trigger == unplug ]]; then
		deadline=0
		switch_to disconnected unplug
		return 0
	fi
	(( deadline )) || deadline=$(( EPOCHREALTIME + GRACE_SECONDS ))
}

expire() {
	deadline=0
	(( cable || uc || ! display )) && return 0
	switch_to disconnected "no link for ${GRACE_SECONDS}s"
}

stop() {
	note "stopped: $*"
	exit 1
}

classify() {
	case $1 in
	("cable "[01]) reply=(cable ${1#cable }) ;;
	(*"Connected Devices IDS: []"*) reply=(uc 0) ;;
	(*"Connected Devices IDS: ["*) reply=(uc 1) ;;
	(*"=== Display Sleep ==="*) reply=(display 0) ;;
	(*"=== Display Wake ==="*) reply=(display 1) ;;
	("producer exited: "*) stop "$1" ;;
	(*) return 1 ;;
	esac
}

receive() {
	classify "$1" || return 0
	local key=$reply[1] value=$reply[2]
	local previous=${(P)key}
	[[ $previous == $value ]] && return 0
	typeset -g $key=$value
	note "$key $value"
	local trigger=$key
	[[ $key == cable && $previous == 1 && $value == 0 ]] && trigger=unplug
	decide $trigger
}

wait_for_input() {
	(( deadline )) || return 0
	local -i centiseconds=$(( (deadline - EPOCHREALTIME) * 100 + 1 ))
	(( centiseconds > 0 )) || return 1
	zselect -t $centiseconds -r 0
	case $? in
	(0) return 0 ;;
	(1) return 1 ;;
	(*) stop "zselect failed" ;;
	esac
}

watch_events() {
	local line
	while true; do
		wait_for_input || { expire; continue }
		read -r line || stop "event stream closed"
		receive "$line"
	done
}

seed_events() {
	/usr/bin/log show --last "$LOOKBACK" --style compact --predicate "$LOG_PREDICATE" 2>/dev/null |
		awk '/Connected Devices IDS/ { link = $0 } /=== Display / { screen = $0 }
			END { print (screen ? screen : "=== Display Wake ==="); print (link ? link : "Connected Devices IDS: []") }'
}

run_producer() {
	"$@"
	print -r -- "producer exited: $1 (status $?)"
}

produce_events() {
	seed_events
	run_producer "$CABLE_WATCH" "$STUDIO_MODEL" &
	run_producer /usr/bin/log stream --style compact --predicate "$LOG_PREDICATE" &
	wait
}

main() {
	mkdir -p "$STATE_DIR"
	[[ -s "$(state_file)" ]] && applied=$(<"$(state_file)")
	[[ -n $applied ]] && remember_mode $applied
	note "start, applied: ${applied:-none}"
	produce_events | watch_events
}

[[ $ZSH_EVAL_CONTEXT == toplevel ]] && main
