import assert from "node:assert/strict";
import test from "node:test";
import { parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import { firstExchangeFromManager, previewFromManager, previewFromText } from "../src/repository.ts";
import { cwd, header, jsonl, user } from "./fixtures.ts";

const assistant = (id: string, parentId: string, content: unknown) => ({
  type: "message", id, parentId, timestamp: header.timestamp,
  message: { role: "assistant", content, provider: "openai", model: "gpt-test", timestamp: 1, stopReason: "stop" },
});
const edit = (id: string, parentId: string, targetId: string, content: string | null) => ({
  type: "context_edit", id, parentId, timestamp: header.timestamp, targetId,
  replacement: content === null ? null : { content },
});

test("详情提取回复对应提问、模型和推理；不混入废弃分支", () => {
  const preview = previewFromText(jsonl(header,
    { type: "thinking_level_change", id: "thinking", parentId: null, timestamp: header.timestamp, thinkingLevel: "high" },
    user("root", "thinking", "Original prompt"),
    assistant("abandoned", "root", [{ type: "text", text: "Wrong branch" }]),
    assistant("active", "root", [{ type: "thinking", thinking: "PRIVATE" }, { type: "text", text: "Final reply" }, { type: "toolCall", id: "tool", name: "bash", arguments: {} }]),
  ), cwd);
  assert.deepEqual(preview.details, { model: "openai/gpt-test", reasoning: "high", prompt: "Original prompt", lastMessage: "Final reply" });
  assert.ok(!JSON.stringify(preview.details).includes("PRIVATE"));
  assert.ok(!JSON.stringify(preview.details).includes("Wrong branch"));
});

test("回复对应提问不受8条预览限制；压缩不丢语义字段或暴露编辑前文本", () => {
  const preview = previewFromText(jsonl(header,
    user("root", null, "Secret original"),
    assistant("reply", "root", [{ type: "text", text: "Historical reply" }]),
    edit("edit", "reply", "root", "Safe prompt"),
    user("kept", "edit", "Kept message"),
    { type: "compaction", id: "compact", parentId: "kept", timestamp: header.timestamp, summary: "Summary", firstKeptEntryId: "kept", tokensBefore: 100 },
    ...Array.from({ length: 10 }, (_, i) => user(`tail${i}`, i ? `tail${i - 1}` : "compact", `Later ${i}`)),
  ), cwd);
  assert.equal(preview.messages.length, 8);
  assert.equal(preview.details?.prompt, "Safe prompt");
  assert.equal(preview.details?.lastMessage, "Historical reply");
  assert.ok(!JSON.stringify(preview.details).includes("Secret original"));
});

test("上下文编辑含删除/空替换始终后写优先，不回退泄漏原文", () => {
  const base = [header, user("root", null, "Secret prompt"), assistant("reply", "root", [{ type: "text", text: "Secret reply" }])];
  const omitted = previewFromText(jsonl(...base, edit("e1", "reply", "root", "Replacement"), edit("e2", "e1", "root", null), edit("e3", "e2", "reply", null)), cwd);
  assert.equal(omitted.details?.prompt, "[Omitted from context]");
  assert.equal(omitted.details?.lastMessage, "[Omitted from context]");
  const empty = previewFromText(jsonl(...base, edit("e1", "reply", "root", null), edit("e2", "e1", "root", ""), edit("e3", "e2", "reply", "")), cwd);
  assert.equal(empty.details?.prompt, "[No text content]");
  assert.equal(empty.details?.lastMessage, "[No text content]");
});

test("当前选中叶节点优先于磁盘最后一条；空会话不伪造模型", () => {
  const memory = SessionManager.inMemory(cwd);
  const empty = previewFromManager(memory);
  assert.deepEqual(empty.details, { model: undefined, reasoning: "off", prompt: undefined, lastMessage: undefined });
  const root = memory.appendMessage({ role: "user", content: "Root", timestamp: 1 });
  memory.appendMessage({ role: "user", content: "Old branch", timestamp: 2 });
  memory.branch(root);
  memory.appendMessage({ role: "user", content: "Another branch", timestamp: 3 });
  memory.branch(root);
  const preview = previewFromManager(memory);
  assert.deepEqual(preview.messages.map((m) => m.text), ["Root"]);
  assert.equal(preview.details?.prompt, "Root");
});

test("后续模型设置覆盖早期助手模型；非文本助手不展示思考或工具", () => {
  const preview = previewFromText(jsonl(header, user("root", null, "Prompt"),
    assistant("reply", "root", [{ type: "thinking", thinking: "PRIVATE" }]),
    { type: "model_change", id: "model", parentId: "reply", timestamp: header.timestamp, provider: "anthropic", modelId: "claude-test" },
  ), cwd);
  assert.equal(preview.details?.model, "anthropic/claude-test");
  assert.equal(preview.details?.lastMessage, "[No text content]");
});
