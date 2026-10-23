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

export function sessionTitle(session: SessionInfo): string {
  return safeText(session.name || session.firstMessage || "Untitled task");
}

export function filterSessions(sessions: readonly SessionInfo[], query: string, scope: Scope, cwd: string): SessionInfo[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    if (scope === "project" && pathKey(session.cwd) !== pathKey(cwd)) return false;
    const haystack = `${session.name ?? ""}\n${session.cwd}\n${session.id}\n${session.allMessagesText}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  }).sort((a, b) => b.modified.getTime() - a.modified.getTime() || a.path.localeCompare(b.path));
}

export type ListRow = { kind: "project"; cwd: string } | { kind: "session"; session: SessionInfo };
export function groupRows(sessions: readonly SessionInfo[]): ListRow[] {
  const groups = new Map<string, { cwd: string; sessions: SessionInfo[] }>();
  for (const session of sessions) {
    const key = pathKey(session.cwd);
    let group = groups.get(key);
    if (!group) { group = { cwd: session.cwd, sessions: [] }; groups.set(key, group); }
    group.sessions.push(session);
  }
  return [...groups.values()].flatMap((group): ListRow[] => [
    { kind: "project", cwd: group.cwd },
    ...group.sessions.map((session): ListRow => ({ kind: "session", session })),
  ]);
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
