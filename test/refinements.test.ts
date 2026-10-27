import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { SessionManager, type ExtensionContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionBrowser } from "../src/browser.ts";
import { COLORS, detailLines, painter } from "../src/details.ts";
import { groupRows, pathKey, summarizeTitle } from "../src/model.ts";
import { createRepository } from "../src/repository.ts";
import { createTitleStore } from "../src/titles.ts";
import { cwd, deferred, header, jsonl, session, tick, user } from "./fixtures.ts";

import { theme } from "./theme-fixture.ts";
const paint = painter(theme);
function fixture(sessions: SessionInfo[], rename?: (session: SessionInfo, title: string) => Promise<void>, list = async () => sessions) {
  const done: unknown[] = [];
  const browser = new SessionBrowser({ cwd, repository: {
    list,
    preview: async () => ({ messages: [], details: { model: "provider/model", reasoning: "high", lastMessage: "**Bold reply**\n\n- List item\n\n| A | B |\n|---|---|\n| C | D |", prompt: "First prompt\nSecond line" } }), rename,
  }, theme, keybindings: { matches: (data, action) => matchesKey(data, action === "tui.select.up" ? "up" : "down") }, height: () => 30, requestRender() {}, done: (s) => done.push(s) });
  browser.focused = true;
  return { browser, done, screen: () => stripVTControlCharacters(browser.render(160).join("\n")) };
}

test("每项目默认5条、项目间空行、Show more逐次5条直到消失", () => {
  const sessions = Array.from({ length: 12 }, (_, i) => session(String(i)));
  sessions.push(session("other", { cwd: `${cwd}-other` }));
  const limits = new Map<string, number>();
  let rows = groupRows(sessions, limits);
  assert.equal(rows.filter((r) => r.kind === "session").length, 6);
  assert.equal(rows.filter((r) => r.kind === "spacer").length, 1);
  assert.deepEqual(rows.find((r) => r.kind === "more"), { kind: "more", key: pathKey(cwd), remaining: 7 });
  limits.set(pathKey(cwd), 10);
  rows = groupRows(sessions, limits);
  assert.equal(rows.filter((r) => r.kind === "session").length, 11);
  limits.set(pathKey(cwd), 15);
  assert.ok(!groupRows(sessions, limits).some((r) => r.kind === "more"));
});

test("Show more可键盘选中但不恢复会话，展开后选中首条新展示项", async () => {
  const sessions = Array.from({ length: 12 }, (_, i) => session(String(i), { modified: new Date(100 - i) }));
  const f = fixture(sessions); await tick();
  for (let i = 0; i < 5; i++) f.browser.handleInput("\x1b[B");
  assert.ok(!Boolean(f.browser.selected));
  assert.match(f.screen(), /Show more \(7 remaining\)/);
  f.browser.handleInput("\r"); await tick();
  assert.equal(f.browser.selected?.id, "5");
  assert.equal(f.done.length, 0);
  assert.match(f.screen(), /Show more \(2 remaining\)/);
  for (let i = 0; i < 5; i++) f.browser.handleInput("\x1b[B");
  f.browser.handleInput("\r"); await tick();
  assert.equal(f.browser.selected?.id, "10");
  assert.doesNotMatch(f.screen(), /Show more/);
  f.browser.close();
});

test("r标题编辑可保存、取消，失败不丢原始标题", async () => {
  const renamed: string[] = [];
  const f = fixture([session("a", { name: "Original" })], async (_s, name) => { renamed.push(name); });
  await tick();
  f.browser.handleInput("r"); // Rename
  f.browser.handleInput("\x15"); // Ctrl+U
  f.browser.handleInput("New title");
  f.browser.handleInput("\r"); await tick();
  assert.deepEqual(renamed, ["New title"]);
  assert.equal(f.browser.selected?.name, "New title");
  f.browser.handleInput("r");
  f.browser.handleInput("\x15"); f.browser.handleInput("Cancelled"); f.browser.handleInput("\x1b");
  assert.equal(f.browser.selected?.name, "New title");
  assert.equal(f.done.length, 0);
  f.browser.close();
  const fail = fixture([session("b", { name: "Keep me" })], async () => { throw new Error("disk full"); });
  await tick(); fail.browser.handleInput("r"); fail.browser.handleInput("x"); fail.browser.handleInput("\r"); await tick();
  assert.match(fail.screen(), /Could not rename/);
  assert.equal(fail.browser.selected?.name, "Keep me"); fail.browser.close();
});

test("旧扫描延迟返回不能覆盖成功的手动标题", async () => {
  const original = session("a", { name: "Original" });
  const pending = deferred<SessionInfo[]>();
  let calls = 0;
  const f = fixture([original], async () => {}, async () => ++calls === 1 ? [original] : pending.promise);
  await tick();
  const refresh = f.browser.refresh();
  f.browser.handleInput("r"); f.browser.handleInput("\x15");
  f.browser.handleInput("New name"); f.browser.handleInput("\r"); await tick();
  assert.equal(f.browser.selected?.name, "New name");
  pending.resolve([{ ...original }]); await refresh; await tick();
  assert.equal(f.browser.selected?.name, "New name");
  f.browser.close();
});

test("浏览器打开时首次交互完成的名称同步到当前详情和列表", async () => {
  const s = session("current", { name: undefined });
  const f = fixture([s]); f.browser.options.currentFile = s.path;
  await tick(); f.browser.refreshCurrent("Summarized title"); await tick();
  assert.equal(f.browser.selected?.name, "Summarized title");
  assert.match(f.screen(), /Summarized title/);
  f.browser.close();
});

test("后台模型标题不被更早启动的扫描结果覆盖", async () => {
  const current = session("current", { name: "Fallback" });
  const pending = deferred<SessionInfo[]>(); let calls = 0;
  const f = fixture([current], undefined, async () => ++calls === 1 ? [current] : pending.promise);
  f.browser.options.currentFile = current.path; await tick();
  const scanning = f.browser.refresh(); f.browser.refreshCurrent("Model title");
  pending.resolve([{ ...current }]); await scanning; await tick();
  assert.equal(f.browser.selected?.name, "Model title"); f.browser.close();
});

test("新扫描读取原生改名或清空，不能永久套用旧的自动标题缓存", async () => {
  const current = session("current", { name: "Fallback" });
  let fresh = [current];
  const f = fixture(fresh, undefined, async () => fresh);
  f.browser.options.currentFile = current.path; await tick();
  f.browser.refreshCurrent("Model title");
  fresh = [{ ...current, name: "Native manual name" }]; await f.browser.refresh();
  assert.equal(f.browser.selected?.name, "Native manual name");
  f.browser.refreshCurrent("Another cached name");
  fresh = [{ ...current, name: undefined }]; await f.browser.refresh();
  assert.equal(f.browser.selected?.name, undefined); f.browser.close();
});

test("详情Markdown、固定Prompt、三行彩色标题、灰色省略与元数据分色", () => {
  const s = session("details", { name: "标题".repeat(120) });
  const preview = { messages: [], details: { model: "provider/model", reasoning: "high", lastMessage: Array.from({ length: 100 }, (_, i) => `**Reply ${i}**\n\n`).join(""), prompt: "Prompt first\nPrompt second\n".repeat(50) } };
  const result = detailLines({ session: s, preview, status: "Saved", current: false, width: 36, height: 24, offset: 0, paint });
  const plain = result.lines.map(stripVTControlCharacters);
  assert.ok(result.lines.length <= 24);
  assert.equal(plain[0], "", "blank line after Task details");
  assert.equal(plain.slice(1, 4).length, 3);
  assert.ok(result.lines[3]!.includes(paint("...", COLORS.dim)));
  assert.ok(plain.some((s) => s === "Last message"));
  const promptIndex = plain.indexOf("Prompt");
  assert.ok(promptIndex >= 0 && promptIndex + 2 < plain.length, "two prompt rows are reserved");
  assert.ok(result.lines.some((s) => s.includes(paint("provider", COLORS.provider))));
  assert.ok(result.lines.some((s) => s.includes(paint("model", COLORS.blue))));
  assert.ok(result.lines.some((s) => s.includes(paint("high", "thinkingHigh"))));
  assert.ok(!plain.join("\n").includes("**"));
  assert.ok(result.maxOffset > 0);
  const scrolled = detailLines({ session: s, preview, status: "Saved", current: false, width: 36, height: 24, offset: 30, paint });
  assert.equal(stripVTControlCharacters(scrolled.lines[scrolled.lines.findIndex((s) => stripVTControlCharacters(s) === "Prompt") + 1]!), plain[promptIndex + 1]);
});

test("22行高窗口单行回复视口逐行滚动不跳过内容且Prompt固定", async () => {
  const s = session("short", { name: "长标题".repeat(60) });
  const browser = new SessionBrowser({ cwd, repository: {
    list: async () => [s],
    preview: async () => ({ messages: [], details: { model: "provider/model", reasoning: "high", prompt: "Pinned prompt",
      lastMessage: "```\n" + Array.from({ length: 30 }, (_, i) => `Reply${String(i).padStart(2, "0")}`).join("\n") + "\n```" } }),
  }, theme, keybindings: { matches: () => false }, height: () => 22, requestRender() {}, done() {} });
  await tick();
  const seen = new Set<string>();
  for (let i = 0; i < 65; i++) {
    const screen = stripVTControlCharacters(browser.render(120).join("\n"));
    assert.match(screen, /Pinned prompt/);
    for (const match of screen.matchAll(/Reply\d{2}/g)) seen.add(match[0]);
    browser.handleInput("\x1b[1;2B");
  }
  assert.equal(seen.size, 30, "every reply line must be reachable");
  browser.close();
});

test("搜索条独立灰底蓝字，底栏按键白色说明灰色，Markdown表格非原始竖线", async () => {
  const f = fixture([session("a")]); await tick();
  assert.doesNotMatch(f.screen(), /Search ›/);
  f.browser.handleInput("\x1bOR"); // F3
  const lines = f.browser.render(160);
  assert.ok(lines[2]!.includes(paint("Search › ", COLORS.blue, true)));
  f.browser.handleInput("r");
  assert.match(f.screen(), /Search › r/);
  assert.doesNotMatch(f.screen(), /Rename ›/);
  f.browser.handleInput("\x1b");
  assert.doesNotMatch(f.screen(), /Search ›/);
  const footer = lines.at(-1)!;
  assert.ok(footer.includes(paint("F3", COLORS.white)));
  assert.ok(footer.includes(paint(" search", COLORS.dim)));
  assert.doesNotMatch(f.screen(), /\*\*Bold reply\*\*|\|---\|---\|/);
  assert.ok(lines.every((s) => visibleWidth(s) === 160));
  f.browser.close();
});

test("本地标题提炼剔除技能包裹、首句有界且不拆分emoji", () => {
  assert.equal(summarizeTitle("<skill>Ignore this block</skill>\n# 修复登录错误。其他细节"), "修复登录错误");
  assert.equal(summarizeTitle("hello\nmore"), "hello");
  assert.equal(Array.from(summarizeTitle("😀".repeat(100))).length, 43);
  assert.equal(summarizeTitle("<skill>Only context</skill>"), "Untitled task");
});

test("历史重命名仅写独立别名，当前重命名走原生回调；别名并发原子写入", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-title-test-"));
  try {
    const file = join(dir, "saved.jsonl");
    const original = jsonl(header, user("u", null, "Saved prompt")); await writeFile(file, original);
    const store = createTitleStore(join(dir, "titles"));
    const memory = SessionManager.inMemory(cwd);
    const current = join(dir, "current.jsonl");
    const ctx = { cwd, sessionManager: { getSessionDir: () => dir, getSessionFile: () => current, getSessionName: () => memory.getSessionName(),
      getHeader: () => memory.getHeader(), getSessionId: () => memory.getSessionId(), getBranch: () => memory.getBranch(),
      buildSessionProjection: () => memory.buildSessionProjection() } } as unknown as ExtensionContext;
    const repository = createRepository(ctx, (title) => { memory.appendSessionInfo(title); }, store);
    const saved = session(header.id, { path: file });
    await repository.rename!(saved, "Manual alias");
    assert.equal(await store.read(saved), "Manual alias");
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal((await repository.list("project", new AbortController().signal))[0]!.name, "Manual alias");
    await repository.rename!(session("current", { path: current }), "Native title");
    assert.equal(memory.getSessionName(), "Native title");
    await Promise.all([store.write(saved, "first"), store.write(saved, "second")]);
    assert.ok(["first", "second"].includes((await store.read(saved))!));
    assert.equal((await readdir(join(dir, "titles"))).length, 1);
    await store.remove(saved); assert.equal(await store.read(saved), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
