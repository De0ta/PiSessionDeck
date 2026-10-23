import { posix, win32 } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export type Scope = "project" | "all";
export const GROUP_MODES = ["project", "recent", "model", "status"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];
export interface SessionModel { provider: string; modelId: string }
export interface GroupingOptions {
  mode?: GroupMode;
  now?: number;
  modelFor?(session: SessionInfo): SessionModel | undefined;
  statusFor?(session: SessionInfo): string;
}
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
  const trimmed = normalized.length > root.length ? normalized.replace(platform === "win32" ? /[\\/]+$/ : /\/+$/, "") : normalized;
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

export type ListRow = { kind: "project"; cwd: string; count: number } | { kind: "group"; key: string; label: string; count: number }
  | { kind: "session"; session: SessionInfo } | { kind: "spacer" } | { kind: "more"; key: string; remaining: number };
export function rowKey(row: ListRow): string | undefined {
  return row.kind === "session" ? row.session.path : row.kind === "more" ? `more:${row.key}` : undefined;
}
const HOUR = 3_600_000;
const RECENT = [
  { end: 5 * HOUR, label: "Within 5 hours" }, { end: 24 * HOUR, label: "5 hours – 1 day" },
  { end: 7 * 24 * HOUR, label: "1 day – 1 week" }, { end: 30 * 24 * HOUR, label: "1 week – 1 month" },
  { end: 90 * 24 * HOUR, label: "1 month – 3 months" }, { end: Infinity, label: "Over 3 months" },
] as const;
export function sessionGroup(session: SessionInfo, options: GroupingOptions = {}): { key: string; label: string; order: number } {
  switch (options.mode) {
    case "recent": {
      const age = Math.max(0, (options.now ?? Date.now()) - session.modified.getTime());
      const index = RECENT.findIndex((bucket) => age < bucket.end);
      return { key: `recent:${index}`, label: RECENT[index]?.label ?? "Unknown time", order: index < 0 ? RECENT.length : index };
    }
    case "model": {
      const model = options.modelFor?.(session);
      return { key: `model:${model ? JSON.stringify([model.provider, model.modelId]) : "unknown"}`, label: model ? safeText(`${model.provider}/${model.modelId}`) : "Unknown model", order: 0 };
    }
    case "status": {
      const status = options.statusFor?.(session) ?? "Saved";
      return { key: `status:${status}`, label: safeText(status), order: 0 };
    }
    default: return { key: pathKey(session.cwd), label: session.cwd, order: 0 };
  }
}
/** Each nonempty group has spacing and five-at-a-time disclosure when limits are supplied. */
export function groupRows(sessions: readonly SessionInfo[], limits?: ReadonlyMap<string, number>, options: GroupingOptions = {}): ListRow[] {
  const groups = new Map<string, { key: string; label: string; order: number; sessions: SessionInfo[] }>();
  const fixed = { ...options, now: options.now ?? Date.now() };
  for (const session of sessions) {
    const info = sessionGroup(session, fixed);
    let group = groups.get(info.key);
    if (!group) { group = { ...info, sessions: [] }; groups.set(info.key, group); }
    group.sessions.push(session);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).flatMap((group, index): ListRow[] => {
    const limit = limits ? (limits.get(group.key) ?? 5) : group.sessions.length;
    return [
      ...(limits && index > 0 ? [{ kind: "spacer" } as const] : []),
      options.mode && options.mode !== "project" ? { kind: "group", key: group.key, label: group.label, count: group.sessions.length }
        : { kind: "project", cwd: group.label, count: group.sessions.length },
      ...group.sessions.slice(0, limit).map((session): ListRow => ({ kind: "session", session })),
      ...(group.sessions.length > limit ? [{ kind: "more", key: group.key, remaining: group.sessions.length - limit } as const] : []),
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
