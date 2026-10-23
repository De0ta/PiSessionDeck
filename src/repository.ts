import { open, stat } from "node:fs/promises";
import {
  parseSessionEntries, SessionManager,
  type ExtensionContext, type FileEntry, type SessionInfo, type SessionProjection,
} from "@earendil-works/pi-coding-agent";
import { mergeSessions, pathKey, safeText, type Preview, type Scope, type SessionModel, type TaskDetails } from "./model.ts";
import { createTitleStore, type TitleStore } from "./titles.ts";

export interface SessionRepository {
  list(scope: Scope, signal: AbortSignal): Promise<SessionInfo[]>;
  preview(session: SessionInfo, signal: AbortSignal): Promise<Preview>;
  models?(sessions: readonly SessionInfo[], signal: AbortSignal): Promise<ReadonlyMap<string, SessionModel>>;
  rename?(session: SessionInfo, title: string): Promise<void>;
}
export const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;

export function messagesToPreview(messages: SessionProjection["messages"]): Preview {
  const result: Preview["messages"] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.content;
    const text = typeof content === "string" ? content : content
      .filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const clean = safeText(text, true).trim();
    result.push({ role: message.role, text: clean ? clean.slice(0, 1500) + (clean.length > 1500 ? "\n…（单条已截断）" : "") : "[图片或非文本内容]" });
  }
  return { messages: result.slice(-8), note: "当前分支最近 8 条用户/助手文本；不含思考与工具输出。" };
}

type DetailManager = Pick<ExtensionContext["sessionManager"], "getBranch" | "buildSessionProjection">;

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function branchText(manager: DetailManager, limit = 6000) {
  const branch = manager.getBranch();
  const edits = new Map(branch.flatMap((entry) => entry.type === "context_edit" ? [[entry.targetId, entry.replacement] as const] : []));
  const messages = branch.filter((entry) => entry.type === "message");
  const resolve = (entry: (typeof messages)[number] | undefined): string | undefined => {
    if (!entry) return undefined;
    const edit = edits.get(entry.id);
    if (edits.has(entry.id) && edit === null) return "[Omitted from context]";
    const text = safeText(textContent(edit ? edit.content : "content" in entry.message ? entry.message.content : undefined), true).trim();
    if (!text) return "[No text content]";
    return text.slice(0, limit) + (text.length > limit ? "\n[Truncated]" : "");
  };
  return { messages, resolve };
}

/** Title input is intentionally independent of the latest-reply detail viewport. */
export function firstExchangeFromManager(manager: DetailManager): { prompt?: string; reply?: string } {
  // Keep full text here: resource wrappers must be stripped BEFORE any limit.
  const { messages, resolve } = branchText(manager, Infinity);
  const firstUser = messages.findIndex((entry) => entry.message.role === "user");
  if (firstUser < 0) return {};
  const following = messages.slice(firstUser + 1);
  const nextUser = following.findIndex((entry) => entry.message.role === "user");
  const firstReply = following.slice(0, nextUser < 0 ? undefined : nextUser).findLast((entry) =>
    entry.message.role === "assistant" && usableText(resolve(entry)));
  return { prompt: resolve(messages[firstUser]), reply: resolve(firstReply) };
}
export function usableText(text: string | undefined): text is string {
  return !!text && text !== "[Omitted from context]" && text !== "[No text content]";
}

export function previewFromManager(manager: DetailManager): Preview {
  const projection = manager.buildSessionProjection();
  const { messages, resolve } = branchText(manager);
  const replyIndex = messages.findLastIndex((entry) => entry.message.role === "assistant");
  const prompt = messages.slice(0, replyIndex < 0 ? undefined : replyIndex).findLast((entry) => entry.message.role === "user");
  const details: TaskDetails = {
    model: projection.model ? `${projection.model.provider}/${projection.model.modelId}` : undefined,
    reasoning: projection.thinkingLevel,
    prompt: resolve(prompt),
    lastMessage: resolve(replyIndex < 0 ? undefined : messages[replyIndex]),
  };
  return { messages: messagesToPreview(projection.messages).messages, details };
}

/** Parse in memory only. SessionManager.open() may rewrite legacy files. */
function managerFromText(text: string, cwd: string): SessionManager {
  const entries = parseSessionEntries(text);
  if (!entries.length || entries[0]?.type !== "session") throw new Error("会话头缺失或损坏");
  const header = entries[0];
  if (typeof header.id !== "string" || typeof header.cwd !== "string" || typeof header.timestamp !== "string") {
    throw new Error("会话头格式不受支持");
  }
  validateEntries(entries);
  return SessionManager.inMemory(cwd, undefined, entries);
}
export function previewFromText(text: string, cwd: string): Preview {
  return previewFromManager(managerFromText(text, cwd));
}
/** Same effective-branch model as details; no prompt/reply extraction. */
export function modelFromText(text: string, cwd: string): SessionModel | undefined {
  const manager = managerFromText(text, cwd);
  const entries = manager.getEntries();
  const ids = new Set(entries.map((entry) => entry.id));
  if (entries.some((entry) => entry.parentId !== null && !ids.has(entry.parentId))) throw new Error("会话分支缺少父条目");
  return checkedModel(manager.buildSessionProjection().model);
}
function checkedModel(model: SessionProjection["model"]): SessionModel | undefined {
  return model && typeof model.provider === "string" && model.provider.trim() && typeof model.modelId === "string" && model.modelId.trim()
    ? { provider: model.provider, modelId: model.modelId } : undefined;
}

function validateEntries(entries: FileEntry[]): void {
  // Guard malformed JSON shapes and cycles before handing data to tree traversal.
  const parents = new Map<string, string | null>();
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object" || entry.type === "session" ||
      typeof entry.id !== "string" || !entry.id ||
      !(entry.parentId === null || typeof entry.parentId === "string") || parents.has(entry.id)) {
      throw new Error("会话条目损坏或为不支持的旧格式");
    }
    parents.set(entry.id, entry.parentId);
  }
  const checked = new Set<string>();
  for (const id of parents.keys()) {
    const chain = new Set<string>();
    let node: string | null | undefined = id;
    while (node && !checked.has(node)) {
      if (chain.has(node)) throw new Error("会话分支包含循环引用");
      chain.add(node);
      node = parents.get(node);
    }
    for (const item of chain) checked.add(item);
  }
}

async function readSessionText(path: string, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    if (size > MAX_PREVIEW_BYTES) return undefined;
    // Bound the actual read as well as stat: another process may append meanwhile.
    const buffer = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    signal.throwIfAborted();
    if (offset !== size) throw new Error("会话正在写入，请刷新后重试");
    return buffer.subarray(0, size).toString("utf8");
  } finally { await file.close(); }
}

export async function readPreview(path: string, cwd: string, signal: AbortSignal): Promise<Preview> {
  const text = await readSessionText(path, signal);
  return text === undefined ? { messages: [], note: "文件超过 16 MiB，已跳过预览；仍可恢复。" } : previewFromText(text, cwd);
}

export function createRepository(ctx: ExtensionContext, setCurrentName?: (name: string) => void, titles: TitleStore = createTitleStore()): SessionRepository {
  const modelCache = new Map<string, { revision: string; model?: SessionModel }>();
  const isCurrent = (session: SessionInfo) => pathKey(session.path) === pathKey(ctx.sessionManager.getSessionFile() ?? "");
  return {
    async list(scope, signal) {
      const groups = scope === "project" ? [await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir(), undefined, signal)] : await Promise.all([
        SessionManager.listAll(undefined, signal),
        SessionManager.listAll(ctx.sessionManager.getSessionDir(), undefined, signal),
      ]);
      const sessions = mergeSessions(...groups);
      // Bounded concurrency for large archives. Alias failures never hide history.
      for (let start = 0; start < sessions.length; start += 24) {
        signal.throwIfAborted();
        await Promise.all(sessions.slice(start, start + 24).map(async (session) => {
          const title = isCurrent(session) ? ctx.sessionManager.getSessionName() : await titles.read(session);
          if (title) session.name = title;
        }));
      }
      signal.throwIfAborted();
      return sessions;
    },
    async models(sessions, signal) {
      const result = new Map<string, SessionModel>();
      for (let start = 0; start < sessions.length; start += 4) {
        signal.throwIfAborted();
        await Promise.all(sessions.slice(start, start + 4).map(async (session) => {
          const key = pathKey(session.path);
          try {
            let model: SessionModel | undefined;
            if (isCurrent(session)) model = checkedModel(ctx.sessionManager.buildSessionProjection().model);
            else {
              const info = await stat(session.path);
              signal.throwIfAborted();
              const revision = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
              const cached = modelCache.get(key);
              if (cached?.revision === revision) model = cached.model;
              else {
                const text = await readSessionText(session.path, signal);
                model = text === undefined ? undefined : modelFromText(text, session.cwd);
                modelCache.set(key, { revision, model });
              }
            }
            if (model) result.set(key, model);
          } catch { signal.throwIfAborted(); /* Unknown model never hides a history. */ }
        }));
      }
      signal.throwIfAborted();
      return result;
    },
    async rename(session, title) {
      const clean = safeText(title).slice(0, 160);
      if (!clean) throw new Error("Title cannot be empty");
      if (isCurrent(session)) {
        if (!setCurrentName) throw new Error("Current-session naming is unavailable");
        setCurrentName(clean);
      } else await titles.write(session, clean);
    },
    async preview(session, signal) {
      signal.throwIfAborted();
      if (pathKey(session.path) === pathKey(ctx.sessionManager.getSessionFile() ?? "")) {
        return previewFromManager(ctx.sessionManager);
      }
      return readPreview(session.path, session.cwd, signal);
    },
  };
}
