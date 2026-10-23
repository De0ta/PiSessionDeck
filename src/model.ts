import { posix, win32 } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export type Scope = "project" | "all";
export interface PreviewMessage { role: "user" | "assistant"; text: string }
export interface Preview { messages: PreviewMessage[]; note?: string }

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
  return safeText(session.name || session.firstMessage || "未命名会话");
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

export function activityTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "未知时间";
  const n = (value: number) => String(value).padStart(2, "0");
  return `${n(date.getMonth() + 1)}-${n(date.getDate())} ${n(date.getHours())}:${n(date.getMinutes())}`;
}
