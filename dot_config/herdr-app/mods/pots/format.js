export function clock(at) {
  if (!at) return "";
  const d = new Date(at);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

export function firstLine(text, max = 140) {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const tint = (color, alphaHex) => `${color.slice(0, 7)}${alphaHex}`;

export const initial = (name) => (name.trim()[0] ?? "?").toUpperCase();

export const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
