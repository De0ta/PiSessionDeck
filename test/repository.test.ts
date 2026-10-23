import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PREVIEW_BYTES, previewFromText, readPreview } from "../src/repository.ts";
import { cwd, header, jsonl, user } from "./fixtures.ts";

async function fixture(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-viewer-test-"));
  try { await run(join(dir, "session.jsonl")); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("预览遵循当前分支，不混入废弃分支；忽略损坏的尾行", () => {
  const text = jsonl(header, user("root", null, "根"), user("abandoned", "root", "旧分支"), user("active", "root", "新分支")) + "{incomplete";
  assert.deepEqual(previewFromText(text, cwd).messages.map((m) => m.text), ["根", "新分支"]);
});

test("上下文编辑被解析，不展示已替换的原文", () => {
  const text = jsonl(header, user("root", null, "不再展示"), {
    type: "context_edit", id: "edit", parentId: "root", timestamp: header.timestamp,
    targetId: "root", replacement: { content: "替换文本" },
  });
  assert.deepEqual(previewFromText(text, cwd).messages.map((m) => m.text), ["替换文本"]);
});

test("预览只保留最近8条，单条截断；控制序列不泄漏", () => {
  const entries = Array.from({ length: 10 }, (_, i) => user(`m${i}`, i ? `m${i - 1}` : null, `${i}:\x1b[31m${"字".repeat(2000)}`));
  const preview = previewFromText(jsonl(header, ...entries), cwd);
  assert.equal(preview.messages.length, 8);
  assert.match(preview.messages[0]!.text, /^2:/);
  assert.ok(preview.messages.every((m) => m.text.length < 1550 && !m.text.includes("\x1b")));
});

test("无效会话头、重复ID、循环引用和旧格式安全失败", () => {
  for (const text of ["", jsonl(null), jsonl(header, null), jsonl(header, user("a", null, "a"), user("a", null, "b")),
    jsonl(header, user("a", "b", "a"), user("b", "a", "b")), jsonl(header, { type: "message", message: {} })]) {
    assert.throws(() => previewFromText(text, cwd));
  }
});

test("文件预览不改动原字节或mtime（含v2会话）", async () => fixture(async (path) => {
  const text = jsonl({ ...header, version: 2 }, user("root", null, "只读"));
  await writeFile(path, text);
  const before = await stat(path);
  const preview = await readPreview(path, cwd, new AbortController().signal);
  assert.deepEqual(preview.messages.map((m) => m.text), ["只读"]);
  assert.equal(await readFile(path, "utf8"), text);
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
}));

test("空文件保持为空、超大文件跳过、取消和缺失文件可处理", async () => fixture(async (path) => {
  await writeFile(path, "");
  await assert.rejects(readPreview(path, cwd, new AbortController().signal), /会话头/);
  assert.equal((await stat(path)).size, 0);
  const file = await open(path, "r+");
  try { await file.truncate(MAX_PREVIEW_BYTES + 1); } finally { await file.close(); }
  assert.match((await readPreview(path, cwd, new AbortController().signal)).note!, /16 MiB/);
  await assert.rejects(readPreview(path, cwd, AbortSignal.abort()));
  await assert.rejects(readPreview(`${path}-missing`, cwd, new AbortController().signal), /ENOENT/);
}));
