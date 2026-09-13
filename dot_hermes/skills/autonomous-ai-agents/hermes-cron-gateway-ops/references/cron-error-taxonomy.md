# Cron run error taxonomy — Walid's install (observed 2026-08-25)

Decision table for the failure signatures seen on the Bookmarks Curator / Freelance Presence jobs.
Each row: symptom → real cause → correct action.

| Error | Looks like | Actually | Action |
|---|---|---|---|
| `[drift_skip] Skipped to prevent unintended spend ... unpinned` | job broken | protective skip after global config change; no inference was billed | pin explicitly: `hermes cron edit <id> --model M --provider P` |
| `HTTP 404: Model 'X' not found ... OpenRouter catalog` | provider outage | model ID doesn't exist on that route — usually a missing org prefix (`ox-alpha` vs `stealth/ox-alpha`) | verify ID in live `/v1/models`, re-pin with exact string |
| `HTTP 404: ... requires available credits. balance too low` | model missing | billing gate on paid models (Nous portal) | switch route (e.g. openai-codex) or add portal credits |
| `HTTP 429: temporarily at capacity upstream` | rate limit / key issue | upstream capacity, not the API key; intermittent | retry later; if chronic on stealth models, switch route |
| `HTTP 400: 'M' is not supported when using Codex with a ChatGPT account` | bad job pin | someone drove the cron session from the desktop UI, which runs GLOBAL config over the pinned one | don't chat into cron sessions; check whether the request even came from scheduler |

Diagnostic order that worked:
1. `hermes cron history <job_id>` — exact error per run, with source (builtin vs direct).
2. `~/.hermes/logs/errors.log` — grep the session id (`cron_<jobid>_<ts>`) for provider/base_url/model per attempt; distinguishes "wrong pin" from "right pin, upstream sick".
3. Direct curl against the inference endpoint to test the model route independently of Hermes.
4. `cronjob action=run` as end-to-end verification after any fix.

Note on delivery: these jobs deliver to `origin`; when fired from a session with no origin channel, output lands in `~/.hermes/cron/output/<job_id>/<timestamp>.md` and the log line says "skipping delivery".
