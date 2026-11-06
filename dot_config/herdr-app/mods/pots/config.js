export const HOST = "mac-studio";

export const PANE = { id: "pots", railPx: 44, defaultPx: 400 };

export const DOCKER = { context: "colima-pots", user: "abc", home: "/config", sessionLabel: "sealskin.app/session" };

export const MANAGER = { container: "sealskin-pots", helper: "/opt/pots-manage.py" };

export const MAC = {
  potsApp: "Applications/Pots.app/Contents/Resources",
  vaultBinding: ".config/agent-secrets/core-vault.json",
  jobs: "Library/Caches/herdr-pots",
};

export const CHAT = {
  place: "dm-abc",
  historyBytes: 262144,
  timeoutSeconds: 600,
  pollMs: 2000,
  rediscoverEveryPolls: 10,
  pendingTtlMs: 120000,
};

export const STAGE = { stack: "stage", chat: "pot-chat", terminals: "main" };

export const SHARED = { chat: "pots.chat", seen: "pots.seen", pending: "pots.pending", workspaces: "pots.workspaces", collapsed: "pots.collapsed", width: "pots.width" };

export const HUES = ["accent", "ansi5", "ansi2", "ansi3", "ansi6", "ansi4"];

export const HOME_NAME_MAX_LENGTH = 40;

export const botKey = (home, botId) => `${home}/${botId}`;
