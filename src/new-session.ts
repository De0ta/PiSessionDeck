import { constants } from "node:fs";
import { access, open, stat, unlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

export async function validateNewSessionCwd(cwd: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!cwd || !isAbsolute(cwd)) throw new Error("所选会话的工作目录缺失或不是绝对路径，请刷新后重试。");
  if (!(await stat(cwd)).isDirectory()) throw new Error("目标工作目录不是目录。");
  await access(cwd, constants.R_OK | constants.X_OK);
  signal.throwIfAborted();
}

/** Persist only a native header so switchSession can enter an empty project's runtime. */
export async function createEmptySession(cwd: string, signal: AbortSignal): Promise<SessionInfo> {
  await validateNewSessionCwd(cwd, signal);
  const manager = SessionManager.create(cwd);
  const path = manager.getSessionFile();
  const header = manager.getHeader();
  if (!path || !header) throw new Error("无法创建空会话。");
  const file = await open(path, "wx", 0o600);
  try {
    signal.throwIfAborted();
    await file.writeFile(JSON.stringify(header) + "\n", "utf8");
    await file.sync();
    signal.throwIfAborted();
  } catch (error) {
    await file.close();
    await unlink(path).catch(() => {});
    throw error;
  }
  await file.close();
  return {
    id: header.id, path, cwd: header.cwd,
    created: new Date(header.timestamp), modified: new Date(header.timestamp),
    messageCount: 0, firstMessage: "", allMessagesText: "",
  };
}
