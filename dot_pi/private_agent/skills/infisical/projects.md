# Projects and environments through the REST API

Extends "Rules" in `SKILL.md`; the core rules are not restated here.

Base URL `https://app.infisical.com/api` (US cloud; the CLI's `--domain` tells otherwise). Field names verified against the OpenAPI document at `/api/docs/json` on 2026-10-24.

```sh
TOKEN=$(infisical user get token | sed -n 's/^[Tt]oken:[[:space:]]*//p')
H="Authorization: Bearer $TOKEN"; J='Content-Type: application/json'; API=https://app.infisical.com/api

# 1. Create the project without default environments. The response holds the project id.
curl -sS -X POST -H "$H" -H "$J" "$API/v2/workspace" \
  -d '{"projectName":"<name>","type":"secret-manager","shouldCreateDefaultEnvs":false}'

# 2. Add each environment wanted, in order.
curl -sS -X POST -H "$H" -H "$J" "$API/v1/workspace/<projectId>/environments" -d '{"name":"main","slug":"main"}'

# 3. Inspect: environments with their ids.
curl -sS -H "$H" "$API/v1/workspace/<projectId>" | python3 -c 'import json,sys; [print(e["id"],e["slug"],e["name"]) for e in json.load(sys.stdin)["workspace"]["environments"]]'

# Rename or delete an environment (reread it in step 3 first).
curl -sS -X PATCH  -H "$H" -H "$J" "$API/v1/workspace/<projectId>/environments/<envId>" -d '{"name":"main","slug":"main"}'
curl -sS -X DELETE -H "$H" "$API/v1/workspace/<projectId>/environments/<envId>"
```

Then let the machine identity in if the MCP must read or write that project's secrets: add it from the dashboard (Project → Access Control → Machine Identities) with the lowest role that fits. The MCP cannot add itself.

Secret writes stay on the CLI:

```sh
read -rs 'VALUE?Value: ' && echo
infisical secrets set <KEY>="$VALUE" --env=<slug> --projectId=<projectId>
unset VALUE
infisical secrets get <KEY> --env=<slug> --projectId=<projectId> --plain | cut -c1-6
```
