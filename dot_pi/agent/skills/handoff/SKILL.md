---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace - unless the caller supplies an absolute path, which is then the destination.

The next prompt will hold this document and the most recent messages only: write it so it stands alone. Earlier handoffs will not be in it, so fold in whatever they alone carried.

Open with one line naming the next session's focus - the checklist item or plan step this session is on.

Use these sections:

- State - the goal, what is done, what is in flight.
- Next steps - the exact next action.
- Files in play - paths read or modified, one per line.
- Unverified assumptions - anything this session claimed without checking, so the next agent re-checks it instead of trusting it.
- Suggested skills - name each skill and the path to its SKILL.md so the next agent can read it.

Check before you claim: `git status`, `git diff`, the plan or checklist file - a belief written as a fact becomes a false premise for everything that follows.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
