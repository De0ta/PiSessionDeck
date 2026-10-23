import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { pathKey, safeText } from "./model.ts";

type Identity = Pick<SessionInfo, "id" | "path">;
export interface TitleStore {
  read(session: Identity): Promise<string | undefined>;
  write(session: Identity, title: string): Promise<void>;
  remove(session: Identity): Promise<void>;
}
/** Viewer-owned aliases for other sessions: never mutate their JSONL/branch. */
export function createTitleStore(directory = join(getAgentDir(), "pi-session-viewer", "titles")): TitleStore {
  const path = (session: Identity) => join(directory, createHash("sha256").update(`${pathKey(session.path)}\0${session.id}`).digest("hex") + ".json");
  return {
    async read(session) {
      try {
        const text = await readFile(path(session), "utf8");
        if (text.length > 4096) return undefined;
        const record: unknown = JSON.parse(text);
        if (!record || typeof record !== "object" || !("title" in record) || typeof record.title !== "string") return undefined;
        return safeText(record.title).slice(0, 160) || undefined;
      } catch { return undefined; }
    },
    async remove(session) { await unlink(path(session)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); },
    async write(session, title) {
      const clean = safeText(title).slice(0, 160);
      if (!clean) throw new Error("Title cannot be empty");
      await mkdir(directory, { recursive: true });
      const target = path(session);
      const temp = target + `.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify({ title: clean }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        // Windows can transiently reject replace-on-rename during concurrent
        // readers/writers. Retry the atomic operation; never unlink the target.
        for (let attempt = 0; ; attempt++) {
          try { await rename(temp, target); break; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
            await delay(20 * 2 ** attempt);
          }
        }
      }
      finally { await unlink(temp).catch(() => {}); }
    },
  };
}
