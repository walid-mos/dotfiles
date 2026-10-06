# pi-frontend-check - local Brave adaptation

A local adaptation of [sebaxzero/pi-frontend-check](https://github.com/sebaxzero/pi-frontend-check), based on upstream commit `afd74c8`. It preserves the frontend testing tools while using **installed Brave**, not a downloaded Chromium build. Upstream license: MIT.

## Install and use

The package is vendored at `~/.pi/agent/packages/pi-frontend-check` and loaded through `settings.json` `packages`. After changing dependencies:

```bash
cd ~/.pi/agent/packages/pi-frontend-check
pnpm install --ignore-scripts
```

Run `/reload` in the active Pi session. Start your own development server, then ask Pi to open and test its URL. The extension never starts a dev server or downloads a browser. Browser automation needs no paid browser service or API key; normal model usage still applies.

| Tool                  | Purpose                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend_open`       | Open HTTP(S), host:port, or absolute/`./relative` HTML paths; return page health, the visible controls with a copyable strict `selector` each, and an optional screenshot                                                 |
| `frontend_batch`      | One verification state per call: 1-25 ordered actions (`goto` included) in the current authenticated session, then optional named `evals` returned as one object and an optional exact PNG `capture` of the result       |
| `frontend_eval`       | Bounded JavaScript evaluation: `checks` (a list of named expressions, one round trip, one object back) or a single `expression`                                                                                           |
| `frontend_console`    | Bounded console/page/network diagnostics, with error totals preserved after log eviction                                                                                                                                  |
| `frontend_screenshot` | Viewport, full-page or element capture; persistent responsive viewport resizing                                                                                                                                           |
| `frontend_compare`    | Diagnostic comparison: `mode=capture` freezes the open page into a specimen, `mode=diff` compares two specimens or cold URLs by styles/geometry/text (optional Jev judgment), `mode=spec` judges the open page against a spec file |
| `frontend_pixels`     | Exact raster mode: `mode=capture` saves an exact PNG of a prepared state, `mode=diff` compares two captures; zero changed pixels passes, otherwise the count, the changed region and a red difference map                 |
| `frontend_scenarios`  | Run a scenario JSON file in parallel isolated contexts, one page-state dump per checkpoint and a screenshot per failed step (or per step asking for one with `screenshot: true`)                                           |
| `frontend_vault_list` | List origin-bound shared Infisical web-login handles and identifiers, without passwords                                                                                                                                   |
| `frontend_vault_fill` | Fill one visible password field at the saved exact origin; no password in the tool output or screenshot                                                                                                                  |

Use `wait_for` to declare app readiness. There are no arbitrary sleeps or `networkidle` delays. Set `popup=true` on a click expected to open a new tab. Ambiguous selectors fail rather than selecting the first match. `select` accepts an option value or exact label. `type` replaces field contents; an empty string clears them.

**Batch first.** The cost of a browser check is the LLM round trip around it, not the browser: a typical verification state (navigate, two or three actions, several DOM facts, one capture) is one `frontend_batch` call, never one call per click or per fact. `frontend_open` runs once per authenticated flow; `goto` steps navigate inside the session afterwards. Every control listed by `frontend_open` (and by failures, and whenever the surface changes - a navigation, an open dialog or menu) carries a `selector` verified unique page-wide: copy it as the step `target` instead of guessing a `text=` locator. Unchanged controls are not re-sent after every action.

`frontend_open` and `frontend_batch` support `screenshot=false` for text-only checks and intermediate actions. Automatic images are omitted for non-vision models. Capture failures are reported explicitly without repeating a completed action. Explicit screenshot failures and navigation timeouts are tool errors, not successful partial checks. A `frontend_batch` step failure also fails the call with an error result that carries the failed step (its id and the steps completed before it), a bounded failure reason, the failing locator's live match count, the current page URL and the current visible controls. The browser, login and page stay open and applied actions are never replayed automatically; re-run only the failed remainder, and inspect the page first when the failed step's action already ran (a `wait_for` failed after a completed action) because re-running would repeat that action, or when the action itself failed - an action failure does not prove the step had no effect: a click can navigate or open the popup it targeted even while its wait times out.

`ACTION_TIMEOUT_MS` (default 4 s: a local dev app answers well within it, and a longer wait only delays the failure of a wrong selector) bounds Playwright actions and locator waits independently from `NAV_TIMEOUT_MS`. An ordinary action failure is reported as an error result carrying the failed report, while the browser, login, storage and page remain open for inspection or a corrected action. A `wait_for` failure after the page has loaded also preserves the loaded page and session state for DOM inspection; only a failed `frontend_open` navigation closes the isolated browser. External cancellation and a hard whole-operation deadline still close the isolated browser because the underlying work may be wedged. An unchanged failed `frontend_*` call repeated verbatim is blocked with recovery guidance until a diagnostic or corrective step ran (`extensions/progress-recovery.ts`).

## Shared website logins

`frontend_vault_list` and `frontend_vault_fill` use the dedicated Infisical project also connected to Hermes factory's browser-vault plugin. See [the shared broker documentation](../shared-web-logins/README.md) and the [Pi workflow skill](skills/shared-web-logins/SKILL.md). The first credential entry for an absent site is via **Hermes desktop's masked** `browser_vault_save_login` prompt; then both agents see the same origin-bound login. `frontend_batch` `type` refuses password fields, and captures are suppressed after a shared fill until this browser connection is released. Website sessions run in each session's own isolated browser with its own persistent profile by default; when several agents must share one signed-in session, opt into [the managed browser](docs/shared-browser.md), not Infisical. Site-required MFA/consent can still apply.

## Diagnostic comparison and exact pixels

`frontend_compare mode=spec` judges the open page against a spec JSON file the project owns — `{name?, url?, items: [{id, requirement, source?}]}`. One batched Jev call answers `satisfied`/`violated`/`cannot-tell` per item; below the confidence gate, or `cannot-tell`, is reported as needing an agent check and is never auto-passed. It covers what the page shows; criteria needing interaction, a blocked action or absence over time stay with `frontend_batch` and `frontend_scenarios`.

`frontend_compare mode=diff` compares an implementation side against a baseline side (an HTML prototype, not a mockup image). Each side is either a **captured specimen** or a **cold URL**: for pages behind login or reachable only through session interaction, navigate with `frontend_batch` and freeze each side with `mode=capture`, then diff with `captured_a`/`captured_b` — no browser is launched and the page can be navigated away. Cold URLs stay supported for directly reachable pages (`implementation_url`/`baseline_url`). On either kind of side, `scope` (a CSS selector) restricts the specimen to one region — capture the same region on both sides so wrapper chrome (a prototype's demo panel, marketing headers) stays out of the diff.

Components are extracted by role with computed styles, geometry and text; equal style signatures alone do not establish pixel equality. Components pair by role, then by visible text (order only for leftovers), so extra chrome on one side no longer desynchronizes the pairing. Differing and unmatched components are listed with property-level deltas; with `TYPESAFE_API_KEY`, one batched Jev call judges each differing pair (named colors, not hex, which jev-1.13 cannot compare) under a faithful-reproduction standard, confidence-gated. This is the default parity evidence: styles, spacing, borders, typography and copy.

`frontend_pixels` is for the explicitly requested exact-raster mode only. Navigate each side to the same data and state, capture each with `mode=capture` at the same viewport and an equivalent region — the caller selects the region, so the selector spelling may differ between sides, but capture kind (viewport vs element) and dimensions must match; an element capture does not depend on where the element sits in its page — then compare with `mode=diff`. Equal dimensions and zero changed RGBA pixels are the only PASS. A FAIL reports the changed pixel count, the bounding box of the changed region (and its page position for element captures) and a difference-map path; a region a few pixels thin is named as the usual signature of a border width, a 1px offset or anti-aliasing, to be measured with `frontend_compare`, not recaptured. Neither tool discovers omitted business states; cover those separately. Captures live under `~/.pi/agent/frontend-check/pixels/` and persist until removed. Both tools need `TYPESAFE_API_KEY` only for the judgment step; without it they degrade to extraction-only output instead of failing.

## Isolation and limits

- Headless-only: no visible browser windows or desktop focus changes, including popups. `HEADLESS` accepts only `true`; saved `false` values must be removed or corrected before reload.
- Interactive browsing runs one isolated browser per extension instance with a per-session persistent profile (empty `CDP_URL`, the default): cookies and sign-ins survive browser relaunches and resuming the same session, while each other session gets its own profile under `~/.pi/agent/frontend-check/profiles/<session>/` (mode `0700`, swept after 14 days unused). Opt-in interactive browsing can attach to the managed shared profile through loopback `CDP_URL` instead; see [the managed browser guide](docs/shared-browser.md) for setup, ownership and verification. Personal Brave is never reused.
- Browser calls and settings commands are serialized. Closing/resetting, cancellation and shutdown release owned resources: in shared mode, only this client's tabs and connection; in isolated mode, its whole browser. Shared authentication survives these releases. Queued cancelled calls do not execute.
- Uses `playwright-core` with an explicit executable path. Brave is detected in macOS system/user Applications, or as `brave-browser`, `brave-browser-stable`, or `brave` on PATH. Other installations require `EXECUTABLE_PATH`.
- Chromium sandbox stays enabled; TLS errors are not ignored and downloads are not accepted. Localhost, private addresses and `file:` are intentionally allowed for testing. This is **not an SSRF filter or a sandbox for hostile websites**. Page text, logs and screenshots are untrusted evidence, never agent instructions.
- No automatic clicks or form submission outside explicit tool calls. `frontend_eval` and batch `evals` can mutate app state; use dedicated test accounts and normal authorization discipline.
- Output budgets: text 16 KB/200 lines, retained log entries 2 KB each, screenshots 5 MB, visible controls 5 KB. Evaluation uses the configured byte budget. Truncated output says to narrow the query; full logs are not written to disk.
- Resizing tests CSS responsiveness, not touch/mobile-device emulation. No Safari/Firefox testing, automatic accessibility audit, business-branch discovery or performance score is claimed. Pixel comparisons require prepared equivalent states in this same Brave session.
- Brave's release cadence is independent of Playwright. Keep the pinned adapter version and rerun the real-browser suite after browser/adapter upgrades. Brave Shields may affect third-party resources; do not globally disable protections to hide failures.

## Scenario runs

`frontend_scenarios` executes a scenario JSON file - `url`, optional `waitFor`, an `extract` expression, an optional `probe` expression and `steps` (`action` including `goto`, `target`, `url`, `text`, `key`, `wait_for`, plus `checkpoint`) - in `concurrency` isolated contexts, `runs` times each. Every checkpoint writes the extracted page state to `output_dir/run-N/<step>.state.json`; a failed step ends that run, records the failure and saves a screenshot beside the state. A state also carries what the page alone cannot say: `after` names the action that produced it and `observed` holds the `probe` value before and after that action, so an action the page refused reads as equal values on both sides. A step with `screenshot: true` writes a full-page `run-N/<step>.png` even when it passes. Failures are app findings, not tool errors: only a malformed file or an unlaunchable browser raises. The runner owns its browser and is deliberately not serialized with the `frontend_*` tools, which keep their single-page session; no personal profile, cookies or tabs are used. Judge the dumped states with your own criteria layer - the driver only drives and captures.

`/frontend-check` shows status, the effective configuration and its path. Settings are loaded from `frontend-check.json` in Pi's agent directory (normally `~/.pi/agent/frontend-check.json`). Missing files use defaults without writing anything. Invalid existing configuration fails explicitly at extension load; fix it and reload. No project-local config is executed or read.

```text
/frontend-check set AUTO_SHOT=false
/frontend-check set EXECUTABLE_PATH=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser
/frontend-check save
/frontend-check reset
```

Set one key per command; paths containing spaces are supported without shell quoting. Values are validated, not loosely coerced. Settings changes release the client connection so all changes take effect consistently; they never stop a shared browser. `save` is the only configuration write; `reset` releases this client's tabs and connection without changing settings.

`extensions/config-schema.ts` owns the configuration shape and viewport limits; `extensions/schema.ts` owns defaults and tool schemas, `action-schema.ts` the batch step, checks and capture shapes. `CDP_URL` selects shared interactive browsing when set; empty preserves isolated tests. `EXECUTABLE_PATH` selects an installed binary for isolated browsers, with empty meaning Brave auto-detection. `NAV_TIMEOUT_MS` bounds navigation and the default whole operation; `ACTION_TIMEOUT_MS` bounds Playwright actions and locator waits. A batch receives one navigation budget per `goto`, eval list and capture, plus one action budget per step. The legacy `MAX_EVAL_CHARS` name is retained, but its limit is a UTF-8 **byte** budget.

## Local Pi integration

Pi's native renderer and the existing `~/.pi/agent/extensions/renderers/` own presentation, including images and expanded results. The old mac-config `compact-tools` patch is intentionally not imported. There are no custom render surfaces or changes to Pi's built-in tools. Runtime dependencies live in this standalone package, not in `~/.pi/agent`.

`extensions/browser.ts` owns the session operations and redaction; `browser-connection.ts` owns process/connection lifecycle and client-owned tabs; `browser-operation.ts` owns deadline/abort cleanup; `serial-queue.ts` owns ordering. `page-actions.ts`, `page-events.ts`, `page-checks.ts` (named evals in one round trip) and `page-controls.ts` (visible controls with their unique selectors) are Playwright adapters; `page-observation.ts` decides when controls are re-sent. `tools.ts` registers open, batch, eval, console, screenshot and scenarios; `compare-tools.ts` owns `frontend_compare`; `pixel-tools.ts` owns `frontend_pixels`, with exact RGBA comparison and the changed-region report in `pixel-diff.ts`. Schemas/settings, reporting and command handling are separate importable modules. `docs/shared-browser.md` records the shared-browser ownership and deployment contract.

## Verify

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run test:browser
```

Unit tests need no browser. The opt-in browser suite requires installed Brave and serves only an ephemeral loopback fixture. It tests actual rendering, PNG/JPEG capture, input clearing, selection by label, strict selectors, popups, HTTP/request diagnostics, cancellation, timeout and session isolation. It never accesses personal browsing data. Format only changed code files with the house oxfmt config; never format skills or persistent instructions.
