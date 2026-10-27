import assert from "node:assert/strict";
import test from "node:test";
import { matchesKey, parseColor, visibleWidth } from "@earendil-works/pi-tui";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { ActionDialog } from "../src/action-dialog.ts";
import { ResumeFlow, type ResumeFlowOptions } from "../src/resume.ts";
import { cwd, deferred, session, tick } from "./fixtures.ts";

const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "");
import { theme } from "./theme-fixture.ts";
const keybindings = { matches: (data: string, action: string) => matchesKey(data, action === "tui.select.up" ? "up" : "down") };
const revision = {} as Awaited<ReturnType<NonNullable<ResumeFlowOptions["actions"]>["captureDelete"]>>;
function fixture(target = session("a")) {
  let rows = 28, done = 0, renders = 0, checks = 0, creates = 0, prepares = 0, forks = 0, captures = 0, deletes = 0;
  let issue: string | undefined;
  let signal: AbortSignal | undefined;
  const prepared = session("fork", { path: target.path + ".fork" });
  const actions: NonNullable<ResumeFlowOptions["actions"]> = {
    prepareNew: async () => undefined,
    newSession: async () => { creates++; return { cancelled: true }; },
    prepareFork: async (_session, abort) => { prepares++; signal = abort; return prepared; },
    fork: async (_session, copy) => { forks++; assert.equal(copy, prepared); return { cancelled: true }; },
    captureDelete: async (_session, abort) => { captures++; signal = abort; return revision; },
    delete: async (_session, captured, abort) => { deletes++; signal = abort; assert.equal(captured, revision); return undefined; },
  };
  const flow = new ResumeFlow({ cwd, currentFile: session("current").path, theme, keybindings,
    repository: { list: async () => [target, session("b")], preview: async () => ({ messages: [] }) },
    height: () => rows, requestRender: () => { renders++; }, canResume: () => { checks++; return issue; },
    validate: async () => {}, resume: async () => ({ cancelled: false }), actions, done: () => { done++; },
  });
  flow.focused = true;
  return { flow, actions, prepared, open: (action: "new" | "fork" | "delete" | "menu", selected: SessionInfo | undefined = target) => flow.browser.options.onAction!(action, selected),
    text: () => plain(flow.render(120).join("\n")), get signal() { return signal; },
    get counts() { return { done, renders, checks, creates, prepares, forks, captures, deletes }; },
    set rows(value: number) { rows = value; }, set issue(value: string | undefined) { issue = value; } };
}

test("delete defaults to Cancel, numbers/arrows only select, right never submits; modal owns focus", async () => {
  const f = fixture(); await tick();
  const browserBefore = plain(f.flow.browser.render(120).join("\n"));
  f.open("delete"); await tick();
  assert.equal(f.flow.browser.focused, false);
  assert.match(f.text(), /Permanently delete/); assert.match(f.text(), /不可撤销/);
  assert.ok(f.flow.render(120).some((line) => line.includes("48;2;38;38;38")));
  f.flow.handleInput("2"); f.flow.handleInput("\x1b[C"); await tick(); assert.equal(f.counts.deletes, 0);
  f.flow.handleInput("1"); f.flow.handleInput("\r");
  assert.equal(f.counts.deletes, 0); assert.equal(f.flow.browser.focused, true);
  assert.equal(plain(f.flow.browser.render(120).join("\n")), browserBefore);
  f.open("delete"); await tick(); f.flow.handleInput("\r");
  assert.equal(f.counts.deletes, 0); assert.equal(f.counts.done, 0);
  f.flow.close();
});

test("current session delete is blocked without capture or delete", async () => {
  const f = fixture(session("current")); await tick(); f.open("delete"); await tick();
  f.flow.handleInput("2"); f.flow.handleInput("\r"); await tick();
  assert.equal(f.counts.captures, 0); assert.equal(f.counts.deletes, 0);
  assert.match(f.text(), /不能删除当前会话/); f.flow.handleInput("\x03"); assert.equal(f.flow.browser.focused, true); f.flow.close();
});

test("delete retains captured revision on rejection; success removes locally and warning is not failure", async () => {
  const f = fixture(); await tick();
  let calls = 0;
  f.actions.delete = async (_target, captured) => { assert.equal(captured, revision); if (++calls === 1) throw new Error("revision changed"); return "pin cleanup warning"; };
  f.open("delete"); await tick(); f.flow.handleInput("2"); f.flow.handleInput("\r"); await tick();
  assert.match(f.text(), /revision changed/); assert.equal(f.counts.captures, 1);
  f.flow.handleInput("\r"); await tick();
  assert.equal(f.flow.browser.selected?.id, "b"); assert.match(f.text(), /Session deleted/); assert.match(f.text(), /pin cleanup warning/);
  assert.equal(f.counts.done, 0); f.flow.handleInput("\r"); assert.equal(f.flow.browser.focused, true); f.flow.close();
});

test("fork preview is independent and cancelled/throwing host retries reuse prepared file", async () => {
  const f = fixture(session("a", { cwd: cwd + "/other", name: "源会话" })); await tick(); f.open("fork");
  assert.match(f.text(), /Fork session/); assert.match(f.text(), /原会话保持不变/); assert.match(f.text(), /无模型调用/);
  assert.match(f.text(), /源会话/); assert.match(f.text(), /other/);
  f.flow.handleInput("\r"); await tick();
  assert.equal(f.counts.prepares, 1); assert.equal(f.counts.forks, 1); assert.match(f.text(), /已创建未打开/); assert.ok(f.text().includes(f.prepared.path));
  f.actions.fork = async (_target, copy) => { assert.equal(copy, f.prepared); throw new Error("host refused"); };
  f.flow.handleInput("\r"); await tick(); assert.match(f.text(), /host refused/);
  assert.equal(f.counts.prepares, 1); f.flow.handleInput("\x1b"); assert.equal(f.flow.browser.focused, true); f.flow.close();
});

test("current native fork accepts undefined preparation without repeating preparation", async () => {
  const f = fixture(session("current")); await tick(); let prepares = 0, forks = 0;
  f.actions.prepareFork = async () => { prepares++; return undefined; };
  f.actions.fork = async (_target, copy) => { forks++; assert.equal(copy, undefined); return { cancelled: true }; };
  f.open("fork"); f.flow.handleInput("\r"); await tick(); f.flow.handleInput("\r"); await tick();
  assert.equal(prepares, 1); assert.equal(forks, 2); f.flow.close();
});

test("new and fork check canResume before and after preflight", async () => {
  for (const action of ["new", "fork"] as const) {
    const f = fixture(); await tick(); f.issue = "draft"; f.open(action); if (action === "fork") f.flow.handleInput("\r"); await tick();
    assert.match(f.text(), /draft/); assert.equal(f.counts.creates + f.counts.prepares, 0); f.flow.close();
    const g = fixture(); await tick(); const pending = deferred<SessionInfo | undefined>();
    g.actions.prepareFork = () => pending.promise;
    g.open(action); if (action === "fork") g.flow.handleInput("\r");
    g.issue = "new queue"; pending.resolve(g.prepared); await tick();
    assert.match(g.text(), /new queue/); assert.equal(g.counts.creates + g.counts.forks, 0); assert.equal(g.counts.checks, 2); g.flow.close();
  }
});

test("new captures selected workspace for n and menu; no selection falls back to current workspace", async () => {
  for (const menu of [false, true]) {
    const target = session("other", { cwd: cwd + "/selected-project" });
    const f = fixture(target); await tick(); const directories: string[] = [];
    for (let i = 0; i < 5 && f.flow.browser.selected?.id !== target.id; i++) f.flow.handleInput("\x1b[B");
    assert.equal(f.flow.browser.selected?.id, target.id);
    f.actions.prepareNew = async (directory) => { directories.push(directory); return undefined; };
    if (menu) { f.open("menu"); f.flow.handleInput("1"); f.flow.handleInput("\r"); }
    else f.flow.handleInput("n");
    await tick();
    assert.deepEqual(directories, [target.cwd]); assert.equal(f.counts.creates, 1);
    assert.ok(f.text().includes(target.cwd)); f.flow.close();
  }
  const f = fixture(); await tick(); const directories: string[] = [];
  f.actions.prepareNew = async (directory) => { directories.push(directory); return undefined; };
  f.flow.browser.options.onAction!("new", undefined); await tick();
  assert.deepEqual(directories, [cwd]); f.flow.close();
});

test("new retries reuse the created empty session after host cancellation or failure", async () => {
  const f = fixture(); await tick(); let prepares = 0, opens = 0;
  f.actions.prepareNew = async () => { prepares++; return f.prepared; };
  f.actions.newSession = async (created) => {
    assert.equal(created, f.prepared);
    if (++opens === 2) throw new Error("host refused");
    return { cancelled: true };
  };
  f.open("new"); await tick();
  assert.ok(f.text().includes(f.prepared.path));
  f.flow.handleInput("\r"); await tick(); assert.match(f.text(), /host refused/);
  f.flow.handleInput("\r"); await tick();
  assert.equal(prepares, 1); assert.equal(opens, 3); f.flow.close();
});

test("new preparation is cancellable, late creation stays discoverable, late failures do not alter closed UI", async () => {
  for (const reject of [false, true]) {
    const f = fixture(); await tick(); const pending = deferred<SessionInfo | undefined>(); let signal: AbortSignal | undefined;
    f.actions.prepareNew = (_directory, abort) => { signal = abort; return pending.promise; };
    f.open("new"); f.flow.handleInput("\x1b");
    assert.equal(signal?.aborted, true); assert.equal(f.flow.browser.focused, true);
    const renders = f.counts.renders;
    if (reject) pending.reject(new Error("late failure")); else pending.resolve(f.prepared);
    await tick(); assert.equal(f.counts.creates, 0);
    assert.equal(f.counts.renders, renders + (reject ? 0 : 1)); f.flow.close();
  }
});

test("new preparation failures can retry without silently changing the target directory", async () => {
  const target = session("other", { cwd: cwd + "/missing" }); const f = fixture(target); await tick();
  const directories: string[] = [];
  f.actions.prepareNew = async (directory) => {
    directories.push(directory);
    if (directories.length === 1) throw new Error("missing project");
    return undefined;
  };
  f.open("new"); await tick(); assert.match(f.text(), /missing project/); assert.equal(f.counts.creates, 0);
  f.flow.handleInput("\r"); await tick();
  assert.deepEqual(directories, [target.cwd, target.cwd]); assert.equal(f.counts.creates, 1); f.flow.close();
});

test("new locks reentry; submission cannot escape, rejection retries, shutdown discards late result", async () => {
  const f = fixture(); await tick(); const pending = deferred<{ cancelled: boolean }>(); let calls = 0;
  f.actions.newSession = () => { calls++; return pending.promise; };
  f.open("new"); f.open("new"); await tick(); f.flow.handleInput("\r"); f.flow.handleInput("\x1b");
  assert.equal(calls, 1); assert.equal(f.flow.browser.focused, false);
  pending.reject(new Error("host failure")); await tick(); assert.match(f.text(), /host failure/);
  const late = deferred<{ cancelled: boolean }>(); f.actions.newSession = () => late.promise;
  f.flow.handleInput("\r"); await tick(); f.flow.close(); const renders = f.counts.renders;
  late.resolve({ cancelled: false }); await tick(); f.flow.close();
  assert.equal(f.counts.done, 1); assert.equal(f.counts.renders, renders);
});

test("closing delete/fork preflight aborts signal and ignores late success/error", async () => {
  for (const action of ["delete", "fork"] as const) for (const shutdown of [false, true]) {
    const f = fixture(); await tick(); const pending = deferred<never>(); let signal: AbortSignal | undefined;
    if (action === "delete") f.actions.captureDelete = async (_session, abort) => { signal = abort; return pending.promise; };
    else f.actions.prepareFork = async (_session, abort) => { signal = abort; return pending.promise; };
    f.open(action); if (action === "fork") f.flow.handleInput("\r");
    if (shutdown) f.flow.close(); else f.flow.handleInput("\x03");
    assert.equal(signal?.aborted, true); const renders = f.counts.renders;
    pending.reject(new Error("late failure")); await tick();
    assert.equal(f.counts.renders, renders); assert.equal(f.counts.forks + f.counts.deletes, 0); f.flow.close();
  }
});

test("menu numbers only select; pin/rename/new/fork/delete dispatch exclusively", async () => {
  for (const index of [0, 1, 2, 3, 4]) {
    const f = fixture(); await tick(); let pin = 0, rename = 0;
    f.flow.browser.togglePin = async () => { pin++; };
    f.flow.browser.startRename = () => { rename++; };
    f.open("menu"); f.flow.handleInput(String(index + 1));
    assert.match(f.text(), /Session actions/); assert.equal(pin + rename + f.counts.creates + f.counts.captures, 0);
    f.flow.handleInput("\r"); await tick();
    if (index === 0) assert.equal(f.counts.creates, 1);
    if (index === 1) assert.match(f.text(), /Fork session/);
    if (index === 2) assert.equal(pin, 1);
    if (index === 3) assert.equal(rename, 1);
    if (index === 4) assert.equal(f.counts.captures, 1);
    f.flow.close();
  }
});

test("overlay does not feed search/rename input; menu pin label is read-only and late reads are ignored", async () => {
  const f = fixture(); await tick();
  f.flow.handleInput("\x1b[13~"); f.flow.handleInput("a");
  const before = plain(f.flow.browser.render(120).join("\n"));
  const pending = deferred<number | undefined>(); let writes = 0;
  f.flow.options.pins = { read: () => pending.promise, write: async () => { writes++; }, remove: async () => {} };
  f.open("menu"); f.flow.handleInput("z"); f.flow.handleInput("5"); f.flow.handleInput("\x1b");
  assert.equal(plain(f.flow.browser.render(120).join("\n")), before);
  const renders = f.counts.renders; pending.resolve(123); await tick(); assert.equal(f.counts.renders, renders); assert.equal(writes, 0);
  f.open("menu"); await tick(); assert.match(f.text(), /Unpin/); assert.equal(writes, 0);
  f.flow.handleInput("\x1b"); f.flow.browser.startRename(session("a"));
  const renameBefore = plain(f.flow.browser.render(120).join("\n"));
  f.open("delete"); await tick(); f.flow.handleInput("z"); f.flow.handleInput("\x03");
  assert.equal(plain(f.flow.browser.render(120).join("\n")), renameBefore); f.flow.close();
});

test("delete commit ignores escape and shutdown aborts signal without late list mutation", async () => {
  const f = fixture(); await tick(); const pending = deferred<string | undefined>(); let abort: AbortSignal | undefined;
  f.actions.delete = async (_target, _revision, signal) => { abort = signal; return pending.promise; };
  f.open("delete"); await tick(); f.flow.handleInput("2"); f.flow.handleInput("\r");
  f.flow.handleInput("\x1b"); f.flow.handleInput("\x03"); assert.equal(f.flow.browser.focused, false);
  f.flow.close(); assert.equal(abort?.aborted, true); const renders = f.counts.renders;
  pending.resolve("late warning"); await tick(); assert.equal(f.counts.renders, renders); assert.equal(f.counts.done, 1);
});

test("late successful preparation cannot reopen UI or dispatch a fork after back", async () => {
  const f = fixture(); await tick(); const pending = deferred<SessionInfo | undefined>();
  f.actions.prepareFork = () => pending.promise; f.open("fork"); f.flow.handleInput("\r"); f.flow.handleInput("\x1b");
  const renders = f.counts.renders; pending.resolve(f.prepared); await tick();
  assert.equal(f.counts.forks, 0); assert.equal(f.counts.renders, renders + 1, "persisted Fork is added without reopening a page");
  assert.equal(f.flow.phase, "browse");
  assert.match(plain(f.flow.browser.render(120).join("\n")), /3 tasks/);
  f.flow.handleInput("\x1b[B"); assert.equal(f.flow.browser.selected?.path, f.prepared.path); f.flow.close();
});

test("dialog compositing preserves ANSI browser, exact width/height and scrollable options/errors at tiny sizes", () => {
  let rows = 20, submissions = 0;
  const dialog = new ActionDialog({ theme, keybindings, height: () => rows, requestRender() {}, title: "删除中文", description: ["long path/".repeat(30)], choices: ["Cancel", "Delete"], select: () => { submissions++; }, back() {} });
  for (const height of [1, 2, 5, 20, 40]) for (const width of [1, 2, 5, 6, 20, 100]) {
    rows = height;
    dialog.error = "错误error";
    const base = Array.from({ length: height }, () => theme.style("B".repeat(width), { fg: parseColor("#010203") }));
    let lines = dialog.renderOver(base, width);
    assert.equal(lines.length, height); for (const line of lines) assert.equal(visibleWidth(line), width);
    dialog.handleInput("2"); lines = dialog.renderOver(base, width);
    assert.ok(plain(lines.join("\n")).includes("›"), `selected option visible at ${width}×${height}`);
    dialog.handleInput("\x1b[6~"); dialog.renderOver(base, width); dialog.handleInput("\x1b[5~");
  }
  assert.equal(submissions, 0);
});
