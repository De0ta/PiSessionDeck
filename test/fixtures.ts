import type { SessionInfo } from "@earendil-works/pi-coding-agent";
export const cwd = process.platform === "win32" ? "C:/projects/alpha" : "/projects/alpha";
export function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id, path: `${cwd}/${id}.jsonl`, cwd, created: new Date("2026-01-01T00:00:00Z"),
    modified: new Date("2026-01-02T00:00:00Z"), firstMessage: `会话 ${id}`,
    messageCount: 2, allMessagesText: `会话 ${id}\n答复`, ...overrides,
  };
}
export const header = { type: "session", version: 3, id: "fixture-session", cwd, timestamp: "2026-01-01T00:00:00Z" };
export function user(id: string, parentId: string | null, text: string) {
  return { type: "message", id, parentId, timestamp: header.timestamp, message: { role: "user", content: text, timestamp: 1767225600000 } };
}
export function jsonl(...entries: unknown[]): string { return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"; }
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
