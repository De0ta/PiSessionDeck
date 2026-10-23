import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compositeTuiLine, matchesKey, styleText, visibleWidth } from "@earendil-works/pi-tui";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { ResumeFlow, ResumePage } from "../src/resume.ts";
import { validateResumeTarget } from "../src/resume-target.ts";
import { cwd, deferred, header, jsonl, session, tick } from "./fixtures.ts";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const theme = { style: (text: string, o: Parameters<typeof styleText>[1]) => styleText(text, o, "truecolor") };
const keybindings = { matches: (data: string, action: string) => matchesKey(data, action === "tui.select.up" ? "up" : "down") };
function fixture(sessions = [session("a")]) {
  let rows = 30;
  let issue: string | undefined;
  let validations = 0;
  let switches = 0;
  let closed = 0;
  let validation: ((s: SessionInfo, signal: AbortSignal) => Promise<void>) | undefined;
  let resume: (() => Promise<{ cancelled: boolean }>) | undefined;
  const flow = new ResumeFlow({ cwd, currentFile: session("current").path, theme, keybindings,
    repository: { list: async () => sessions, preview: async (s) => ({ messages: [], details: { prompt: `Question ${s.id}`, lastMessage: Array.from({ length: 60 }, (_, i) => `Reply ${s.id} line ${i}`).join("\n") } }) },
    requestRender() {}, height: () => rows,
    canResume: () => issue,
    validate: async (s, signal) => { validations++; await validation?.(s, signal); },
    resume: async () => { switches++; return resume ? resume() : { cancelled: false }; },
    done: () => { closed++; },
  });
  flow.focused = true;
  return { flow, get validations() { return validations; }, get switches() { return switches; }, get closed() { return closed; },
    set issue(v: string | undefined) { issue = v; }, set rows(v: number) { rows = v; },
    set validate(v: NonNullable<typeof validation>) { validation = v; }, set resume(v: NonNullable<typeof resume>) { resume = v; } };
}

test("同目录与跨目录为两种独立页面，深灰仅包内容块、下方默认底色遮住旧聊天", async () => {
  for (const same of [true, false]) {
    const target = session("a", { name: "目标会话", cwd: same ? cwd : cwd + "/other" });
    const f = fixture([target]); await tick();
    f.flow.handleInput("\r");
    assert.equal(f.flow.phase, "resume");
    const lines = f.flow.render(100);
    const text = plain(lines.join("\n"));
    assert.match(text, same ? /Resume session/ : /Working directory · resume/);
    assert.match(text, same ? /Switch conversations in the same directory/ : /This session belongs to a different directory/);
    assert.match(text, same ? /Directory/ : /Current/);
    assert.match(text, same ? /Resume this session/ : /Use session directory and resume/);
    const labelLines = text.split("\n");
    const targetLine = labelLines.find((line) => line.trimStart().startsWith("Session "))!;
    const currentLine = labelLines.find((line) => line.trimStart().startsWith(same ? "Directory " : "Current "))!;
    assert.equal(targetLine.indexOf(same ? "目标会话" : target.cwd), currentLine.indexOf(cwd));
    assert.equal(text.includes("Session manager"), false);
    assert.equal(text.includes("Always use"), false);
    assert.ok(lines.some((line) => line.includes("48;2;38;38;38")));
    assert.ok(lines.some((line) => line.includes("48;2;101;158;232")));
    assert.ok(lines.at(-1)!.startsWith("\x1b[0m"));
    assert.ok(!lines.at(-1)!.includes("48;2"), "no full-height forced gray background");
    for (const line of lines) assert.ok(!compositeTuiLine("OLD CHAT".repeat(20), line, 0, 100, 100).includes("OLD CHAT"));
    assert.equal(f.switches, 0);
    f.flow.close();
  }
});

test("转换页路径完整换行、窄屏resize和极小终端严格保持宽高", () => {
  let rows = 30;
  const page = new ResumePage({ cwd, session: session("a", { cwd: cwd + "/中文路径/".repeat(15) }), theme, keybindings, height: () => rows, requestRender() {}, confirm() {}, back() {} });
  for (const height of [1, 2, 5, 12, 30, 70]) {
    rows = height;
    for (const width of [1, 2, 5, 6, 10, 40, 80, 140]) {
      const lines = page.render(width);
      assert.equal(lines.length, height);
      for (const line of lines) assert.equal(visibleWidth(line), width);
      page.handleInput("\x1b[B"); page.render(width); page.handleInput("\x1b[A");
      page.handleInput("\x1b[6~"); page.render(width); page.handleInput("\x1b[5~");
    }
  }
});

test("长路径窄屏的页内错误自动滚入视口，方向键仍可返回操作区", () => {
  const page = new ResumePage({ cwd, session: session("a", { cwd: cwd + "/long-path".repeat(30) }), theme, keybindings, height: () => 8, requestRender() {}, confirm() {}, back() {} });
  page.error = "无法恢复：目录已删除";
  assert.match(plain(page.render(30).join("\n")), /目录已删除/);
  page.handleInput("\x1b[B");
  assert.match(plain(page.render(30).join("\n")), /Back to sessions/);
});

test("宿主成功切换时shutdown关闭页面，结果迟到不再调用状态检查或渲染", async () => {
  let valid = true;
  let checks = 0;
  let closed = 0;
  const flow = new ResumeFlow({ cwd, theme, keybindings, height: () => 24,
    repository: { list: async () => [session("a")], preview: async () => ({ messages: [] }) },
    requestRender: () => { assert.equal(valid, true); },
    canResume: () => { assert.equal(valid, true); checks++; return undefined; },
    validate: async () => {},
    resume: async () => { flow.close(); valid = false; return { cancelled: false }; },
    done: () => { closed++; },
  });
  await tick(); flow.handleInput("\r"); flow.handleInput("\r"); await tick();
  assert.equal(checks, 2); assert.equal(closed, 1);
});

test("浏览器当前会话直接返回，不打开转换页或检查目标", async () => {
  const f = fixture([session("current")]); await tick();
  f.flow.handleInput("\x1b[C");
  assert.equal(f.closed, 1); assert.equal(f.validations, 0); assert.equal(f.switches, 0);
});

test("转换页Enter与右键才确认；返回保留同一浏览器的搜索分组展开选择和详情滚动", async () => {
  const sessions = Array.from({ length: 9 }, (_, i) => session(`a${i}`, { name: `Question ${i}`, modified: new Date(1000 - i) }));
  const f = fixture(sessions); await tick();
  f.flow.handleInput("g");
  f.flow.handleInput("\x1b[13~"); f.flow.handleInput("Question");
  for (let i = 0; i < 5; i++) f.flow.handleInput("\x1b[B");
  f.flow.handleInput("\r"); await tick(); // Show more, not a resume page.
  assert.equal(f.flow.phase, "browse");
  f.flow.handleInput("\x1b[1;2B");
  const before = plain(f.flow.render(140).join("\n"));
  const browser = f.flow.browser;
  assert.ok(before.includes("Search › Question")); assert.ok(before.includes("Group: Recent"));
  assert.equal(browser.selected?.id, "a5");
  f.flow.handleInput("\r"); assert.equal(f.flow.phase, "resume");
  f.flow.handleInput("\x1b");
  assert.equal(f.flow.browser, browser); assert.equal(f.flow.phase, "browse");
  assert.equal(plain(f.flow.render(140).join("\n")), before);
  assert.equal(f.closed, 0);
  f.flow.handleInput("\r"); f.flow.handleInput("2"); f.flow.handleInput("\x1b[C");
  assert.equal(f.flow.phase, "browse");
  f.flow.handleInput("\r"); f.flow.handleInput("\x03"); assert.equal(f.flow.phase, "browse");
  f.flow.handleInput("\r"); f.flow.handleInput("\x1b[C"); await tick();
  assert.equal(f.switches, 1); assert.equal(f.closed, 1);
});

test("忙碌、排队或草稿错误留在转换页，不调用预检/切换，清除后可重试", async () => {
  const f = fixture(); await tick(); f.flow.handleInput("\r");
  for (const issue of ["当前任务尚未结束", "有排队消息", "当前编辑器有草稿"]) {
    f.issue = issue; f.flow.handleInput("\r"); await tick();
    assert.ok(plain(f.flow.render(100).join("\n")).includes(issue));
    assert.equal(f.flow.phase, "resume"); assert.equal(f.switches, 0); assert.equal(f.validations, 0);
  }
  f.issue = undefined; f.flow.handleInput("\r"); await tick();
  assert.equal(f.switches, 1); assert.equal(f.closed, 1);
});

test("异步预检后再查当前状态，新队列/草稿不允许继续恢复", async () => {
  const f = fixture(); const pending = deferred<void>();
  f.validate = () => pending.promise;
  await tick(); f.flow.handleInput("\r"); f.flow.handleInput("\r");
  f.issue = "状态已改变：出现新草稿"; pending.resolve(); await tick();
  assert.equal(f.switches, 0); assert.equal(f.closed, 0);
  assert.match(plain(f.flow.render(100).join("\n")), /出现新草稿/);
  f.flow.close();
});

test("返回/关闭中止预检，迟到结果不能切换、重新打开页面或覆盖新选择", async () => {
  for (const close of [false, true]) {
    const f = fixture(); const pending = deferred<void>(); let signal: AbortSignal | undefined;
    f.validate = (_s, s) => { signal = s; return pending.promise; };
    await tick(); f.flow.handleInput("\r"); f.flow.handleInput("\r");
    if (close) f.flow.close(); else f.flow.handleInput("\x1b");
    assert.equal(signal?.aborted, true);
    pending.resolve(); await tick();
    assert.equal(f.switches, 0); assert.equal(f.closed, close ? 1 : 0);
    assert.equal(f.flow.phase, close ? "resume" : "browse");
    f.flow.close();
  }
});

test("预检/宿主拒绝或异常在页内展示；重复确认不重入，实际提交后不承诺Esc取消", async () => {
  const f = fixture(); await tick(); f.flow.handleInput("\r");
  f.validate = async () => { throw new Error("文件已删除"); };
  f.flow.handleInput("\r"); await tick();
  assert.match(plain(f.flow.render(100).join("\n")), /文件已删除/);
  f.validate = async () => {};
  f.resume = async () => ({ cancelled: true }); f.flow.handleInput("\r"); await tick();
  assert.match(plain(f.flow.render(100).join("\n")), /Pi 已取消恢复/);
  f.resume = async () => { throw new Error("Host refused"); }; f.flow.handleInput("\r"); await tick();
  assert.match(plain(f.flow.render(100).join("\n")), /Host refused/);
  const pending = deferred<{ cancelled: boolean }>(); f.resume = () => pending.promise;
  f.flow.handleInput("\r"); f.flow.handleInput("\r"); await tick();
  f.flow.handleInput("\x1b"); f.flow.handleInput("\x1b[C");
  assert.equal(f.flow.phase, "resume"); assert.equal(f.switches, 3);
  pending.resolve({ cancelled: false }); await tick(); assert.equal(f.closed, 1);
});

async function files(run: (dir: string, target: SessionInfo) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-viewer-resume-"));
  try {
    const cwd = join(dir, "project"); await mkdir(cwd);
    const target = session(header.id, { cwd, path: join(dir, "target.jsonl") });
    await writeFile(target.path, jsonl({ ...header, cwd }));
    await run(dir, target);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const signal = () => new AbortController().signal;

test("目标预检仅只读会话头，不迁移v2/v3、不改变字节和mtime；大文件不整文件读取", async () => files(async (_dir, target) => {
  for (const version of [1, 2, 3]) {
    await writeFile(target.path, jsonl({ ...header, cwd: target.cwd, version }));
    const before = await stat(target.path); const bytes = await readFile(target.path);
    await validateResumeTarget(target, signal());
    assert.deepEqual(await readFile(target.path), bytes); assert.equal((await stat(target.path)).mtimeMs, before.mtimeMs);
  }
  await truncate(target.path, 17 * 1024 * 1024);
  await validateResumeTarget(target, signal());
}));

test("目标文件缺失、空文件、坏头、过长头、ID/目录变化及未知版本都不恢复/创建文件", async () => files(async (_dir, target) => {
  const missing = { ...target, path: target.path + ".missing" };
  await assert.rejects(validateResumeTarget(missing, signal()), /ENOENT/);
  await assert.rejects(access(missing.path), /ENOENT/);
  for (const text of ["", "bad json\n", jsonl({ ...header, cwd: target.cwd, id: "changed" }), jsonl({ ...header, cwd: target.cwd + "/changed" }), jsonl({ ...header, cwd: target.cwd, version: 4 }), jsonl({ ...header, cwd: target.cwd, version: "3" }), JSON.stringify({ ...header, cwd: "x".repeat(70_000) })]) {
    await writeFile(target.path, text); await assert.rejects(validateResumeTarget(target, signal()));
    assert.equal(await readFile(target.path, "utf8"), text);
  }
}));

test("目标目录缺失/不是目录和预先取消都在切换之前失败", async () => files(async (dir, target) => {
  for (const cwd of [join(dir, "missing"), target.path]) {
    await writeFile(target.path, jsonl({ ...header, cwd }));
    await assert.rejects(validateResumeTarget({ ...target, cwd }, signal()));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateResumeTarget(target, controller.signal), /abort/i);
}));
