import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionBrowser } from "../src/browser.ts";
import type { SessionRepository } from "../src/repository.ts";
import type { Preview } from "../src/model.ts";
import { cwd, deferred, session, tick } from "./fixtures.ts";

function create(repository: SessionRepository, currentFile?: string) {
  const completed: (SessionInfo | undefined)[] = [];
  let renders = 0;
  const browser = new SessionBrowser({
    cwd, currentFile, repository, theme: { style: (text) => text },
    keybindings: { matches: (data, action) => matchesKey(data, action === "tui.select.up" ? "up" : "down") },
    requestRender: () => { renders++; }, height: () => 24, done: (value) => completed.push(value),
  });
  browser.focused = true;
  return { browser, completed, get renders() { return renders; } };
}
function repo(sessions: SessionInfo[]): SessionRepository {
  return { list: async () => sessions, preview: async (s) => ({ messages: [], details: { model: "openai/test", reasoning: "high", prompt: `预览 ${s.id}`, lastMessage: "Latest reply" } }) };
}

test("宽屏双栏、中英文宽度、窄屏详情、搜索、Enter恢复", async () => {
  const a = session("a", { name: "中文标题👩‍💻" });
  const b = session("b", { name: "目标会话", allMessagesText: "needle" });
  const { browser, completed } = create(repo([a, b]));
  await tick();
  for (const width of [1, 10, 40, 80, 90, 120, 180]) {
    const lines = browser.render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `overflow at ${width}`);
    assert.equal(lines.length, 24);
  }
  assert.match(stripVTControlCharacters(browser.render(120)[0]!), /^PiSessionDeck/);
  assert.ok(browser.render(120).some((line) => line.includes("│")));
  browser.handleInput("\x1b[13~"); // F3 opens search explicitly
  browser.handleInput("needle");
  await tick();
  assert.equal(browser.selected?.id, "b");
  browser.handleInput("\x1b"); // Esc exits search, not the page
  browser.handleInput("\x1b[B");
  await tick();
  browser.handleInput("d"); // narrow view: details
  assert.ok(browser.render(60).join("\n").includes("预览 b"));
  browser.handleInput("\r");
  assert.deepEqual(completed, [b]);
});

test("当前会话默认选中；键盘和翻页沿显示顺序；Esc只关闭一次", async () => {
  const sessions = Array.from({ length: 12 }, (_, i) => session(String(i), { modified: new Date(100 - i) }));
  const { browser, completed } = create(repo(sessions), sessions[2]!.path);
  await tick();
  assert.equal(browser.selected?.id, "2");
  browser.handleInput("\x1b[B");
  assert.equal(browser.selected?.id, "3");
  browser.handleInput("\x1b[A");
  assert.equal(browser.selected?.id, "2");
  browser.handleInput("\x1b[6~");
  assert.notEqual(browser.selected?.id, "2");
  browser.handleInput("\x1b"); browser.close();
  assert.deepEqual(completed, [undefined]);
});

test("无结果Enter不关闭；Ctrl+O重新扫描范围；Ctrl+R刷新", async () => {
  const scopes: string[] = [];
  const { browser, completed } = create({
    list: async (scope) => { scopes.push(scope); return []; }, preview: async () => ({ messages: [] }),
  });
  await tick();
  browser.handleInput("\r");
  assert.equal(completed.length, 0);
  browser.handleInput("\x0f"); await tick();
  browser.handleInput("\x12"); await tick();
  assert.deepEqual(scopes, ["all", "project", "project"]);
  browser.close();
});

test("过期扫描/预览不覆盖新选中内容；关闭时中止并停止重绘", async () => {
  const scan1 = deferred<SessionInfo[]>();
  const scan2 = deferred<SessionInfo[]>();
  const firstPreview = deferred<Preview>();
  const secondPreview = deferred<Preview>();
  let call = 0;
  const signals: AbortSignal[] = [];
  const fixture = create({
    list: async (_scope, signal) => { signals.push(signal); return (++call === 1 ? scan1 : scan2).promise; },
    preview: async (s, signal) => { signals.push(signal); return (s.id === "a" ? firstPreview : secondPreview).promise; },
  });
  const { browser } = fixture;
  const refresh = browser.refresh();
  scan2.resolve([session("a"), session("b")]); await refresh;
  scan1.resolve([session("obsolete")]); await tick();
  assert.equal(browser.selected?.id, "a");
  browser.handleInput("\x1b[B");
  secondPreview.resolve({ messages: [], details: { prompt: "最新预览" } }); await tick();
  firstPreview.resolve({ messages: [], details: { prompt: "过期预览" } }); await tick();
  const screen = browser.render(120).join("\n");
  assert.ok(screen.includes("最新预览")); assert.ok(!screen.includes("过期预览"));
  browser.close();
  const count = fixture.renders;
  await browser.refresh(); await tick();
  assert.equal(fixture.renders, count);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("扫描/预览异常可见，不产生未处理拒绝", async () => {
  const first = create({ list: async () => { throw new Error("扫描失败"); }, preview: async () => ({ messages: [] }) });
  await tick();
  assert.match(first.browser.render(120).join("\n"), /扫描失败/);
  first.browser.close();
  const second = create({ list: async () => [session("a")], preview: async () => { throw new Error("坏文件"); } });
  await tick();
  assert.match(second.browser.render(120).join("\n"), /坏文件/);
  second.browser.close();
});
