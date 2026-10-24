import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cleanModelTitle, createAutoTitler, TITLE_MARKER, TITLE_TIMEOUT_MS } from "../src/auto-title.ts";
import { cwd, deferred, tick } from "./fixtures.ts";

type Stream = ExtensionContext["modelRegistry"]["streamSimple"];
type Response = Awaited<ReturnType<ReturnType<Stream>["result"]>>;
const model: NonNullable<ExtensionContext["model"]> = { id: "fake-model", name: "Fake", provider: "fake-provider", api: "openai-responses", baseUrl: "https://invalid.example", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function response(text = "会话浏览器交互优化", stopReason: Response["stopReason"] = "stop"): Response {
  return { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE" }, { type: "text", text }], api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: 1,
    usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function fixture(result: () => Promise<Response> = async () => response()) {
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: "<skill>Hidden resource</skill>\n请优化会话浏览器。具体要求", timestamp: 1 });
  manager.appendMessage({ ...response("已调整键盘导航和详情展示"), timestamp: 2 });
  const requests: { model: Parameters<Stream>[0]; context: Parameters<Stream>[1]; options: Parameters<Stream>[2] }[] = [];
  let invalid = false;
  const updates: string[] = [];
  // Controlled partial public-host doubles: no providers, credentials or network.
  const pi = { getSessionName: () => { assert.ok(!invalid, "stale API access"); return manager.getSessionName(); },
    setSessionName: (name: string) => { assert.ok(!invalid); manager.appendSessionInfo(name); },
    appendEntry: (kind: string, data: unknown) => { assert.ok(!invalid); manager.appendCustomEntry(kind, data); },
  } as unknown as ExtensionAPI;
  const ctx = { sessionManager: manager, model, modelRegistry: { streamSimple: (...[selected, context, options]: Parameters<Stream>) => {
    requests.push({ model: selected, context, options }); return { result };
  } } } as unknown as ExtensionContext;
  const titler = createAutoTitler(pi, (title) => updates.push(title));
  return { manager, ctx, pi, titler, requests, updates, invalidate: () => { invalid = true; } };
}

test("当前模型单次独立命名，先存本地回退、后台完成后更新且不泄露thinking/资源包装", async () => {
  const pending = deferred<Response>();
  const f = fixture(() => pending.promise);
  f.titler.start(f.ctx);
  assert.equal(f.manager.getSessionName(), "请优化会话浏览器");
  assert.equal(f.requests.length, 1);
  const req = f.requests[0]!;
  assert.equal(req.model, model);
  assert.equal(req.context.messages.length, 1);
  assert.equal(req.context.tools, undefined);
  assert.match(req.context.systemPrompt ?? "", /Output ONLY the topic itself/);
  assert.match(req.context.systemPrompt ?? "", /Never add a label, category or prefix/);
  const input = JSON.stringify(req.context);
  assert.match(input, /请优化会话浏览器/);
  assert.match(input, /已调整键盘导航和详情展示/);
  assert.doesNotMatch(input, /PRIVATE|Hidden resource/);
  assert.equal(req.options?.maxRetries, 0);
  assert.equal(req.options?.maxTokens, 256);
  assert.equal(req.options?.reasoning, undefined, "small output limits must not enable optional Anthropic thinking");
  assert.equal(req.options?.cacheRetention, "none");
  f.titler.start(f.ctx); assert.equal(f.requests.length, 1);
  pending.resolve(response()); await tick();
  assert.equal(f.manager.getSessionName(), "会话浏览器交互优化");
  assert.deepEqual(f.updates, ["请优化会话浏览器", "会话浏览器交互优化"]);
  assert.equal(f.manager.getEntries().filter((e) => e.type === "message").length, 2, "no naming messages in main transcript");
  assert.ok(f.manager.getEntries().some((e) => e.type === "custom" && e.customType === TITLE_MARKER && (e.data as { method: string }).method === "model"));
  f.titler.start(f.ctx); assert.equal(f.requests.length, 1);
});

test("provider失败/错误结束/无效输出只保留本地回退，且不自动重试", async () => {
  for (const result of [() => { throw new Error("auth unavailable"); }, async () => response("", "error"), async () => response("title", "length"), async () => response("explanation\nsecond line"), async () => response("")]) {
    const f = fixture(result); f.titler.start(f.ctx); await tick();
    assert.equal(f.manager.getSessionName(), "请优化会话浏览器");
    f.titler.start(f.ctx); assert.equal(f.requests.length, 1);
    assert.deepEqual(f.updates, ["请优化会话浏览器"]);
  }
});

test("手动名称与旧版自动标题标记优先，不发模型请求", () => {
  const f = fixture(); f.manager.appendSessionInfo("Manual"); f.titler.start(f.ctx);
  assert.equal(f.requests.length, 0);
  const marked = fixture(); marked.manager.appendCustomEntry(TITLE_MARKER, { version: 1 }); marked.titler.start(marked.ctx);
  assert.equal(marked.requests.length, 0);
  const cleared = fixture(); cleared.manager.appendSessionInfo("Manual"); cleared.manager.appendSessionInfo(""); cleared.titler.start(cleared.ctx);
  assert.equal(cleared.requests.length, 0);
  assert.equal(cleared.manager.getSessionName(), undefined);
});

test("生成期间手动重命名、改回同名或清空都不能被迟到模型结果覆盖", async () => {
  for (const manual of ["Manual", "请优化会话浏览器", ""]) {
    const pending = deferred<Response>(); const f = fixture(() => pending.promise); f.titler.start(f.ctx);
    f.manager.appendSessionInfo(manual); pending.resolve(response()); await tick();
    assert.equal(f.manager.getSessionName(), manual || undefined);
    assert.deepEqual(f.updates, ["请优化会话浏览器"]);
  }
});

test("切换/reload取消后台请求，不访问失效API或改写新会话", async () => {
  const pending = deferred<Response>(); const f = fixture(() => pending.promise); f.titler.start(f.ctx);
  const signal = f.requests[0]!.options?.signal;
  f.titler.cancel(); f.titler.cancel(); f.invalidate();
  assert.equal(signal?.aborted, true);
  pending.resolve(response()); await tick();
  assert.equal(f.manager.getSessionName(), "请优化会话浏览器");
  assert.equal(f.updates.length, 1);
});

test("硬超时中止不响应AbortSignal的provider，并保留回退", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<Response>(); const f = fixture(() => pending.promise); f.titler.start(f.ctx);
  t.mock.timers.tick(TITLE_TIMEOUT_MS); await tick();
  assert.equal(f.requests[0]!.options?.signal?.aborted, true);
  pending.resolve(response()); await tick();
  assert.equal(f.manager.getSessionName(), "请优化会话浏览器");
});

test("请求后上下文被删除/替换，不提交旧内容生成的标题", async () => {
  const pending = deferred<Response>(); const f = fixture(() => pending.promise); f.titler.start(f.ctx);
  const first = f.manager.getBranch().find((e) => e.type === "message" && e.message.role === "user")!;
  f.manager.appendContextEdit(first.id, null);
  pending.resolve(response()); await tick();
  assert.equal(f.manager.getSessionName(), "请优化会话浏览器");
  assert.equal(f.updates.length, 1);
});

test("超长资源包装先完整移除再限长，不把资源内容放入回退标题或模型请求", async () => {
  const f = fixture();
  const user = f.manager.getBranch().find((e) => e.type === "message" && e.message.role === "user")!;
  f.manager.appendContextEdit(user.id, { content: `<skill>${"PRIVATE RESOURCE ".repeat(800)}</skill>\n真正的问题。后续说明` });
  f.titler.start(f.ctx);
  assert.equal(f.manager.getSessionName(), "真正的问题");
  const input = JSON.stringify(f.requests[0]?.context);
  assert.doesNotMatch(input, /PRIVATE RESOURCE|<skill>|Truncated/);
  assert.match(input, /真正的问题/);
  await tick();
});

test("模型标题规范化及Unicode有界，不接受多行说明/标签", () => {
  assert.equal(cleanModelTitle('“标题：修复键盘导航”'), "修复键盘导航");
  for (const prefix of ["短会话标题-", "简短会话标题 — ", "会话标题：", "对话标题: ", "Short session title: ", "Session title - ", "Title: 标题："]) {
    assert.equal(cleanModelTitle(prefix + "修复键盘导航"), "修复键盘导航");
  }
  assert.equal(cleanModelTitle("短会话标题-"), undefined);
  assert.equal(cleanModelTitle("标题生成接口修复"), "标题生成接口修复");
  assert.equal(cleanModelTitle("line one\nline two"), undefined);
  assert.equal(cleanModelTitle("<tag>title</tag>"), undefined);
  assert.equal(Array.from(cleanModelTitle("😀".repeat(60))!).length, 43);
});
