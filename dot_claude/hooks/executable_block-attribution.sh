#!/bin/sh
# PreToolUse hook (Bash): refuses any git or gh command that would credit Claude or Anthropic
# (Co-Authored-By trailer, "Generated with Claude Code", Claude-Session link, noreply@anthropic.com).
# Exit 2 blocks the call; stderr is shown to the model.
cmd=$(jq -r '.tool_input.command // empty')
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])(git|gh)[[:space:]]' || exit 0
if printf '%s' "$cmd" | grep -Eiq 'co-authored-by:[^\n]*(claude|anthropic)|noreply@anthropic\.com|generated with[^\n]*claude|claude\.com/claude-code|claude-session:'; then
	echo "Blocked: no Claude or Anthropic attribution in commits, PRs or anything sent to GitHub. Remove the attribution line and retry." >&2
	exit 2
fi
exit 0
