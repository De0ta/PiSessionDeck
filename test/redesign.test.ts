import assert from "node:assert/strict";
import test from "node:test";
import { compositeTuiLine, matchesKey, styleText, visibleWidth } from "@earendil-works/pi-tui";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionBrowser } from "../src/browser.ts";
import { activityTime, sessionColor } from "../src/model.ts";
import { cwd, session, tick } from "./fixtures.ts";

function fixture(sessions: SessionInfo[] = [session("a", { name: "Alpha" }), session("b", { name: "Beta" })], promptText?: string) {
  let rows = 24;
  let status: "Ready" | "Working" | "Queued" = "Ready";
  const scopes: string[] = [];
  const done: unknown[] = [];
  let previews = 0;
  const browser = new SessionBrowser({
    cwd, currentFile: sessions[0]?.path, currentStatus: () => status,
    repository: {
      list: async (scope) => { scopes.push(scope); return sessions; },
      preview: async (s) => { previews++; return { messages: [], details: { model: "openai/gpt-test", reasoning: "high", prompt: promptText ?? `Prompt ${s.id}`, lastMessage: `Reply ${s.id}` } }; },
    },
    theme: { style: (text, options) => styleText(text, { fg: typeof options.fg === "object" ? options.fg : undefined, bg: typeof options.bg === "object" ? options.bg : undefined, bold: options.bold }, "truecolor") },
    keybindings: { matches: (data, action) => matchesKey(data, action === "tui.select.up" ? "up" : "down") },
    requestRender() {}, height: () => rows, done: (value) => done.push(value),
  });
  browser.focused = true;
  return { browser, scopes, done, get previews() { return previews; }, set rows(n: number) { rows = n; }, set status(s: typeof status) { status = s; } };
}
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("整屏逐格覆盖底层聊天，极小尺寸与resize保持终端宽高", async () => {
  const f = fixture(); await tick();
  for (const height of [1, 2, 5, 7, 24, 50]) {
    f.rows = height;
    for (const width of [1, 10, 40, 80, 99, 100, 120, 180]) {
      const lines = f.browser.render(width);
      assert.equal(lines.length, height);
      for (const line of lines) {
        assert.equal(visibleWidth(line), width);
        assert.ok(line.includes("\x1b["), "every cell is explicitly styled");
        assert.ok(!compositeTuiLine("UNDERLYING-CHAT".repeat(width), line, 0, width, width).includes("UNDERLYING-CHAT"));
      }
    }
  }
  f.browser.close();
});

test("详情为语义字段，当前状态真实可更新，其他历史不伪装成运行状态", async () => {
  const f = fixture(); await tick();
  let screen = plain(f.browser.render(140).join("\n"));
  for (const label of ["Tasks", "Status", "Updated", "Task details", "Model: openai/gpt-test", "Reasoning: high", "Last message", "Prompt a", "Reply a", "Ready", "Saved"]) assert.ok(screen.includes(label), label);
  f.status = "Working";
  f.browser.refreshCurrent(); await tick();
  screen = plain(f.browser.render(140).join("\n"));
  assert.ok(screen.includes("Working"));
  const count = f.previews;
  f.browser.handleInput("\x1b[B"); await tick();
  assert.ok(plain(f.browser.render(140).join("\n")).includes("Prompt b"));
  assert.equal(f.previews, count + 1);
  f.browser.refreshCurrent(); await tick();
  assert.equal(f.previews, count + 1, "events must not reload another process's history");
  f.browser.close();
});

test("搜索由F3显式开启；g和?在搜索时是文本；Esc逐级返回", async () => {
  const f = fixture([session("a", { name: "g? match" }), session("b", { name: "Other" })]); await tick();
  f.browser.handleInput("z"); // ordinary typing does not silently enter search
  assert.equal(f.browser.selected?.id, "a");
  f.browser.handleInput("\x1b[13~");
  f.browser.handleInput("g?"); await tick();
  let screen = plain(f.browser.render(140).join("\n"));
  assert.ok(screen.includes("Search › g?"));
  assert.ok(screen.includes("Group: Project"));
  assert.ok(!screen.includes("Task shortcuts"));
  f.browser.handleInput("\x1b");
  assert.equal(f.done.length, 0);
  f.browser.handleInput("?");
  screen = plain(f.browser.render(140).join("\n"));
  for (const label of ["Task shortcuts", "Navigate", "Tasks", "View", "F3", "Refresh"]) assert.ok(screen.includes(label));
  assert.doesNotMatch(screen, /Archive|Delete|Worktree|Pin task/);
  f.browser.handleInput("\x1b");
  assert.equal(f.done.length, 0);
  assert.ok(!plain(f.browser.render(140).join("\n")).includes("Task shortcuts"));
  f.browser.handleInput("\x1b");
  assert.deepEqual(f.done, [undefined]);
});

test("Tab切过滤、g切分组、窄屏左右切详情；帮助可滚动", async () => {
  const f = fixture(); await tick();
  f.browser.handleInput("g");
  assert.ok(plain(f.browser.render(140).join("\n")).includes("Group: Recent"));
  f.browser.handleInput("\t"); await tick();
  assert.deepEqual(f.scopes, ["all", "project"]);
  f.browser.handleInput("\x1b[C");
  assert.ok(plain(f.browser.render(60).join("\n")).includes("Prompt a"));
  f.browser.handleInput("\x1b[D");
  assert.ok(!plain(f.browser.render(60).join("\n")).includes("Prompt a"));
  f.rows = 12;
  f.browser.handleInput("?");
  for (let i = 0; i < 50; i++) f.browser.handleInput("\x1b[B");
  assert.ok(plain(f.browser.render(60).join("\n")).includes("Refresh"));
  f.browser.close();
});

test("当前会话实时刷新保留内容与详情滚动，不闪加载占位符", async () => {
  const f = fixture(undefined, Array.from({ length: 40 }, (_, i) => `Long prompt line ${i}`).join("\n"));
  f.rows = 24;
  await tick();
  f.browser.handleInput("\x1b[1;2B");
  f.browser.handleInput("\x1b[1;2B");
  const before = plain(f.browser.render(140).join("\n"));
  assert.ok(before.includes("Model:"), "metadata stays pinned");
  assert.ok(before.includes("Prompt") && before.includes("Long prompt line 0"), "prompt stays pinned while reply scrolls");
  f.browser.refreshCurrent();
  assert.equal(plain(f.browser.render(140).join("\n")), before, "keep current contents while refreshing");
  await tick();
  assert.equal(plain(f.browser.render(140).join("\n")), before, "same-session update preserves offset");
  f.browser.close();
});

test("身份配色独立于排序；相对时间边界和无效日期", () => {
  assert.equal(sessionColor("same-id"), sessionColor("same-id"));
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => sessionColor(String(i)))).size > 4);
  const now = 1_000_000_000;
  assert.equal(activityTime(new Date(now), now), "now");
  assert.equal(activityTime(new Date(now - 60_000), now), "1m ago");
  assert.equal(activityTime(new Date(now - 3_600_000), now), "1h ago");
  assert.equal(activityTime(new Date(now - 86_400_000), now), "1d ago");
  assert.equal(activityTime(new Date(now + 1), now), "now");
  assert.equal(activityTime(new Date(Number.NaN), now), "Unknown");
});
