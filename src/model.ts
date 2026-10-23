import { posix, win32 } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export type Scope = "project" | "all";
export interface PreviewMessage { role: "user" | "assistant"; text: string }
export interface TaskDetails {
  model?: string;
  reasoning?: string;
  prompt?: string;
  lastMessage?: string;
}
export interface Preview { messages: PreviewMessage[]; details?: TaskDetails; note?: string }

/** Session text is data, never terminal control sequences. */
export function safeText(text: string, multiline = false): string {
  const clean = stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/\t/g, "  ");
  return multiline ? clean : clean.replace(/\s+/g, " ").trim();
}

export function pathKey(path: string, platform = process.platform): string {
  if (!path) return "";
  const api = platform === "win32" ? win32 : posix;
  const normalized = api.resolve(path);
  const root = api.parse(normalized).root;
  const trimmed = normalized.length > root.length ? normalized.replace(/[\\/]+$/, "") : normalized;
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/** Extractive local title, deliberately no provider call or synthetic summary. */
export function summarizeTitle(prompt: string): string {
  const stripped = safeText(prompt, true).replace(/<([a-z_][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/```[\s\S]*?```/g, "");
  const first = stripped.split(/\n|[。！？!?]/).map((line) => line.replace(/^\s*[#>*-]+\s*/, "").trim()).find(Boolean) ?? "Untitled task";
  const characters = Array.from(first);
  return characters.slice(0, 42).join("") + (characters.length > 42 ? "…" : "");
}
export function sessionTitle(session: SessionInfo): string {
  return safeText(session.name || summarizeTitle(session.firstMessage || "Untitled task"));
}

export function filterSessions(sessions: readonly SessionInfo[], query: string, scope: Scope, cwd: string): SessionInfo[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    if (scope === "project" && pathKey(session.cwd) !== pathKey(cwd)) return false;
    const haystack = `${session.name ?? ""}\n${session.cwd}\n${session.id}\n${session.allMessagesText}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  }).sort((a, b) => b.modified.getTime() - a.modified.getTime() || a.path.localeCompare(b.path));
}

export type ListRow = { kind: "project"; cwd: string; count: number } | { kind: "session"; session: SessionInfo } | { kind: "spacer" } | { kind: "more"; cwd: string; remaining: number };
export function rowKey(row: ListRow): string | undefined {
  return row.kind === "session" ? row.session.path : row.kind === "more" ? `more:${pathKey(row.cwd)}` : undefined;
}
/** Passing limits enables project spacing and five-at-a-time disclosure. */
export function groupRows(sessions: readonly SessionInfo[], limits?: ReadonlyMap<string, number>): ListRow[] {
  const groups = new Map<string, { cwd: string; sessions: SessionInfo[] }>();
  for (const session of sessions) {
    const key = pathKey(session.cwd);
    let group = groups.get(key);
    if (!group) { group = { cwd: session.cwd, sessions: [] }; groups.set(key, group); }
    group.sessions.push(session);
  }
  return [...groups.values()].flatMap((group, index): ListRow[] => {
    const limit = limits ? (limits.get(pathKey(group.cwd)) ?? 5) : group.sessions.length;
    return [
      ...(limits && index > 0 ? [{ kind: "spacer" } as const] : []),
      { kind: "project", cwd: group.cwd, count: group.sessions.length },
      ...group.sessions.slice(0, limit).map((session): ListRow => ({ kind: "session", session })),
      ...(group.sessions.length > limit ? [{ kind: "more", cwd: group.cwd, remaining: group.sessions.length - limit } as const] : []),
    ];
  });
}

export function mergeSessions(...groups: readonly SessionInfo[][]): SessionInfo[] {
  const unique = new Map<string, SessionInfo>();
  for (const group of groups) for (const session of group) unique.set(pathKey(session.path), session);
  return [...unique.values()];
}

export function activityTime(date: Date, now = Date.now()): string {
  if (!Number.isFinite(date.getTime())) return "Unknown";
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export const SESSION_COLORS = ["#79c9da", "#d8a0b5", "#a7d58e", "#acb9ec", "#dbbd82", "#c3a2df", "#8dcbb7", "#e49e94"] as const;
/** Identity colors must not change with selection, sort order, or refresh. */
export function sessionColor(id: string): (typeof SESSION_COLORS)[number] {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return SESSION_COLORS[(hash >>> 0) % SESSION_COLORS.length]!;
}
