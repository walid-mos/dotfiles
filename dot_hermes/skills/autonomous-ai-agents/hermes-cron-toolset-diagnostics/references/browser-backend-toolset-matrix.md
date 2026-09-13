# Browser backend and cron toolset matrix

This reference records a reusable diagnostic pattern for Hermes browser jobs.
It is intentionally about runtime resolution, not a permanent claim that any
browser backend is unavailable.

## Tool ownership

| Requested capability | Runtime toolset | Typical backend |
|---|---|---|
| `browser_exec` with `js()`, `page_info()`, `new_tab()`, and named Browser Use sessions | `browser-use` | Browser Use CLI |
| `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, etc. | `browser` | Built-in browser stack / Camofox / local Chromium |

The prompt's name is not enough: inspect the registry entry and its `toolset`
field in the installed Hermes source or consult the current documentation.

## Mutual backend behavior

Hermes' Browser Use CLI mode is a replacement surface. When it is selected,
the built-in browser requirement check returns false so the legacy
`browser_*` tools are not advertised. The Browser Use entry is separately
registered under `browser-use` and is gated by its own mode check.

This creates a common mismatch:

```yaml
platform_toolsets:
  cron:
    - browser
    - file
```

If Browser Use mode is active but `browser-use` is absent, the cron can expose
neither a usable legacy browser surface nor `browser_exec`. Fix the alignment:

- a job that explicitly requires `browser_exec` needs `browser-use` plus the
  minimum persistence toolset, normally `file`;
- a job written for `browser_*` needs the built-in backend selected explicitly
  and the `browser` toolset;
- after changing a toolset/backend, start a fresh cron session or restart the
  gateway so the tool schema is rebuilt.

## Cron precedence

Cron effective toolsets are resolved in this order:

1. non-empty per-job `enabled_toolsets`;
2. `platform_toolsets.cron` in the active profile;
3. Hermes' default set when lookup fails or no list is configured.

A job entry with `enabled_toolsets: null` inherits the global cron list. Check
this before assuming a job-specific setting exists.

## Verification checklist

1. Read the active profile's config and the job definition; do not use a
   pre-update snapshot as the current truth.
2. Confirm the requested tool is present in the run's actual tool inventory.
3. Run the task far enough to prove the browser/session and extraction work.
4. Verify all external writes and local artifacts by reading them back.
5. Treat a scheduler `last_status: ok` as process health only, not task
   acceptance.
6. If the collection step did not run, do not advance cursors such as
   `known_ids`/`last_run` or claim a no-change result.

## Security notes

Private X bookmarks require an authenticated session. Public web search is not
a substitute. Never copy authorization, cookies, CSRF tokens, or passwords into
reports, state files, or skill references; use the existing session/keychain
path and redact secrets.

## Source locations used for diagnosis

The implementation locations may move between Hermes releases; use them as
search anchors rather than hard-coded API contracts:

- `tools/browser_use_cli.py`: `browser_exec` registry entry and
  `is_browser_use_cli_mode()`;
- `tools/browser_tool.py`: `check_browser_requirements()` and its Browser Use
  mode gate;
- `cron/scheduler.py`: `_resolve_cron_enabled_toolsets()` and precedence;
- active `config.yaml`: `platform_toolsets.cron`;
- active `cron/jobs.json`: per-job `enabled_toolsets`.
