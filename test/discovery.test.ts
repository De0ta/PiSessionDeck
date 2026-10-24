import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRepository } from "../src/repository.ts";
import { header, jsonl, session, user } from "./fixtures.ts";

test("真实SessionManager发现合成会话；当前会话预览来自内存，不读取缺失文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-viewer-discovery-"));
  try {
    const path = join(dir, "fixture.jsonl");
    const text = jsonl({ ...header, cwd: dir }, user("root", null, "可搜索中文消息"));
    await writeFile(path, text);
    const memory = SessionManager.inMemory(dir);
    memory.appendMessage({ role: "user", content: "尚未写入文件的当前消息", timestamp: Date.now() });
    const currentFile = join(dir, "not-on-disk.jsonl");
    const ctx = { cwd: dir, sessionManager: {
      getSessionDir: () => dir, getSessionFile: () => currentFile,
      getBranch: () => memory.getBranch(),
      getHeader: () => memory.getHeader(), getSessionId: () => memory.getSessionId(), getSessionName: () => memory.getSessionName(),
      buildSessionProjection: () => memory.buildSessionProjection(),
    } } as unknown as ExtensionContext;
    const repository = createRepository(ctx);
    const sessions = await repository.list("project", new AbortController().signal);
    assert.equal(sessions.length, 2);
    const saved = sessions.find((entry) => entry.path === path)!;
    assert.equal(saved.cwd, dir);
    assert.match(saved.allMessagesText, /可搜索中文消息/);
    assert.ok(sessions.some((entry) => entry.path === currentFile && "unsaved" in entry && entry.unsaved === true));
    const preview = await repository.preview(session("current", { path: currentFile, cwd: dir }), new AbortController().signal);
    assert.equal(preview.messages[0]!.text, "尚未写入文件的当前消息");
    assert.equal(preview.details?.prompt, "尚未写入文件的当前消息");
    assert.equal(await readFile(path, "utf8"), text);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
