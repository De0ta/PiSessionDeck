import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { parseSessionEntries, SessionManager, type ExtensionContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, styleText } from "@earendil-works/pi-tui";
import { SessionBrowser } from "../src/browser.ts";
import { groupRows, pathKey, rowKey, sessionGroup, type SessionModel } from "../src/model.ts";
import { createRepository, MAX_PREVIEW_BYTES, modelFromText } from "../src/repository.ts";
import { cwd, deferred, header, jsonl, session, tick, user } from "./fixtures.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 24);
const aged = (age: number, id = String(age)) => session(id, { modified: new Date(now - age) });
const group = (age: number) => sessionGroup(aged(age), { mode: "recent", now });
const modelChange = (id: string, parentId: string | null, provider: string, modelId: string) => ({ type: "model_change", id, parentId, timestamp: header.timestamp, provider, modelId });
const assistant = (id: string, parentId: string, provider: string, model: string) => ({ type: "message", id, parentId, timestamp: header.timestamp,
  message: { role: "assistant", content: [{ type: "text", text: "Answer" }], provider, model, stopReason: "stop", timestamp: 1 } });

test("Recent六档边界互斥，恰好到上限归下一档；未来与坏时间安全处理", () => {
  const edges = [5 * HOUR, DAY, 7 * DAY, 30 * DAY, 90 * DAY];
  assert.equal(group(0).label, "Within 5 hours");
  for (const [i, end] of edges.entries()) {
    assert.equal(group(end - 1).key, `recent:${i}`);
    assert.equal(group(end).key, `recent:${i + 1}`);
  }
  assert.equal(group(91 * DAY).label, "Over 3 months");
  assert.equal(group(-HOUR).key, "recent:0");
  assert.equal(sessionGroup(session("bad", { modified: new Date(NaN) }), { mode: "recent", now }).label, "Unknown time");
});

test("Recent组按新到旧排列，只显示非空组；组内维持活动排序", () => {
  const rows = groupRows([aged(100 * DAY), aged(DAY), aged(0), aged(7 * DAY), aged(5 * HOUR), aged(30 * DAY)], undefined, { mode: "recent", now });
  assert.deepEqual(rows.filter((r) => r.kind === "group").map((r) => r.key), Array.from({ length: 6 }, (_, i) => `recent:${i}`));
  const sparse = groupRows([aged(DAY), aged(DAY + 1)], undefined, { mode: "recent", now });
  assert.equal(sparse.filter((r) => r.kind === "group").length, 1);
  assert.deepEqual(sparse.filter((r) => r.kind === "session").map((r) => r.session.id), [String(DAY), String(DAY + 1)]);
});

test("模型按provider/modelId完整身份分组，未知模型不与真实名称混淆", () => {
  const models = [{ provider: "a/b", modelId: "c" }, { provider: "a", modelId: "b/c" }, { provider: "a/b", modelId: "c" }];
  const sessions = Array.from({ length: 4 }, (_, i) => session(String(i)));
  const rows = groupRows(sessions, undefined, { mode: "model", modelFor: (s) => models[Number(s.id)] });
  const groups = rows.filter((r) => r.kind === "group");
  assert.deepEqual(groups.map((r) => r.count), [2, 1, 1]);
  assert.equal(new Set(groups.map((r) => r.key)).size, 3);
  assert.equal(groups[2]?.label, "Unknown model");
});

test("相同状态聚合，不同状态分开；所有分组独立五条展开和空行", () => {
  for (const mode of ["project", "recent", "model", "status"] as const) {
    const sessions = Array.from({ length: 12 }, (_, i) => aged(i, String(i)));
    const options = { mode, now, modelFor: () => ({ provider: "p", modelId: "m" }), statusFor: () => "Saved" };
    const limits = new Map<string, number>();
    let rows = groupRows(sessions, limits, options);
    assert.equal(rows.filter((r) => r.kind === "session").length, 5, mode);
    const more = rows.find((r) => r.kind === "more")!;
    assert.equal(more.kind, "more");
    if (more.kind !== "more") throw Error("missing more");
    assert.equal(more.remaining, 7);
    assert.equal(rowKey(more), `more:${more.key}`);
    limits.set(more.key, 10); rows = groupRows(sessions, limits, options);
    assert.equal(rows.filter((r) => r.kind === "session").length, 10);
    limits.set(more.key, 15); assert.ok(!groupRows(sessions, limits, options).some((r) => r.kind === "more"));
  }
  const rows = groupRows([session("a"), session("b"), session("c")], new Map(), { mode: "status", statusFor: (s) => s.id === "a" ? "Working" : "Saved" });
  assert.deepEqual(rows.filter((r) => r.kind === "group").map((r) => [r.label, r.count]), [["Working", 1], ["Saved", 2]]);
  assert.equal(rows.filter((r) => r.kind === "spacer").length, 1);
});

function browserFixture(sessions: SessionInfo[], options: { now?: () => number; models?: (signal: AbortSignal) => Promise<ReadonlyMap<string, SessionModel>> } = {}) {
  let lists = 0;
  let modelReads = 0;
  let currentStatus: "Ready" | "Working" | "Completed" = "Working";
  let currentModel = { provider: "provider", modelId: "model-A" };
  const done: (SessionInfo | undefined)[] = [];
  const browser = new SessionBrowser({ cwd, currentFile: sessions[0]?.path, now: options.now ?? (() => now),
    currentStatus: () => currentStatus, currentModel: () => currentModel,
    repository: { list: async () => { lists++; return sessions; }, preview: async () => ({ messages: [] }), models: async (_sessions, signal) => {
      modelReads++;
      return options.models ? options.models(signal) : new Map(sessions.map((s, i) => [pathKey(s.path), { provider: "provider", modelId: i < 7 ? "model-A" : "model-B" }]));
    } },
    theme: { style: (text, style) => styleText(text, { fg: typeof style.fg === "object" ? style.fg : undefined, bg: typeof style.bg === "object" ? style.bg : undefined, bold: style.bold }, "truecolor") },
    keybindings: { matches: (data, action) => matchesKey(data, action === "tui.select.up" ? "up" : "down") },
    requestRender() {}, height: () => 50, done: (value) => done.push(value),
  });
  browser.focused = true;
  return { browser, done, get lists() { return lists; }, get modelReads() { return modelReads; },
    set status(value: typeof currentStatus) { currentStatus = value; }, set model(value: typeof currentModel) { currentModel = value; } };
}
const screen = (browser: SessionBrowser) => stripVTControlCharacters(browser.render(180).join("\n"));
const selectedId = (browser: SessionBrowser) => browser.selected?.id;

test("g循环四种分组，Model延迟只读加载、当前模型优先，所有组可右键展开", async () => {
  const sessions = Array.from({ length: 12 }, (_, i) => aged(i * HOUR, String(i)));
  const f = browserFixture(sessions); await tick();
  assert.equal(f.modelReads, 0);
  for (const expected of ["Recent", "Model"]) { f.browser.handleInput("g"); await tick(); assert.ok(screen(f.browser).includes(`Group: ${expected}`)); }
  assert.equal(f.modelReads, 1); assert.equal(f.lists, 1);
  assert.ok(screen(f.browser).includes("provider/model-A  7"));
  for (let i = 0; i < 5; i++) f.browser.handleInput("\x1b[B");
  assert.equal(f.browser.selected, undefined);
  f.browser.handleInput("\x1b[C"); await tick();
  assert.equal(selectedId(f.browser), "5"); assert.equal(f.done.length, 0);
  f.model = { provider: "provider", modelId: "live-model" }; f.browser.refreshCurrent(); await tick();
  assert.ok(screen(f.browser).includes("provider/live-model  1"));
  f.browser.handleInput("g"); assert.ok(screen(f.browser).includes("Group: Status"));
  assert.ok(screen(f.browser).includes("Working  1")); assert.ok(screen(f.browser).includes("Saved  11"));
  f.status = "Completed"; f.browser.refreshCurrent(); await tick();
  assert.ok(screen(f.browser).includes("Completed  1")); assert.ok(!screen(f.browser).includes("Working"));
  f.browser.handleInput("g"); assert.ok(screen(f.browser).includes("Group: Project"));
  assert.equal(f.lists, 1); assert.equal(f.modelReads, 1); f.browser.close();
});

test("搜索中的g是文本；过滤/搜索仍在分组前应用", async () => {
  const f = browserFixture([aged(HOUR, "g match"), aged(40 * DAY, "other")]); await tick();
  f.browser.handleInput("g");
  f.browser.handleInput("\x1b[13~"); f.browser.handleInput("g");
  assert.ok(screen(f.browser).includes("Group: Recent"));
  assert.ok(screen(f.browser).includes("Within 5 hours  1"));
  assert.ok(!screen(f.browser).includes("1 month – 3 months"));
  f.browser.close();
});

test("模型加载的迟到结果不能覆盖新扫描；关闭/切组会取消", async () => {
  const pending = [deferred<ReadonlyMap<string, SessionModel>>(), deferred<ReadonlyMap<string, SessionModel>>()];
  const signals: AbortSignal[] = [];
  const f = browserFixture([aged(0, "a")], { models: (signal) => { signals.push(signal); return pending[signals.length - 1]!.promise; } });
  await tick(); f.browser.handleInput("g"); f.browser.handleInput("g");
  assert.equal(signals.length, 1);
  await f.browser.refresh(); assert.equal(signals.length, 2); assert.ok(signals[0]!.aborted);
  pending[1]!.resolve(new Map()); await tick();
  pending[0]!.resolve(new Map([[pathKey(session("a").path), { provider: "stale", modelId: "stale" }]])); await tick();
  assert.ok(!screen(f.browser).includes("stale"));
  f.browser.handleInput("g"); assert.ok(signals[1]!.aborted); f.browser.close();
});

test("Recent跨时间边界自动展开目标组，不能打开不可见的第六条选择", async () => {
  let clock = now;
  const f = browserFixture(Array.from({ length: 6 }, (_, i) => aged(5 * HOUR - 1000, String(i))), { now: () => clock });
  await tick(); f.browser.handleInput("g");
  for (let i = 0; i < 5; i++) f.browser.handleInput("\x1b[B");
  f.browser.handleInput("\x1b[C"); await tick();
  assert.equal(selectedId(f.browser), "5");
  assert.ok(screen(f.browser).includes("Within 5 hours  6"));
  clock += 2000;
  const next = screen(f.browser);
  assert.ok(next.includes("5 hours – 1 day  6"));
  assert.ok(next.includes("会话 5")); assert.ok(!next.includes("Show more"));
  assert.equal(selectedId(f.browser), "5");
  f.browser.handleInput("\r"); assert.equal(f.done[0]?.id, "5");
});

test("关闭浏览器取消在途模型加载，迟到返回不能重开页面", async () => {
  const pending = deferred<ReadonlyMap<string, SessionModel>>();
  let signal: AbortSignal | undefined;
  const f = browserFixture([aged(0)], { models: (value) => { signal = value; return pending.promise; } });
  await tick(); f.browser.handleInput("g"); f.browser.handleInput("g");
  f.browser.close(); assert.ok(signal?.aborted);
  pending.resolve(new Map()); await tick(); assert.deepEqual(f.done, [undefined]);
});

test("模型元数据使用当前分支最后的model_change或助手实际模型，不混入废弃分支", () => {
  const text = jsonl(header, modelChange("m", null, "p", "initial"), user("u", "m", "Q"),
    assistant("a", "u", "p", "physical"), modelChange("old", "a", "p", "abandoned"),
    modelChange("latest", "a", "p", "selected"));
  assert.deepEqual(modelFromText(text, cwd), { provider: "p", modelId: "selected" });
  assert.deepEqual(modelFromText(jsonl(header, modelChange("m", null, "p", "virtual"), user("u", "m", "Q"), assistant("a", "u", "q", "physical")), cwd), { provider: "q", modelId: "physical" });
  assert.equal(modelFromText(jsonl(header, user("u", null, "Q")), cwd), undefined);
  assert.throws(() => modelFromText(jsonl(header, modelChange("m", "missing", "p", "orphan")), cwd), /缺少父条目/);
});

test("模型元数据文件读取只读/有界/可取消；mtime变化而活动时间不变仍更新", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-viewer-models-"));
  try {
    const path = join(dir, "history.jsonl");
    const text = jsonl(header, modelChange("m", null, "p", "first"), user("u", "m", "Q"));
    await writeFile(path, text);
    const manager = SessionManager.inMemory(cwd, undefined, parseSessionEntries(jsonl(header, modelChange("live", null, "live", "current"))));
    // Controlled host boundary: only cwd and the real read-only manager are used.
    const ctx = { cwd, sessionManager: manager } as unknown as ExtensionContext;
    const repo = createRepository(ctx);
    const history = session("history", { path });
    const before = await stat(path);
    assert.deepEqual((await repo.models!([history], new AbortController().signal)).get(pathKey(path)), { provider: "p", modelId: "first" });
    assert.equal(await readFile(path, "utf8"), text); assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
    await writeFile(path, text + jsonl(modelChange("new", "u", "p", "second")));
    assert.deepEqual((await repo.models!([history], new AbortController().signal)).get(pathKey(path)), { provider: "p", modelId: "second" });
    // The current in-memory projection wins, even if its disk transcript has no usable model.
    const liveCtx = { cwd, sessionManager: { getSessionFile: () => path, buildSessionProjection: () => manager.buildSessionProjection() } } as unknown as ExtensionContext;
    await writeFile(path, "corrupt on disk");
    assert.deepEqual((await createRepository(liveCtx).models!([history], new AbortController().signal)).get(pathKey(path)), { provider: "live", modelId: "current" });
    const oversized = join(dir, "large.jsonl"); const file = await open(oversized, "w");
    try { await file.truncate(MAX_PREVIEW_BYTES + 1); } finally { await file.close(); }
    const bad = join(dir, "bad.jsonl"); await writeFile(bad, "not a session");
    const unknown = await repo.models!([session("big", { path: oversized }), session("bad", { path: bad }), session("missing")], new AbortController().signal);
    assert.equal(unknown.size, 0);
    await assert.rejects(repo.models!([history], AbortSignal.abort()));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
