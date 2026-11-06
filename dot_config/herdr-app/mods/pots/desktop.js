import { CHAT, DOCKER } from "./config.js";
import { dockerArgs, execArgs, runDocker } from "./docker.js";

const PROBE = `
H=$1; B=$2; N=$3
printf '@@gateway\\n'
pid=; IFS= read -r pid < "$H/.pots/gateway.pid" 2>/dev/null || :
case $pid in ''|*[!0-9]*) g=down;; *) if kill -0 "$pid" 2>/dev/null; then g=up; else g=down; fi;; esac
a="$H/.pots/bots/AGENTS.md"
if [ "$g" = down ] && [ -e "$a" ] && ! cmp -s /usr/local/share/pots/bot-instructions.md "$a"; then g=blocked; fi
echo "$g"
printf '@@config\\n'
if [ -s "$H/.pi/agent/auth.json" ] && grep -q '"defaultModel"' "$H/.pi/agent/settings.json" 2>/dev/null && [ -s "$H/.config/pots/vault.env" ]; then echo configured; else echo unconfigured; fi
printf '@@bots\\n'
for d in "$H"/.pots/bots/*/; do
  [ -d "$d" ] || continue
  i=$(basename "$d")
  s=$(curl -s --max-time 1 --unix-socket "$d/control.sock" http://localhost/status 2>/dev/null)
  if [ -z "$s" ]; then s=$(tr -d '\\n' < "$d/bot.json" 2>/dev/null); fi
  l=$(tail -n 1 -- "$d/terminal/platform.jsonl" 2>/dev/null)
  printf '%s\\t%s\\t%s\\n' "$i" "$s" "$l"
done
printf '@@history\\n'
f="$H/.pots/bots/$B/terminal/platform.jsonl"
if [ -n "$B" ] && [ -f "$f" ]; then tail -c "$N" -- "$f"; fi
`;

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function parseBot(line) {
  const [id, state, last] = line.split("\t");
  const status = parseJson(state ?? "");
  const isLive = Boolean(status?.result);
  const info = isLive ? status.result : status ?? {};
  const lastEvent = parseJson(last ?? "");
  const isShown = lastEvent && lastEvent.place === CHAT.place && lastEvent.type !== "delete";
  return { id, name: info.name || id, model: info.model || "", isBusy: isLive && Boolean(info.busy), isLive, last: isShown ? lastEvent : null };
}

function applyEvent(byId, event) {
  if (!event || event.place !== CHAT.place) return;
  const id = event.message ?? event.id;
  if (typeof id !== "string") return;
  if (event.type === "delete") { byId.delete(id); return; }
  if ((event.type !== "message" && event.type !== "edit") || typeof event.text !== "string") return;
  const prior = byId.get(id);
  byId.set(id, { id, text: event.text, role: event.person === "bot" ? "bot" : "me", at: prior?.at ?? event.at ?? 0, isEdited: Boolean(prior) || event.type === "edit" });
}

function decodeHistory(text, isTruncated) {
  const lines = text.split("\n").filter(Boolean);
  if (isTruncated) lines.shift();
  const byId = new Map();
  for (const line of lines) applyEvent(byId, parseJson(line));
  return [...byId.values()];
}

/** Sealskin session id -> short container id, for every running desktop. */
export async function runningDesktops() {
  const format = `{{.Label "${DOCKER.sessionLabel}"}}\t{{.ID}}`;
  const out = await runDocker(dockerArgs(["ps", "--filter", `label=${DOCKER.sessionLabel}`, "--format", format]), "Docker is unreachable");
  return new Map(out.split("\n").filter(Boolean).map((line) => line.split("\t")));
}

export async function probeDesktop(container, botId) {
  const command = ["sh", "-c", PROBE, "pots-probe", DOCKER.home, botId ?? "", String(CHAT.historyBytes + 1)];
  const out = await runDocker(execArgs(container, false, command), "The Pots desktop did not answer");
  const parts = out.split(/^@@(gateway|config|bots|history)\n/m);
  const section = (name) => { const i = parts.indexOf(name); return i >= 0 ? parts[i + 1] ?? "" : ""; };
  const history = section("history");
  const gateway = section("gateway").trim();
  return {
    isGatewayUp: gateway === "up",
    isBlocked: gateway === "blocked",
    isConfigured: section("config").trim() === "configured",
    bots: section("bots").split("\n").filter(Boolean).map(parseBot),
    messages: botId ? decodeHistory(history, history.length > CHAT.historyBytes) : [],
  };
}

/** The model provisioning gave this desktop, as pi names it: "provider/modelId". */
export async function desktopDefaultModel(container) {
  const command = ["sh", "-c", 'cat "$HOME/.pi/agent/settings.json"'];
  const settings = JSON.parse(await runDocker(execArgs(container, false, command), "The desktop has no pi settings"));
  const { defaultProvider, defaultModel } = settings ?? {};
  if (!defaultProvider || !defaultModel) throw new Error("The desktop has no default model yet: wait for its setup to finish");
  return `${defaultProvider}/${defaultModel}`;
}

export function startChat(container, botId, text) {
  const command = ["pots", "chat", "--bot", botId, `--message=${text}`, "--timeout", String(CHAT.timeoutSeconds)];
  return runDocker(execArgs(container, true, command), "pots chat could not start");
}

export function createBot(container, { name, model, about }) {
  const command = ["pots", "bot", "new", ...(model ? ["--model", model] : []), ...(about ? ["--about", about] : []), name];
  return runDocker(execArgs(container, false, command), "pots bot new failed");
}
