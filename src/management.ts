import { randomUUID } from "node:crypto";
import { constants, lstatSync, unlinkSync, type BigIntStats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { pathKey, safeText, sessionTitle } from "./model.js";

const MAX_SNAPSHOT = 16 * 1024 * 1024;
const MAX_HEADER = 1024 * 1024;
declare const revisionBrand: unique symbol;
/** Process-local capability; callers cannot construct or mutate a revision. */
export interface SessionRevision { readonly [revisionBrand]: true }
interface Identity { path: string; id: string; cwd: string; header: string; stat: BigIntStats }
const revisions = new WeakMap<SessionRevision, Identity>();
type RecordData = Record<string, unknown>;
function object(value: unknown): value is RecordData {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(message: string): never { throw new Error(`Session management: ${message}`); }
function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function regular(stat: BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink()) fail("expected a regular, non-symbolic-link file");
}
function decode(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function headerFrom(line: string, session: SessionInfo): RecordData {
  let header: unknown;
  try { header = JSON.parse(line); } catch { return fail("invalid session header"); }
  if (!object(header) || header.type !== "session" || typeof header.id !== "string" || !header.id ||
      (header.cwd !== undefined && typeof header.cwd !== "string") || typeof header.timestamp !== "string" || !Number.isFinite(Date.parse(header.timestamp))) {
    fail("invalid session header");
  }
  if (header.version !== undefined && ![1, 2, 3].includes(header.version as number)) fail("unsupported session version");
  if (header.id !== session.id || pathKey(typeof header.cwd === "string" ? header.cwd : "") !== pathKey(session.cwd)) fail("session identity changed (id/cwd)");
  return header;
}

/** Bounded read through one descriptor, with path and descriptor checks on both sides. Never repairs JSONL. */
async function snapshot(session: SessionInfo, signal: AbortSignal, full: boolean): Promise<{ identity: Identity; text: string; header: RecordData }> {
  signal.throwIfAborted();
  const path = resolve(session.path);
  const before = await lstat(path, { bigint: true });
  regular(before);
  if (full && before.size > BigInt(MAX_SNAPSHOT)) fail("Fork exceeds the 16 MiB snapshot limit");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat({ bigint: true });
    regular(stat);
    if (!same(before, stat)) fail("file changed while opening");
    const limit = full ? MAX_SNAPSHOT : MAX_HEADER;
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    while (!done && length <= limit) {
      signal.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, length);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newline = full ? -1 : chunk.indexOf(10);
      const part = newline < 0 ? chunk : chunk.subarray(0, newline);
      chunks.push(part);
      length += part.length;
      done = newline >= 0;
    }
    if (length > limit) fail(full ? "Fork exceeds the 16 MiB snapshot limit" : "session header exceeds 1 MiB");
    const text = decode(Buffer.concat(chunks));
    const line = text.split("\n", 1)[0]!;
    const header = headerFrom(line, session);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    regular(pathAfter);
    if (!same(stat, after) || !same(stat, pathAfter)) fail("file changed during read");
    signal.throwIfAborted();
    return { identity: { path, id: session.id, cwd: pathKey(session.cwd), header: line, stat }, text, header };
  } finally { await handle.close(); }
}

export async function captureSessionRevision(session: SessionInfo, signal: AbortSignal): Promise<SessionRevision> {
  const { identity } = await snapshot(session, signal, false);
  const token = Object.freeze({}) as SessionRevision;
  revisions.set(token, identity);
  return token;
}

export async function deleteSession(session: SessionInfo, revision: SessionRevision, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const expected = revisions.get(revision);
  if (!expected || expected.path !== resolve(session.path) || expected.id !== session.id || expected.cwd !== pathKey(session.cwd)) fail("revision does not belong to this session");
  const { identity } = await snapshot(session, signal, false);
  if (!same(expected.stat, identity.stat) || expected.header !== identity.header) fail("revision changed; select the session again");
  signal.throwIfAborted();
  const last = lstatSync(expected.path, { bigint: true });
  regular(last);
  if (!same(expected.stat, last)) fail("revision changed before deletion");
  // No portable Node API atomically compares an inode and unlinks its pathname.
  // These checks do not provide a cross-process lock: a hostile writer/rename can
  // still race the final check and unlink (including replacement of ancestor dirs).
  // Only this directory entry is removed; never recurse or touch project files.
  unlinkSync(expected.path);
}

interface Entry extends RecordData { type: string; id: string; parentId: string | null; timestamp: string }
function string(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function content(value: unknown): boolean {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((block: unknown) => {
    if (!object(block)) return false;
    switch (block.type) {
      case "text": return typeof block.text === "string";
      case "thinking": return typeof block.thinking === "string";
      case "image": return typeof block.data === "string" && typeof block.mimeType === "string";
      case "toolCall": return string(block.id) && string(block.name) && object(block.arguments);
      default: return false;
    }
  });
}

function history(text: string, header: RecordData): { entries: Entry[]; latestTitle: RecordData | undefined } {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const raw: RecordData[] = lines.slice(1).map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return fail(`invalid JSONL at line ${index + 2}`); }
    if (!object(value) || value.type === "session") fail(`invalid entry at line ${index + 2}`);
    return value;
  });
  const version = header.version === undefined ? 1 : header.version;
  if (version !== 1 && version !== 2 && version !== 3) fail("unsupported session version");
  if (version === 1) {
    // Migrate only our private snapshot. Indexes in v1 include the header.
    const ids = raw.map(() => randomUUID());
    raw.forEach((entry, index) => {
      entry.id = ids[index];
      entry.parentId = index ? ids[index - 1] : null;
      if (entry.type === "compaction") {
        const kept = entry.firstKeptEntryIndex;
        if (!Number.isInteger(kept) || typeof kept !== "number" || kept < 1 || kept > index + 1) fail("invalid legacy compaction index");
        entry.firstKeptEntryId = ids[kept - 1];
        delete entry.firstKeptEntryIndex;
      }
    });
  }
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  const children = new Map<string | null, Entry[]>();
  for (const value of raw) {
    if (!string(value.type) || !string(value.id) || typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp)) ||
        (value.parentId !== null && !string(value.parentId))) fail("invalid entry identity/timestamp/parentId");
    const entry = value as Entry;
    // Append-only trees must refer backwards: also rules out every parent cycle.
    if (byId.has(entry.id) || (entry.parentId !== null && !byId.has(entry.parentId))) fail("duplicate id or invalid parent chain/cycle");
    if (entry.type === "message" && object(entry.message) && version < 3 && entry.message.role === "hookMessage") entry.message.role = "custom";
    validatePayload(entry);
    byId.set(entry.id, entry);
    entries.push(entry);
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  // Euler intervals allow all ancestry checks in O(n), not getBranch() per entry.
  const start = new Map<string, number>();
  const end = new Map<string, number>();
  let clock = 0;
  const stack: { entry: Entry; exit: boolean }[] = (children.get(null) ?? []).map((entry) => ({ entry, exit: false }));
  while (stack.length) {
    const { entry, exit } = stack.pop()!;
    if (exit) { end.set(entry.id, clock++); continue; }
    start.set(entry.id, clock++);
    stack.push({ entry, exit: true });
    for (const child of children.get(entry.id) ?? []) stack.push({ entry: child, exit: false });
  }
  const ancestor = (target: string, entry: Entry) => start.get(target)! < start.get(entry.id)! && end.get(target)! > end.get(entry.id)!;
  const position = new Map(entries.map((entry, index) => [entry.id, index]));
  for (const entry of entries) {
    for (const ref of references(entry)) {
      if (!byId.has(ref)) fail(`missing reference ${ref}`);
      if (!(entry.type === "compaction" && ref === entry.id) && position.get(ref)! >= position.get(entry.id)!) fail("reference must point to an earlier entry");
    }
    if (entry.type === "context_edit") {
      const target = byId.get(entry.targetId as string)!;
      if (!ancestor(target.id, entry) || !(target.type === "custom_message" || (target.type === "message" && object(target.message) && ["user", "assistant", "toolResult"].includes(String(target.message.role))))) fail("context edit target is not editable on its branch");
    }
    if (entry.type === "compaction" && entry.firstKeptEntryId !== entry.id && !ancestor(entry.firstKeptEntryId as string, entry)) fail("compaction reference is not on its branch");
  }
  const leaf = entries.at(-1);
  if (!leaf) fail("Cannot Fork an empty session: no conversation history");
  // Keep the active path AND the transitive closure of native references. A
  // branch summary may reference an abandoned branch; retain that dependency,
  // not every historical tree. Keep original ordering and original entry IDs.
  const retained = new Set<string>();
  const pending = [leaf.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (retained.has(id)) continue;
    retained.add(id);
    const entry = byId.get(id)!;
    if (entry.parentId !== null) pending.push(entry.parentId);
    pending.push(...references(entry));
  }
  const latestTitle = [...entries].reverse().find((entry) => entry.type === "session_info");
  const result = entries.filter((entry) => retained.has(entry.id));
  if (!result.some((entry) => entry.type === "message" && object(entry.message) && ["user", "assistant"].includes(String(entry.message.role)))) fail("Cannot Fork an empty session: no conversation history");
  return { entries: result, latestTitle };
}

function references(entry: Entry): string[] {
  const refs: string[] = [];
  if (entry.type === "context_edit" || entry.type === "label") refs.push(entry.targetId as string);
  if (entry.type === "compaction") refs.push(entry.firstKeptEntryId as string);
  if (entry.type === "branch_summary" && entry.fromId !== "root") refs.push(entry.fromId as string);
  if (entry.type === "message" && object(entry.message) && entry.message.role === "branchSummary" && entry.message.fromId !== null && entry.message.fromId !== "root") refs.push(entry.message.fromId as string);
  return refs;
}
function validateSystemMessage(message: RecordData): void {
  if (!(typeof message.content === "string" || (Array.isArray(message.content) && message.content.every((block: unknown) => object(block) && block.type === "text" && typeof block.text === "string")))) fail("invalid system message content");
  if (message.sections !== undefined && (!object(message.sections) || !Object.values(message.sections).every((value) => value === null || typeof value === "string"))) fail("invalid system sections");
  if (message.toolsAdded !== undefined && (!Array.isArray(message.toolsAdded) || !message.toolsAdded.every((tool: unknown) => object(tool) && string(tool.name) && typeof tool.description === "string" && object(tool.parameters)))) fail("invalid system toolsAdded");
  if (message.toolsRemoved !== undefined && (!Array.isArray(message.toolsRemoved) || !message.toolsRemoved.every((tool: unknown) => object(tool) && string(tool.name)))) fail("invalid system toolsRemoved");
}
function validatePayload(entry: Entry): void {
  const required = (...keys: string[]) => { for (const key of keys) if (typeof entry[key] !== "string") fail(`invalid ${entry.type}.${key}`); };
  switch (entry.type) {
    case "message":
      if (!object(entry.message) || !string(entry.message.role)) fail("invalid message");
      if (["user", "assistant", "toolResult", "custom"].includes(entry.message.role)) {
        if (!content(entry.message.content)) fail("invalid message content");
      } else if (entry.message.role === "system") {
        validateSystemMessage(entry.message);
      } else if (entry.message.role === "bashExecution") {
        if (typeof entry.message.command !== "string" || typeof entry.message.output !== "string") fail("invalid bash execution");
      } else if (["branchSummary", "compactionSummary"].includes(entry.message.role)) {
        if (typeof entry.message.summary !== "string") fail("invalid summary message");
        if (entry.message.role === "branchSummary" && entry.message.fromId !== null && !string(entry.message.fromId)) fail("invalid summary fromId");
      } else fail(`unsupported message role ${entry.message.role}`);
      break;
    case "model_change": required("provider", "modelId"); break;
    case "thinking_level_change": required("thinkingLevel"); break;
    case "compaction":
      required("summary", "firstKeptEntryId");
      if (typeof entry.tokensBefore !== "number" || !Number.isFinite(entry.tokensBefore)) fail("invalid compaction tokensBefore");
      if (entry.systemMessage !== undefined) {
        if (!object(entry.systemMessage) || entry.systemMessage.role !== "system") fail("invalid compaction systemMessage");
        validateSystemMessage(entry.systemMessage);
      }
      break;
    case "branch_summary": required("summary", "fromId"); break;
    case "context_edit":
      required("targetId");
      if (entry.replacement !== null && (!object(entry.replacement) || !content(entry.replacement.content))) fail("invalid context edit replacement");
      break;
    case "label": required("targetId"); if (entry.label !== undefined) required("label"); break;
    case "session_info": if (entry.name !== undefined) required("name"); break;
    case "custom": required("customType"); break;
    case "custom_message": required("customType"); if (!content(entry.content) || typeof entry.display !== "boolean") fail("invalid custom message"); break;
    case "usage": required("kind", "provider", "model"); if (!object(entry.usage)) fail("invalid usage"); break;
    default: fail(`unsupported entry type ${entry.type}; cannot safely preserve unknown references`);
  }
}

export async function forkHistorySession(session: SessionInfo, signal: AbortSignal, titleOverride?: string): Promise<SessionInfo> {
  const { identity, text, header } = await snapshot(session, signal, true);
  if (!header.cwd) fail("source working directory is unknown; cannot safely Fork");
  const { entries, latestTitle } = history(text, header);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const titleSession = titleOverride ? { ...session, name: titleOverride } : latestTitle ? { ...session, name: latestTitle.name as string | undefined } : session;
  const name = `${Array.from(safeText(sessionTitle(titleSession))).slice(0, 120).join("")} · Fork`;
  const newHeader = { ...header, type: "session", version: 3, id, timestamp, parentSession: identity.path };
  const info = { type: "session_info", id: randomUUID(), parentId: entries.at(-1)!.id, timestamp, name };
  const output = [newHeader, ...entries, info].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  const path = join(dirname(identity.path), `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  const messages = entries.filter((entry) => entry.type === "message");
  const messageText = (entry: Entry): string => {
    const message = entry.message as RecordData;
    if (typeof message.content === "string") return message.content;
    return Array.isArray(message.content) ? message.content.filter((block): block is RecordData => object(block) && block.type === "text" && typeof block.text === "string").map((block) => block.text).join(" ") : "";
  };
  const conversation = messages.filter((entry) => ["user", "assistant"].includes(String((entry.message as RecordData).role)));
  const result: SessionInfo & { parentSessionFile: string } = {
    path, id, cwd: session.cwd, name, parentSessionPath: identity.path, parentSessionFile: identity.path,
    created: new Date(timestamp), modified: new Date(timestamp), messageCount: messages.length,
    firstMessage: messageText(conversation.find((entry) => (entry.message as RecordData).role === "user") ?? conversation[0]!),
    allMessagesText: conversation.map(messageText).filter(Boolean).join(" "),
  };
  signal.throwIfAborted();
  const handle = await open(path, "wx", 0o600);
  try {
    // Check once more after the asynchronous open, before writing any bytes.
    signal.throwIfAborted();
    // Once writing starts, finish or clean up regardless of later cancellation.
    // Never report an abort after successful creation and hide an orphan.
    await handle.writeFile(output, "utf8");
    await handle.sync();
    await handle.close();
  } catch (error) {
    try { await handle.close(); } finally { await unlink(path); }
    throw error;
  }
  return result;
}
