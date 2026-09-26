/**
 * Guest-side command builders for the sandboxed backend: one script per action,
 * run through the sandbox's exec boundary. The wait itself happens inside the
 * guest - readiness, death and timeout are decided where the server, its log
 * and its process actually live - and the script ends with one trailer line
 * carrying its verdict, after the log tail it printed.
 *
 * The scripts speak POSIX sh plus bash's /dev/tcp, which is what the sandbox's
 * guest session provides; nothing here reaches the host's /tmp or ports.
 */
import { DEFAULT_READY_PATTERN_SOURCES, tailLines } from './probe.ts'

import type { GuestSlotPaths } from './state.ts'

/** Marks the verdict line; everything before it is the log tail the host reports. */
export const GUEST_REPORT_SENTINEL = '__PI_DEV_SERVER__'

export type GuestStatus =
	| 'ready'
	| 'already-running'
	| 'crashed'
	| 'timeout'
	| 'running'
	| 'stopped'
	| 'none'

export interface GuestReport {
	status: GuestStatus
	pid?: number | undefined
	elapsedMs?: number | undefined
}

export interface GuestStartInput {
	command: string
	paths: GuestSlotPaths
	readyPattern?: string | undefined
	port?: number | undefined
	healthUrl?: string | undefined
	timeoutSeconds: number
}

/** Single-quote a value for sh: the one escaping every generated line needs. */
export function shellQuote(text: string): string {
	return `'${text.split("'").join(`'\\''`)}'`
}

/** The slot variables plus the shared verdict/tail helpers. */
function prelude(paths: GuestSlotPaths): string[] {
	return [
		`slot=${shellQuote(paths.dir)}`,
		`log=${shellQuote(paths.log)}`,
		`pgid=${shellQuote(paths.pgidfile)}`,
		'mkdir -p "$slot"',
		`report() { printf '\\n${GUEST_REPORT_SENTINEL} status=%s pid=%s ms=%s\\n' "$1" "$2" "$3"; }`,
		'tail_log() { [ -f "$log" ] && tail -n 30 "$log"; }',
	]
}

/** True when the guest answers on the port; bash's /dev/tcp needs no extra tool. */
function portProbe(port: number): string {
	return `(exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null`
}

/** The port also counts as a readiness signal, and as an already-running one before launch. */
function prelaunchPortCheck(port: number | undefined): string[] {
	if (!port) return []
	return [
		`if ${portProbe(port)}; then`,
		'  tail_log',
		'  report already-running "" ""',
		'  exit 0',
		'fi',
	]
}

/** curl or wget, whichever the image has; neither installed leaves the other signals in charge. */
function healthCheck(url: string): string[] {
	const quoted = shellQuote(url)
	return [
		'if command -v curl >/dev/null 2>&1; then',
		`  curl -fsS -m 2 -o /dev/null ${quoted} 2>/dev/null && return 0`,
		'elif command -v wget >/dev/null 2>&1; then',
		`  wget -q -T 2 --spider ${quoted} 2>/dev/null && return 0`,
		'fi',
	]
}

function readyFunction(input: GuestStartInput): string[] {
	const patterns = input.readyPattern
		? [input.readyPattern]
		: DEFAULT_READY_PATTERN_SOURCES
	const grepArgs = patterns
		.map(pattern => `-e ${shellQuote(pattern)}`)
		.join(' ')
	const lines = [
		'ready() {',
		`  grep -E -i -q ${grepArgs} -- "$log" 2>/dev/null && return 0`,
	]
	if (input.port) lines.push(`  ${portProbe(input.port)} && return 0`)
	if (input.healthUrl)
		lines.push(...healthCheck(input.healthUrl).map(line => `  ${line}`))
	lines.push('  return 1', '}')
	return lines
}

/** Start: never twice, then launch detached and wait for a real signal inside the guest. */
export function guestStartScript(input: GuestStartInput): string {
	return [
		...prelude(input.paths),
		'# A live slot is never started twice.',
		'if [ -f "$pgid" ]; then',
		'  p=$(cat "$pgid" 2>/dev/null)',
		'  case "$p" in',
		'    ""|*[!0-9]*) rm -f "$pgid" ;;',
		'    *) if kill -0 "$p" 2>/dev/null; then',
		'         tail_log',
		'         report already-running "$p" ""',
		'         exit 0',
		'       fi',
		'       rm -f "$pgid" ;;',
		'  esac',
		'fi',
		...prelaunchPortCheck(input.port),
		': > "$log"',
		'start=$(date +%s)',
		`setsid nohup bash -lc ${shellQuote(input.command)} >> "$log" 2>&1 < /dev/null &`,
		'p=$!',
		'printf \'%s\\n\' "$p" > "$pgid"',
		...readyFunction(input),
		'status=timeout',
		'while :; do',
		'  if ! kill -0 "$p" 2>/dev/null; then status=crashed; break; fi',
		'  if ready; then status=ready; break; fi',
		`  if [ "$(date +%s)" -ge "$((start + ${input.timeoutSeconds}))" ]; then break; fi`,
		'  sleep 1',
		'done',
		'if [ "$status" = crashed ]; then rm -f "$pgid"; fi',
		'tail_log',
		'report "$status" "$p" "$(( ($(date +%s) - start) * 1000 ))"',
	].join('\n')
}

/** Stop: SIGTERM the recorded group, then SIGKILL it after the guest grace. */
export function guestStopScript(paths: GuestSlotPaths): string {
	return [
		...prelude(paths),
		'if [ ! -f "$pgid" ]; then report none "" ""; exit 0; fi',
		'p=$(cat "$pgid" 2>/dev/null)',
		'case "$p" in',
		'  ""|*[!0-9]*) rm -f "$pgid"; report none "" ""; exit 0 ;;',
		'esac',
		'if kill -0 "$p" 2>/dev/null; then',
		'  kill -TERM -"$p" 2>/dev/null',
		'  i=0',
		'  while [ "$i" -lt 30 ] && kill -0 "$p" 2>/dev/null; do sleep 0.1; i=$((i+1)); done',
		'  kill -KILL -"$p" 2>/dev/null',
		'  rm -f "$pgid"',
		'  report stopped "$p" ""',
		'else',
		'  rm -f "$pgid"',
		'  report none "$p" ""',
		'fi',
	].join('\n')
}

/** Status: report the recorded process and the log tail, changing nothing else. */
export function guestStatusScript(paths: GuestSlotPaths): string {
	return [
		...prelude(paths),
		'if [ ! -f "$pgid" ]; then tail_log; report none "" ""; exit 0; fi',
		'p=$(cat "$pgid" 2>/dev/null)',
		'case "$p" in',
		'  ""|*[!0-9]*) rm -f "$pgid"; tail_log; report none "" ""; exit 0 ;;',
		'esac',
		'if kill -0 "$p" 2>/dev/null; then',
		'  tail_log',
		'  report running "$p" ""',
		'else',
		'  rm -f "$pgid"',
		'  tail_log',
		'  report none "$p" ""',
		'fi',
	].join('\n')
}

const GUEST_STATUS_SET = new Set<string>([
	'ready',
	'already-running',
	'crashed',
	'timeout',
	'running',
	'stopped',
	'none',
])

function isGuestStatus(
	candidate: string | undefined,
): candidate is GuestStatus {
	if (!candidate) return false
	return GUEST_STATUS_SET.has(candidate)
}

/** `status=ready pid=123 ms=4567` -> a lookup; empty values are absent fields. */
function reportFields(line: string): Record<string, string> {
	const fields: Record<string, string> = {}
	for (const token of line.trim().split(/\s+/u)) {
		const separator = token.indexOf('=')
		if (separator <= 0) continue
		fields[token.slice(0, separator)] = token.slice(separator + 1)
	}
	return fields
}

function countOf(text: string | undefined): number | undefined {
	if (!text || !/^[0-9]+$/u.test(text)) return undefined
	const count = Number(text)
	if (!Number.isSafeInteger(count)) return undefined
	return count
}

/** Split a guest script's output into its verdict and the log tail it printed. */
export function parseGuestReport(output: string): {
	report: GuestReport | null
	logTail: string
} {
	const lines = output.split('\n')
	let index = -1
	for (let position = lines.length - 1; position >= 0; position -= 1) {
		const line = lines[position]
		if (line?.startsWith(GUEST_REPORT_SENTINEL)) {
			index = position
			break
		}
	}
	const body = lines.slice(0, index < 0 ? lines.length : index).join('\n')
	const logTail = tailLines(body)
	if (index < 0) return { report: null, logTail }
	const fields = reportFields(
		lines[index]?.slice(GUEST_REPORT_SENTINEL.length) ?? '',
	)
	if (!isGuestStatus(fields.status)) return { report: null, logTail }
	return {
		report: {
			status: fields.status,
			pid: countOf(fields.pid),
			elapsedMs: countOf(fields.ms),
		},
		logTail,
	}
}
