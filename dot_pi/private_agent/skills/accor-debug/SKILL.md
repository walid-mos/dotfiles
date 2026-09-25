---
name: accor-debug
description: Reproduce, triage, and fix a batch of 3 or more bugs in accor-hotels/product-data-apps with parallel code/prototype/log analysis, one grouped browser pass, and one final package gate. Use when the user provides several Menu Compliance bug notes, regressions, or review findings to investigate and fix.
---

# Accor multi-bug debugging

Optimize for elapsed time, model cost, and reproducible evidence without weakening the final gate.

## Preconditions

Load `accor-conventions`, `frontend-testing` for browser UI, `coding` before code work, and `pi-subagents` for the investigation fan-out.

## 1. Build one bug matrix

Normalize the notes into stable IDs. For each bug, record the expected behavior, likely surface, evidence needed, and status: `confirmed`, `code-confirmed`, `not reproduced`, or `not a bug`. Keep one row per user report; do not split reproduction and fixing into duplicate checklist items.

## 2. Investigate in parallel

For three or more independently inspectable reports, invoke the generic named `multi-issue-scout` workflow with the complete bug matrix before browser exploration. The resource owns the read-only lane roles and budgets; the parent owns synthesis, the shared browser session, product decisions, and final acceptance.

Follow `pi-subagents` writer-isolation rules after the parallel diagnosis freezes the contract.

## 3. Reproduce in one browser pass

Follow `frontend-testing`'s fast evidence discipline. Start the stack once and group reports by persona, campaign, and route so each login and setup serves several bugs. In a dev VM, use the host-reachable tailnet URL, never the VM's `localhost` URL.

Classify code-proven variants that fixtures cannot produce as `code-confirmed`; do not manufacture data only to obtain a screenshot.

## 4. Fix by contract

Freeze the shared API/frontend shape before editing. Group fixes by domain and shared files, then apply the minimum-change ladder. Keep unrelated bug fixes in separate atomic commits when each commit compiles on its own.

After host-side edits to a VM-mounted worktree, trigger one VM-side watcher refresh for all changed files before the final browser pass. Do not debug stale HMR as application behavior.

## 5. Validate once

During implementation, run only the narrow existing command needed to answer a concrete failure. After the complete patch:

1. build the API when frontend types depend on it;
2. submit independent touched-package typecheck, lint, and existing-test gates through the generic `parallel-gates` workflow once;
3. run the grouped live browser pass once on the final code;
4. retry only a timed-out untouched test file, once, when VM load is the proven cause.

Slow gates follow the global detached-work rule.

## Report

Return the bug matrix with verdict and proof, commits, the exact final commands, unverified variants, and infrastructure-only failures. Report once after all rows are resolved or blocked.
