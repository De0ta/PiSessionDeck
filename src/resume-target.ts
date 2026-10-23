import { constants } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { pathKey } from "./model.ts";

const MAX_HEADER_BYTES = 64 * 1024;
/** Read-only preflight. Never use SessionManager.open(): it can create missing files. */
export async function validateResumeTarget(session: SessionInfo, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const file = await open(session.path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || !info.size) throw new Error("会话文件为空或不是普通文件，请返回列表刷新。");
    const bytes = Buffer.alloc(Math.min(info.size, MAX_HEADER_BYTES));
    let offset = 0;
    let newline = -1;
    while (offset < bytes.length && newline < 0) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
      newline = bytes.indexOf(10, 0);
    }
    if (newline < 0 && info.size > offset) throw new Error("会话头超过64 KiB，无法安全核查。");
    let header: unknown;
    try { header = JSON.parse(bytes.subarray(0, newline < 0 ? offset : newline).toString("utf8").replace(/^\uFEFF/, "")); }
    catch { throw new Error("会话头缺失或损坏，请返回列表刷新。"); }
    if (!header || typeof header !== "object" || !("type" in header) || header.type !== "session" ||
      !("id" in header) || typeof header.id !== "string" || !header.id || header.id !== session.id || !("cwd" in header) || typeof header.cwd !== "string" ||
      !isAbsolute(header.cwd) || pathKey(header.cwd) !== pathKey(session.cwd) ||
      !("timestamp" in header) || typeof header.timestamp !== "string" || !Number.isFinite(Date.parse(header.timestamp)) ||
      !("version" in header) || typeof header.version !== "number" || ![1, 2, 3].includes(header.version)) {
      throw new Error("会话信息已改变或格式不受支持，请返回列表刷新后重试。");
    }
    signal.throwIfAborted();
    if (!(await stat(header.cwd)).isDirectory()) throw new Error("目标工作目录不是目录。");
    await access(header.cwd, constants.R_OK | constants.X_OK);
    const latest = await stat(session.path);
    if (latest.dev !== info.dev || latest.ino !== info.ino || latest.size !== info.size || latest.mtimeMs !== info.mtimeMs || latest.ctimeMs !== info.ctimeMs) {
      throw new Error("会话文件正在变化，请返回列表刷新后重试。");
    }
    signal.throwIfAborted();
  } finally { await file.close(); }
}
