# Chrome Agent Maintenance (X bookmark curation)

Validated setup (2026-08-27) and repair recipes for the dedicated agent Chrome instance that scheduled bookmark runs depend on. All commands were executed successfully in the session that produced them.

## Architecture

- **Instance Chrome dédiée** : copie snapshot du profil Chrome de Walid (logins X inclus), user-data-dir `~/Library/Application Support/Google/Chrome-Agent` (~10 Mo, caches exclus).
- **CDP port 9223** (9222 est occupé par le Chrome live de Walid).
- **LaunchAgent** `com.walid.chrome-agent` (`~/Library/LaunchAgents/com.walid.chrome-agent.plist`), `RunAtLoad=false` + `KeepAlive=false` depuis le 2026-09-01 ; **`--headless=new` + `ProcessType=Background` depuis le 2026-09-03** (le Chrome visible volait le focus à chaque kickstart cron — headless validé de bout en bout : CDP, session X, tweets OK, plus aucune fenêtre). Le job reste enregistré dans launchd → démarrage à la demande via `launchctl kickstart gui/$(id -u)/com.walid.chrome-agent` (validé). Le cron Bookmarks Curator (ÉTAPE 0 de son prompt) sonde `curl http://127.0.0.1:9223/json/version` et kickstart si KO. Ne PAS restaurer RunAtLoad/KeepAlive.
- **Hermes config** : `browser.cdp_url: http://127.0.0.1:9223`.
- Le Chrome **live** de Walid (port 9222) ne doit jamais être attaché en cron : macOS affiche la feuille de consentement "Autoriser le débogage à distance" à chaque attach d'un Chrome lancé normalement — bloquant en mode non-attendu.
- Contrainte environnement : le navigateur par défaut macOS est **Safari**, donc `browser.use_real_profile: true` échoue ("default browser is not a supported Chromium"). L'instance dédiée ci-dessus est la solution — ne pas réactiver use_real_profile.

## Diagnostic checklist (run failed / browser tool missing)

1. `hermes config get browser.cdp_url` → doit valoir `http://127.0.0.1:9223`
2. `curl -s http://127.0.0.1:9223/json/version` → doit répondre (Browser: Chrome/…)
3. `launchctl list | grep chrome-agent` → PID + exit code 0
4. Le job cron doit avoir `enabled_toolsets: ["browser", "file", "terminal"]` — vérifier via `cronjob(action='list')`. Le nom `browser-use` est invalide (allowlist stricte = outils silencieusement retirés).
5. Si tout est vert : sonde one-shot cron (voir plus bas) avant de conclure.

## Validate X login state (in the agent instance)

```bash
curl -s http://127.0.0.1:9223/json | python3 -c "import sys,json; [print(t['url']) for t in json.load(sys.stdin) if t['type']=='page']"
```

L'instance démarre sur `https://x.com`. Page attendue : `x.com/home` (connecté). Vérification fine en browser_exec :

```python
new_tab('https://x.com/home')
import time; time.sleep(3)
js("(() => ({logged_in: !!document.querySelector('a[data-testid=\"AppTabBar_Profile_Link\"]'), n_tweets: document.querySelectorAll('article[data-testid=\"tweet\"]').length}))()")
```

## Re-sync cookies when X logs out of the agent instance

The snapshot's cookies are static; X sessions eventually expire in the copy while the live Chrome stays logged in. Re-sync the auth files (Cookies DB + Local State, which carries the crypto key material binding):

```bash
SRC="$HOME/Library/Application Support/Google/Chrome"
DST="$HOME/Library/Application Support/Google/Chrome-Agent"
# Chrome live MUST be fully quit for a consistent Cookies DB copy (or accept risk of partial cookies)
rsync -a "$SRC/Default/Cookies" "$SRC/Default/Cookies-journal" "$DST/Default/"
rsync -a "$SRC/Local State" "$DST/"
launchctl kickstart -k gui/$(id -u)/com.walid.chrome-agent
```

Full rebuild of the snapshot (first install or corrupted copy):

```bash
DST="$HOME/Library/Application Support/Google/Chrome-Agent"
launchctl unload ~/Library/LaunchAgents/com.walid.chrome-agent.plist
rm -rf "$DST"
mkdir -p "$DST/Default"
rsync -a --exclude 'Cache*' --exclude 'Code Cache' --exclude 'Service Worker' \
  --exclude 'GPUCache' --exclude 'GrShaderCache' --exclude 'ShaderCache' \
  --exclude 'Crashpad' --exclude 'Singleton*' --exclude 'Media Cache' \
  --exclude 'DawnCache' --exclude 'component_crx_cache' --exclude 'extensions_crx_cache' \
  --exclude 'OptimizationGuide*' --exclude 'Safe Browsing*' \
  "$HOME/Library/Application Support/Google/Chrome/Default/" "$DST/Default/"
rsync -a "$HOME/Library/Application Support/Google/Chrome/Local State" "$DST/"
launchctl load ~/Library/LaunchAgents/com.walid.chrome-agent.plist
```

## LaunchAgent plist (known-good content)

`~/Library/LaunchAgents/com.walid.chrome-agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.walid.chrome-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
        <string>--headless=new</string>
        <string>--user-data-dir=/Users/walid-mos/Library/Application Support/Google/Chrome-Agent</string>
        <string>--remote-debugging-port=9223</string>
        <string>--no-first-run</string>
        <string>--no-default-browser-check</string>
        <string>https://x.com</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
```

(Note 2026-09-03 : headless + Background — plus de fenêtre ni de focus volé ; CDP et logins inchangés. Note 2026-09-01 : RunAtLoad/KeepAlive passés à false à la demande de Walid — cf. section Architecture. Le plist known-good ci-dessus reflète cet état.)

Reload after editing: `launchctl unload <plist> && launchctl load <plist>` (kill any stray `Chrome-Agent` process first).

## Health probe pattern (cron conditions)

One-shot cron job (delete after run) pinning `enabled_toolsets: ["browser", "file", "terminal"]`, prompt reduced to a single `browser_exec` call:

```python
new_tab('https://x.com/home')
import time; time.sleep(3)
info = page_info()
print('INFO:', info)
js("(() => { const arts = document.querySelectorAll('article[data-testid=\"tweet\"]'); return {n_tweets: arts.length, logged_in: !!document.querySelector('a[data-testid=\"AppTabBar_Profile_Link\"]')}; })()")
```

Validated result format: `CDP OK — page=x.com/home, connecté=oui, N tweets visibles`.

## Optional: guaranteed wake for the 06:00 run

`sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00` (needs user sudo). As of 2026-08-27 the Mac effectively never sleeps at night (Studio Display/audio assertions), so this is hardening, not a fix.

## Cron failure post-mortem (2026-08-27, kept for pattern recognition)

The 06:00 scheduled run failed with "browser_exec n'est pas disponible dans cet environnement cron" while `last_status` showed "ok". Root cause: `enabled_toolsets: ["browser-use", ...]` — an invalid toolset name in the strict allowlist silently removed the browser tools. Note that runs launched from the desktop session (manual re-run) succeeded because they carry the full toolset — a manual success does NOT validate the cron path. Always verify with a real one-shot cron probe after changing toolset pins.
