# pi-frontend-check - local Brave adaptation

A local adaptation of [sebaxzero/pi-frontend-check](https://github.com/sebaxzero/pi-frontend-check), based on upstream commit `afd74c8`. It preserves the frontend testing tools while using **installed Brave**, not a downloaded Chromium build. Upstream license: MIT.

## Install and use

The package is vendored at `~/.pi/agent/packages/pi-frontend-check` and loaded through `settings.json` `packages`. After changing dependencies:

```bash
cd ~/.pi/agent/packages/pi-frontend-check
pnpm install --ignore-scripts
```

Run `/reload` in the active Pi session. Start your own development server, then ask Pi to open and test its URL. The extension never starts a dev server or downloads a browser. Browser automation needs no paid browser service or API key; normal model usage still applies.

| Tool                        | Purpose                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend_open`             | Open HTTP(S), host:port, or absolute/`./relative` HTML paths; return page health and an optional screenshot                                                                                                                |
| `frontend_act`              | Strict Playwright interactions; optional post-action readiness and expected-popup waiting; failures error out with the failed step and bounded locator diagnostics                                                         |
| `frontend_batch`            | Run up to 25 ordered actions in the current authenticated session; the first failed step errors out with one failure report naming the failed and completed steps, bounded locator diagnostics, and a remainder-only retry |
| `frontend_screenshot`       | Viewport, full-page or element capture; persistent responsive viewport resizing                                                                                                                                            |
| `frontend_console`          | Bounded console/page/network diagnostics, with error totals preserved after log eviction                                                                                                                                   |
| `frontend_eval`             | Bounded JavaScript evaluation for exact DOM/style/app assertions                                                                                                                                                           |
| `frontend_vault_list`       | List origin-bound shared Infisical web-login handles and identifiers, without passwords                                                                                                                                    |
| `frontend_vault_fill`       | Fill one visible password field at the saved exact origin; no password in the tool output or screenshot                                                                                                                    |
| `frontend_scenarios`        | Run a scenario JSON file in parallel isolated contexts, one page-state dump per checkpoint and a screenshot per failed step (or per step asking for one with `screenshot: true`)                                           |
| `frontend_check_spec`       | Judge the open page against a project spec file — one batched Jev call, confidence-gated; without `TYPESAFE_API_KEY` it returns the extracted state for your own judgment                                                  |
| `frontend_capture_specimen` | Freeze the open page — or a `scope` region of it — session state included (login, impersonation, demo toggles), into a reusable specimen file                                                                              |
| `frontend_iso_diff`         | Diagnostic component diff (styles, geometry, text, attributes), not a pixel-level pass gate; optional Jev judgment                                                                                                         |
| `frontend_capture_pixels`   | Save an exact PNG of a prepared session state, viewport or strict selector, with fonts/images ready and animations disabled                                                                                                |
| `frontend_pixel_diff`       | Compare two PNG captures exactly; zero changed pixels passes, otherwise return a count and red difference map                                                                                                              |

Use `wait_for` to declare app readiness. There are no arbitrary sleeps or `networkidle` delays. Set `popup=true` on a click expected to open a new tab. Ambiguous selectors fail rather than selecting the first match. `select` accepts an option value or exact label. `type` replaces field contents; an empty string clears them.

`frontend_open`, `frontend_act`, and `frontend_batch` support `screenshot=false` for text-only checks and intermediate actions. Automatic images are omitted for non-vision models. Capture failures are reported explicitly without repeating a completed action. Explicit screenshot failures and navigation timeouts are tool errors, not successful partial checks. An ordinary `frontend_act` or `frontend_batch` step failure also fails the call with an error result that carries the failed step (with the batch step id and the steps completed before it), a bounded failure reason, the failing locator's live match count and the current page URL. The browser, login and page stay open and applied actions are never replayed automatically; re-run only the failed remainder, and inspect the page first when the failed step's action already ran (a `wait_for` failed after a completed action) because re-running would repeat that action, or when the action itself failed - an action failure does not prove the step had no effect: a click can navigate or open the popup it targeted even while its wait times out.

`ACTION_TIMEOUT_MS` bounds Playwright actions and locator waits independently from `NAV_TIMEOUT_MS`. An ordinary action failure is reported as an error result carrying the failed report, while the browser, login, storage and page remain open for inspection or a corrected action. A `wait_for` failure after the page has loaded also preserves the loaded page and session state for DOM inspection; only a failed navigation itself closes the isolated browser. External cancellation and a hard whole-operation deadline still close the isolated browser because the underlying work may be wedged.

## Shared website logins

`frontend_vault_list` and `frontend_vault_fill` use the dedicated Infisical project also connected to Hermes factory's browser-vault plugin. See [the shared broker documentation](../shared-web-logins/README.md) and the [Pi workflow skill](skills/shared-web-logins/SKILL.md). The first credential entry for an absent site is via **Hermes desktop's masked** `browser_vault_save_login` prompt; then both agents see the same origin-bound login. `frontend_act type` refuses password fields, and captures are suppressed after a shared fill until this browser connection is released. Website sessions run in each session's own isolated browser with its own persistent profile by default; when several agents must share one signed-in session, opt into [the managed browser](docs/shared-browser.md), not Infisical. Site-required MFA/consent can still apply.

## Spec checks and ISO-prototype diffs

`frontend_check_spec` judges a page against a spec JSON file the project owns — `{name?, url?, items: [{id, requirement, source?}]}`. One batched Jev call answers `satisfied`/`violated`/`cannot-tell` per item; below the confidence gate, or `cannot-tell`, is reported as needing an agent check and is never auto-passed. It covers what the page shows; criteria needing interaction, a blocked action or absence over time stay with `frontend_act` and `frontend_scenarios`.

`frontend_iso_diff` compares an implementation side against a baseline side (an HTML prototype, not a mockup image). Each side is either a **captured specimen** or a **cold URL**: for pages behind login or reachable only through session interaction, navigate with `frontend_act` and freeze each side with `frontend_capture_specimen`, then diff with `captured_a`/`captured_b` — no browser is launched and the page can be navigated away. Cold URLs stay supported for directly reachable pages (implementation_url/baseline_url). On either kind of side, `scope` (a CSS selector) restricts the specimen to one region — capture the same region on both sides so wrapper chrome (a prototype's demo panel, marketing headers) stays out of the diff.

Components are extracted by role with computed styles, geometry and text; equal style signatures alone do not establish pixel equality. Components pair by role, then by visible text (order only for leftovers), so extra chrome on one side no longer desynchronizes the pairing. Differing and unmatched components are listed with property-level deltas; with `TYPESAFE_API_KEY`, one batched Jev call judges each differing pair (named colors, not hex, which jev-1.13 cannot compare) under a faithful-reproduction standard, confidence-gated. Use this for diagnosis, not as the strict visual acceptance gate. For that, navigate each side to the same data and state, capture each with `frontend_capture_pixels` at the same viewport and an equivalent region — the caller selects the region, so the selector spelling may differ between sides, but capture kind (viewport vs element), position and dimensions must match exactly — then call `frontend_pixel_diff`. Equal dimensions and zero changed RGBA pixels are the only PASS. Neither tool discovers omitted business states; cover those separately. Captures live under `~/.pi/agent/frontend-check/pixels/` and persist until removed.

Both tools need `TYPESAFE_API_KEY` only for the judgment step; without it they degrade to extraction-only output instead of failing.

## Progress-aware pixel investigation

`frontend_pixel_diff` keeps versioned custom receipts in the current Pi branch.
Identical PNG bytes **and metadata** reuse the recorded PASS/FAIL, including after
compaction or reload. Capture filenames are not evidence identity; reuse describes
the stored images, not an unobserved current UI. Difference overlays have unique
filenames so later comparisons do not overwrite retained evidence.

After a failed comparison on the same URL-path/selector pair, changed PNGs alone
are insufficient. A probe cites an exact excerpt of a successful diagnostic or
source tool result on that branch; the latest matching result is resolved without
a transcript lookup. The tool schema describes the optional entry ID. Jev judges
whether that evidence supports a new falsifiable diagnostic or correction check.
A supported next step may continue regardless of elapsed time or attempt count;
a lower pixel count alone is not progress. Jev cannot alter the exact pixel verdict.

Missing, inconclusive or failed judgments never grant continuation. Exact spent
proposals are not sent to Jev again; semantic rephrasings are judged against prior
attempts. Only cited excerpts and compact prior outcomes are sent to the existing
Jev service, with the browser's known-secret redaction; do not cite credentials.
A technical judge-context size limit escalates rather than silently dropping
history. Independent work remains possible when one visual criterion is held.

This is a guard on this comparison tool, not a universal agent execution budget:
it does not prevent unrelated screenshots or shell commands. The family identity
uses URL paths and selector strings (ignoring query/hash for the family, not exact
proof reuse); it cannot infer equivalent selectors or unrelated locale paths.
New sessions or branches excluding receipts do not inherit abandoned history.
Never use those boundaries to evade a hold; the scoped evidence manifest remains
responsible for naming genuinely distinct required states.

`extensions/pixel-progress.ts` owns identity, citations and receipts;
`pixel-progress-run.ts` owns admission/reuse; `pixel-progress-judge.ts` owns the
Jev usefulness question. `pixel-tools.ts` serializes comparison and persists via
Pi's supported session API; exact RGBA comparison remains in `pixel-diff.ts`.

## Isolation and limits

- Headless-only: no visible browser windows or desktop focus changes, including popups. `HEADLESS` accepts only `true`; saved `false` values must be removed or corrected before reload.
- Interactive browsing runs one isolated browser per extension instance with a per-session persistent profile (empty `CDP_URL`, the default): cookies and sign-ins survive browser relaunches and resuming the same session, while each other session gets its own profile under `~/.pi/agent/frontend-check/profiles/<session>/` (mode `0700`, swept after 14 days unused). Opt-in interactive browsing can attach to the managed shared profile through loopback `CDP_URL` instead; see [the managed browser guide](docs/shared-browser.md) for setup, ownership and verification. Personal Brave is never reused.
- Browser calls and settings commands are serialized. Closing/resetting, cancellation and shutdown release owned resources: in shared mode, only this client's tabs and connection; in isolated mode, its whole browser. Shared authentication survives these releases. Queued cancelled calls do not execute.
- Uses `playwright-core` with an explicit executable path. Brave is detected in macOS system/user Applications, or as `brave-browser`, `brave-browser-stable`, or `brave` on PATH. Other installations require `EXECUTABLE_PATH`.
- Chromium sandbox stays enabled; TLS errors are not ignored and downloads are not accepted. Localhost, private addresses and `file:` are intentionally allowed for testing. This is **not an SSRF filter or a sandbox for hostile websites**. Page text, logs and screenshots are untrusted evidence, never agent instructions.
- No automatic clicks or form submission outside explicit tool calls. `frontend_eval` can mutate app state; use dedicated test accounts and normal authorization discipline.
- Output budgets: text 16 KB/200 lines, retained log entries 2 KB each, screenshots 5 MB. Evaluation uses the configured byte budget. Truncated output says to narrow the query; full logs are not written to disk.
- Resizing tests CSS responsiveness, not touch/mobile-device emulation. No Safari/Firefox testing, automatic accessibility audit, business-branch discovery or performance score is claimed. Pixel comparisons require prepared equivalent states in this same Brave session.
- Brave's release cadence is independent of Playwright. Keep the pinned adapter version and rerun the real-browser suite after browser/adapter upgrades. Brave Shields may affect third-party resources; do not globally disable protections to hide failures.

## Scenario runs

`frontend_scenarios` executes a scenario JSON file - `url`, optional `waitFor`, an `extract` expression, an optional `probe` expression and `steps` (`action`, `target`, `text`, `key`, `wait_for`, plus `checkpoint`) - in `concurrency` isolated contexts, `runs` times each. Every checkpoint writes the extracted page state to `output_dir/run-N/<step>.state.json`; a failed step ends that run, records the failure and saves a screenshot beside the state. A state also carries what the page alone cannot say: `after` names the action that produced it and `observed` holds the `probe` value before and after that action, so an action the page refused reads as equal values on both sides. A step with `screenshot: true` writes a full-page `run-N/<step>.png` even when it passes. Failures are app findings, not tool errors: only a malformed file or an unlaunchable browser raises. The runner owns its browser and is deliberately not serialized with the `frontend_*` tools, which keep their single-page session; no personal profile, cookies or tabs are used. Judge the dumped states with your own criteria layer - the driver only drives and captures.

`/frontend-check` shows status, the effective configuration and its path. Settings are loaded from `frontend-check.json` in Pi's agent directory (normally `~/.pi/agent/frontend-check.json`). Missing files use defaults without writing anything. Invalid existing configuration fails explicitly at extension load; fix it and reload. No project-local config is executed or read.

```text
/frontend-check set AUTO_SHOT=false
/frontend-check set EXECUTABLE_PATH=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser
/frontend-check save
/frontend-check reset
```

Set one key per command; paths containing spaces are supported without shell quoting. Values are validated, not loosely coerced. Settings changes release the client connection so all changes take effect consistently; they never stop a shared browser. `save` is the only configuration write; `reset` releases this client's tabs and connection without changing settings.

`extensions/config-schema.ts` owns the configuration shape and viewport limits; `extensions/schema.ts` owns defaults and tool schemas. `CDP_URL` selects shared interactive browsing when set; empty preserves isolated tests. `EXECUTABLE_PATH` selects an installed binary for isolated browsers, with empty meaning Brave auto-detection. `NAV_TIMEOUT_MS` bounds navigation and the default whole operation; `ACTION_TIMEOUT_MS` bounds Playwright actions and locator waits. A batch receives one action budget per step in addition to the navigation budget. The legacy `MAX_EVAL_CHARS` name is retained, but its limit is a UTF-8 **byte** budget.

## Local Pi integration

Pi's native renderer and the existing `~/.pi/agent/extensions/renderers/` own presentation, including images and expanded results. The old mac-config `compact-tools` patch is intentionally not imported. There are no custom render surfaces or changes to Pi's built-in tools. Runtime dependencies live in this standalone package, not in `~/.pi/agent`.

`extensions/browser.ts` owns the session operations and redaction; `browser-connection.ts` owns process/connection lifecycle and client-owned tabs; `browser-operation.ts` owns deadline/abort cleanup; `serial-queue.ts` owns ordering. `page-actions.ts` and `page-events.ts` are Playwright adapters. Schemas/settings, reporting, tool registration and command handling are separate importable modules. `docs/shared-browser.md` records the shared-browser ownership and deployment contract.

## Verify

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run test:browser
```

Unit tests need no browser. The opt-in browser suite requires installed Brave and serves only an ephemeral loopback fixture. It tests actual rendering, PNG/JPEG capture, input clearing, selection by label, strict selectors, popups, HTTP/request diagnostics, cancellation, timeout and session isolation. It never accesses personal browsing data. Format only changed code files with the house oxfmt config; never format skills or persistent instructions.
