import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { pathKey } from "./model.ts";

type Identity = Pick<SessionInfo, "id" | "path">;
export interface PinStore {
  read(session: Identity): Promise<number | undefined>;
  write(session: Identity, pinned: boolean): Promise<void>;
  remove(session: Identity): Promise<void>;
}
/** Viewer-owned pins: never mutate the source session JSONL. */
export function createPinStore(directory = join(getAgentDir(), "pi-session-viewer", "pins")): PinStore {
  const path = (session: Identity) => join(directory, createHash("sha256").update(`${pathKey(session.path)}\0${session.id}`).digest("hex") + ".json");
  const remove = async (session: Identity): Promise<void> => {
    await unlink(path(session)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  };
  return {
    async read(session) {
      try {
        const file = await open(path(session), "r");
        let text: string;
        try {
          // Read at most one byte beyond the limit, even for huge corrupt files.
          const buffer = Buffer.alloc(4097);
          let size = 0;
          while (size < buffer.length) {
            const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
            if (!bytesRead) break;
            size += bytesRead;
          }
          if (size > 4096) return undefined;
          text = buffer.toString("utf8", 0, size);
        } finally { await file.close(); }
        const record: unknown = JSON.parse(text);
        if (!record || typeof record !== "object" || !("pinnedAt" in record)) return undefined;
        return typeof record.pinnedAt === "number" && Number.isFinite(record.pinnedAt) && record.pinnedAt > 0
          ? record.pinnedAt : undefined;
      } catch { return undefined; }
    },
    remove,
    async write(session, pinned) {
      if (!pinned) return remove(session);
      await mkdir(directory, { recursive: true });
      const target = path(session);
      const temp = target + `.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify({ pinnedAt: Date.now() }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        // Retry Windows replace-on-rename failures without unlinking the target.
        for (let attempt = 0; ; attempt++) {
          try { await rename(temp, target); break; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
            await delay(20 * 2 ** attempt);
          }
        }
      } finally { await unlink(temp).catch(() => {}); }
    },
  };
}
