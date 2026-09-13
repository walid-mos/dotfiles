# Bounded read-only financial mailbox watch

Use this pattern when a finance assistant needs recurring email triage without turning a scheduled run into an unrestricted agent session. It is a reusable architecture, not a substitute for the mailbox provider's read-only guard.

## Separate collection from interpretation

Run a small deterministic collector before the language model. The collector should:

1. use the approved read-only mailbox wrapper, never raw credentials or a second mail client;
2. enumerate the explicitly configured account aliases once;
3. list mailboxes once per account and record errors as structured data;
4. select the Inbox plus the configured Archive/All-Mail equivalent, using the exact provider mailbox name;
5. fetch only a bounded first page of envelope metadata from each selected mailbox;
6. apply a short recent-time window while retaining older messages that match a documented finance hint;
7. deduplicate by provider message id within an account;
8. emit JSON metadata and coverage/errors to stdout, with no state file and no mailbox or workspace writes.

Recommended envelope fields are account alias, exact mailbox, provider id, timestamp, sender, subject, flags, attachment flag, `recent_24h`, and a non-authoritative relevance hint. Never emit message bodies, attachment contents, credentials, tokens, or full provider configuration.

Each subprocess/network operation needs its own finite timeout. A single account or mailbox failure must not abort the other accounts; report the failure explicitly so a partial scan is never presented as complete. Do not retry indefinitely inside the scheduled run.

## Constrain the scheduled agent

The LLM should receive the collector's bounded JSON as its input and classify/report it; it should not recollect the mailbox. Give the cron platform no agent toolsets when the collector already supplied the evidence. Use low reasoning effort, no continuity requirement, and a prompt that explicitly forbids `execute_code`, inline Python, body reads, attachment downloads, and all mailbox mutations. Keep the final report short and fact-based:

- coverage by account and mailbox;
- relevant sender/date/subject and the evidence actually available;
- attachment status as unknown when metadata does not confirm it;
- suggested next action, never an action already performed;
- inaccessible accounts/mailboxes and any partial-result limitation.

If there are no relevant messages and no access errors, use the configured silent/no-op marker. Do not claim a financial amount, merchant, legal effect, or urgency that is not present in the metadata.

## Bot Chat delivery and verification

A Bot Chat is persistent. Injecting a cron result into it can cause the bot to process that result using its existing conversation context. Before testing a new delivery target, compact a stale or very large canonical Bot Chat; otherwise the delivery handoff can take much longer than the deterministic collection and obscure whether the cron agent itself succeeded. Verify separately:

1. the exported cron session completed with zero agent tool calls when that is the design;
2. the cron run status is completed;
3. the Bot Chat received the resulting message;
4. the scheduler health check reports no active-job issue.

Historical failed attempts may remain useful for diagnosis, but they must not be treated as proof that the current job is broken after a later completed run. Conversely, a successful trigger is not enough if the exported session or delivery target was never checked.

## Security boundary

This watch is read-only. It may identify a message that needs manual review, but it must not send, forward, archive, delete, move, copy, download, OCR, or save an email or attachment. A second workflow with explicit authorization is required for any of those effects.