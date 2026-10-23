import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions, SessionManager, type CustomEditor, type ExtensionCommandContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, ProcessTerminal, TuiMainScreen, TUI_KEYBINDINGS, type EditorTheme } from "@earendil-works/pi-tui";
import { deferred, session, tick } from "./fixtures.ts";
import { createFocusGuard } from "../src/overlay.ts";

type EditorFactory = NonNullable<ReturnType<ExtensionCommandContext["ui"]["getEditorComponent"]>>;
async function harness(run: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-viewer-extension-"));
  try { await run(await setup(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function setup(dir: string) {
  const cwd = join(dir, "project");
  const agent = join(dir, "agent");
  await mkdir(cwd); await mkdir(agent);
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], cwd, agent);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0]!;
  const command = extension.commands.get("session-browser");
  assert.ok(command);
  const sent: unknown[] = [];
  loaded.runtime.sendUserMessage = (content, options) => { sent.push({ content, options }); };
  let factory: EditorFactory | undefined;
  const notices: string[] = [];
  const switches: string[] = [];
  const order: string[] = [];
  const state = { idle: true, pending: false, confirm: true, hasUI: true, mode: "tui", selection: undefined as SessionInfo | undefined, customCalls: 0, duringConfirm: () => {} };
  const manager = SessionManager.inMemory(cwd);
  loaded.runtime.getSessionName = () => manager.getSessionName();
  loaded.runtime.setSessionName = (name) => { manager.appendSessionInfo(name); };
  loaded.runtime.appendEntry = (customType, data) => { manager.appendCustomEntry(customType, data); };
  const ctx = {
    get hasUI() { return state.hasUI; }, get mode() { return state.mode; }, cwd, sessionManager: manager,
    isIdle: () => state.idle, hasPendingMessages: () => state.pending,
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (value: EditorFactory | undefined) => { factory = value; },
      notify: (text: string) => { notices.push(text); },
      custom: async () => { state.customCalls++; order.push("ui-closed"); return state.selection; },
      confirm: async () => { order.push("confirm"); state.duringConfirm(); return state.confirm; },
    },
    switchSession: async (path: string) => { order.push("switch"); switches.push(path); return { cancelled: false }; },
  } as unknown as ExtensionCommandContext; // Deliberately partial host double, not a production context cast.
  const emit = async (event: string, fields: Record<string, unknown> = {}) => {
    for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event, entries: [], ...fields }, ctx);
  };
  return { state, ctx, manager, emit, notices, switches, order, sent, command, handlers: extension.handlers, get factory() { return factory; } };
}

test("真实Pi加载器加载入口；编辑器桥接已注册命令，保留文字与原生提交", async () => harness(async (h) => {
  await h.emit("session_start");
  assert.ok(h.factory);
  const identity = (text: string) => text;
  const theme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
  const tui = new TuiMainScreen(new ProcessTerminal()); // Never start the terminal or attach stdin.
  tui.requestRender = () => {};
  const keybindings = new KeybindingsManager({ ...TUI_KEYBINDINGS,
    "app.clipboard.pasteImage": { defaultKeys: "ctrl+v" },
    "app.interrupt": { defaultKeys: "escape" }, "app.exit": { defaultKeys: "ctrl+d" },
  });
  const editor = h.factory(tui, theme, keybindings as unknown as Parameters<EditorFactory>[2]);
  assert.ok(editor.handleInput);
  editor.handleInput("\x1b[D");
  assert.deepEqual(h.sent, [{ content: "/session-browser", options: { expandPromptTemplates: true } }]);
  editor.setText("draft");
  editor.handleInput("\x1b[D");
  assert.equal(editor.getText(), "draft");
  assert.equal(h.sent.length, 1);
  let submitted = "";
  editor.onSubmit = (text) => { submitted = text; };
  editor.handleInput("\r");
  assert.equal(submitted, "draft");
  const custom = editor as CustomEditor;
  custom.setText("");
  custom.setAutocompleteProvider({
    getSuggestions: async () => ({ items: [{ value: "alpha", label: "alpha" }, { value: "beta", label: "beta" }], prefix: "" }),
    applyCompletion: (_lines, _line, _col, item) => ({ lines: [item.value], cursorLine: 0, cursorCol: item.value.length }),
    shouldTriggerFileCompletion: () => true,
  });
  custom.handleInput("\t"); await tick();
  assert.equal(custom.isShowingAutocomplete(), true);
  custom.handleInput("\x1b[D");
  assert.equal(h.sent.length, 1, "autocomplete left must not dispatch browser");
  custom.handleInput("\x1b");
  custom.setText(""); custom.handleInput("\t"); await tick();
  submitted = "";
  custom.handleInput("\r");
  assert.equal(custom.getText(), "alpha");
  assert.equal(submitted, "", "autocomplete Enter must complete, not submit");
  await h.emit("session_shutdown");
  assert.equal(h.factory, undefined);
}));

test("已有编辑器不被覆盖；非UI命令直接退出", async () => harness(async (h) => {
  const other: EditorFactory = () => { throw new Error("should not be instantiated"); };
  h.ctx.ui.setEditorComponent(other);
  await h.emit("session_start");
  assert.equal(h.factory, other);
  assert.match(h.notices[0]!, /已有自定义编辑器/);
  h.state.hasUI = false;
  await h.command.handler("", h.ctx);
  assert.equal(h.state.customCalls, 0);
  h.state.hasUI = true; h.state.mode = "rpc";
  await h.command.handler("", h.ctx);
  assert.equal(h.state.customCalls, 0);
}));

test("恢复必须先关闭UI、确认、切换；忙碌或取消不切换", async () => harness(async (h) => {
  h.state.selection = session("target");
  h.state.idle = false;
  await h.command.handler("", h.ctx);
  assert.equal(h.switches.length, 0);
  assert.match(h.notices[0]!, /任务尚未结束/);
  h.state.idle = true;
  h.state.confirm = false;
  await h.command.handler("", h.ctx);
  assert.equal(h.switches.length, 0);
  h.state.confirm = true;
  h.order.length = 0;
  await h.command.handler("", h.ctx);
  assert.deepEqual(h.order, ["ui-closed", "confirm", "switch"]);
  assert.deepEqual(h.switches, [h.state.selection.path]);
  h.state.pending = true;
  await h.command.handler("", h.ctx);
  assert.equal(h.switches.length, 1);
  h.state.pending = false;
  h.state.duringConfirm = () => { h.state.idle = false; };
  await h.command.handler("", h.ctx);
  assert.equal(h.switches.length, 1);
  h.state.idle = true;
  h.state.duringConfirm = () => { h.state.pending = true; };
  await h.command.handler("", h.ctx);
  assert.equal(h.switches.length, 1);
  assert.match(h.notices.at(-1)!, /状态已改变/);
}));

test("浏览器使用终端100%覆盖层，不再替换聊天主组件", async () => harness(async (h) => {
  assert.equal(h.handlers.has("message_end"), false, "pre-persistence event must not read stale details");
  assert.ok(h.handlers.has("tool_execution_start"));
  assert.ok(h.handlers.has("turn_end"));
  h.ctx.ui.custom = async <T>(_factory: Parameters<typeof h.ctx.ui.custom>[0], options?: Parameters<typeof h.ctx.ui.custom>[1]) => {
    assert.equal(options?.overlay, true);
    assert.ok(options?.overlayOptions && typeof options.overlayOptions !== "function");
    const { visible, ...layout } = options.overlayOptions;
    assert.deepEqual(layout, { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 });
    assert.equal(typeof visible, "function");
    assert.equal(typeof options.onHandle, "function");
    return undefined as T;
  };
  await h.command.handler("", h.ctx);
  assert.equal(h.switches.length, 0);
}));

test("原生覆盖层关闭后恢复原编辑器焦点与底层内容", () => {
  const terminal = new ProcessTerminal();
  terminal.write = () => {}; terminal.hideCursor = () => {}; terminal.showCursor = () => {};
  const tui = new TuiMainScreen(terminal); // Never write to or attach stdin of the real terminal.
  tui.requestRender = () => {};
  const editor = { focused: false, render: () => ["UNCHANGED DRAFT"], handleInput() {}, invalidate() {} };
  const overlay = { focused: false, render: () => ["Session manager"], handleInput() {}, invalidate() {} };
  tui.addChild(editor);
  tui.setFocus(editor);
  const handle = tui.showOverlay(overlay, { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 });
  assert.equal(tui.getFocusedComponent(), overlay);
  assert.equal(tui.hasOverlay(), true);
  handle.hide();
  assert.equal(tui.getFocusedComponent(), editor);
  assert.equal(editor.focused, true);
  assert.equal(tui.hasOverlay(), false);
  assert.deepEqual(tui.render(120), ["UNCHANGED DRAFT"]);
});

test("普通权限弹窗获得焦点时，整屏覆盖立即让出并安全关闭", async () => {
  const terminal = new ProcessTerminal();
  terminal.write = () => {}; terminal.hideCursor = () => {}; terminal.showCursor = () => {};
  const tui = new TuiMainScreen(terminal);
  tui.requestRender = () => {};
  const editor = { render: () => ["EDITOR"], handleInput() {}, invalidate() {} };
  const permission = { render: () => ["Permission?"], handleInput() {}, invalidate() {} };
  const overlay = { render: () => ["BROWSER"], handleInput() {}, invalidate() {} };
  tui.addChild(editor); tui.addChild(permission); tui.setFocus(editor);
  let closed = 0;
  const guard = createFocusGuard(() => { closed++; handle.hide(); });
  const handle = tui.showOverlay(overlay, { visible: guard.visible });
  guard.onHandle(handle);
  assert.equal(guard.visible(), true);
  tui.setFocus(permission);
  assert.equal(guard.visible(), false, "hide in the same render, before the microtask");
  assert.equal(guard.visible(), false);
  await tick();
  assert.equal(closed, 1);
  assert.equal(tui.hasOverlay(), false);
  assert.equal(tui.getFocusedComponent(), permission, "never steal focus from the permission dialog");
});

test("重复命令不重入；shutdown后延迟返回不会切换或覆盖其他编辑器", async () => harness(async (h) => {
  await h.emit("session_start");
  const pending = deferred<SessionInfo | undefined>();
  h.ctx.ui.custom = async <T>() => { h.state.customCalls++; return pending.promise as Promise<T>; };
  const first = h.command.handler("", h.ctx);
  await h.command.handler("", h.ctx);
  assert.equal(h.state.customCalls, 1);
  const other: EditorFactory = () => { throw new Error("not instantiated"); };
  h.ctx.ui.setEditorComponent(other);
  await h.emit("session_shutdown");
  assert.equal(h.factory, other);
  pending.resolve(session("late"));
  await first;
  assert.equal(h.switches.length, 0);
}));

test("settled后才启动后台模型命名，事件不等待模型，不向主对话发送消息", async () => harness(async (h) => {
  const pending = deferred<{ stopReason: "stop"; content: { type: "text"; text: string }[] }>();
  let requests = 0;
  Object.defineProperties(h.ctx, {
    model: { value: { id: "fake", provider: "fake" } },
    modelRegistry: { value: { streamSimple: () => { requests++; return { result: () => pending.promise }; } } },
  });
  h.manager.appendMessage({ role: "user", content: "请修复浏览器", timestamp: 1 });
  await h.emit("agent_before_settle", { outcome: "completed", continue: false });
  assert.equal(requests, 0);
  await h.emit("agent_settled", { aborted: false });
  assert.equal(requests, 1);
  assert.equal(h.manager.getSessionName(), "请修复浏览器", "settled returned while naming still pending");
  pending.resolve({ stopReason: "stop", content: [{ type: "text", text: "会话浏览器修复" }] }); await tick();
  assert.equal(h.manager.getSessionName(), "会话浏览器修复");
  assert.deepEqual(h.sent, []);
}));

test("shutdown中止尚未完成的命名并丢弃迟到结果", async () => harness(async (h) => {
  const pending = deferred<{ stopReason: "stop"; content: { type: "text"; text: string }[] }>();
  let signal: AbortSignal | undefined;
  Object.defineProperties(h.ctx, {
    model: { value: { id: "fake", provider: "fake" } },
    modelRegistry: { value: { streamSimple: (_model: unknown, _context: unknown, options: { signal: AbortSignal }) => { signal = options.signal; return { result: () => pending.promise }; } } },
  });
  h.manager.appendMessage({ role: "user", content: "Fallback", timestamp: 1 });
  await h.emit("agent_before_settle", { outcome: "completed", continue: false });
  await h.emit("agent_settled", { aborted: false });
  await h.emit("session_shutdown"); assert.equal(signal?.aborted, true);
  pending.resolve({ stopReason: "stop", content: [{ type: "text", text: "Late" }] }); await tick();
  assert.equal(h.manager.getSessionName(), "Fallback");
}));

test("无模型时首次成功交互回退本地标题且仅一次，不发送主对话消息；手动标题优先", async () => harness(async (h) => {
  h.manager.appendMessage({ role: "user", content: "修复会话浏览器。这里是后续细节", timestamp: Date.now() });
  await h.emit("agent_before_settle", { outcome: "aborted", continue: false });
  await h.emit("agent_settled", { aborted: true });
  assert.equal(h.manager.getSessionName(), undefined);
  await h.emit("agent_before_settle", { outcome: "error", continue: false });
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getSessionName(), undefined);
  await h.emit("agent_before_settle", { outcome: "completed", continue: true });
  assert.equal(h.manager.getSessionName(), undefined);
  await h.emit("agent_before_settle", { outcome: "completed", continue: false });
  assert.equal(h.manager.getSessionName(), undefined, "no name until all boundary edits commit");
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getSessionName(), "修复会话浏览器");
  const count = h.manager.getEntries().length;
  await h.emit("agent_before_settle", { outcome: "completed", continue: false });
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getEntries().length, count);
  assert.deepEqual(h.sent, []);
  h.manager.appendSessionInfo("User title");
  await h.emit("agent_before_settle", { outcome: "completed", continue: false });
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getSessionName(), "User title");
}));

test("待提交上下文删除不泄漏到自动标题", async () => harness(async (h) => {
  const id = h.manager.appendMessage({ role: "user", content: "secret original prompt", timestamp: Date.now() });
  await h.emit("agent_before_settle", { outcome: "completed", continue: false, entries: [{ type: "context_edit", targetId: id, replacement: null }] });
  assert.equal(h.manager.getSessionName(), undefined);
  h.manager.appendContextEdit(id, null);
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getSessionName(), undefined);
  assert.ok(!h.manager.getEntries().some((e) => e.type === "session_info"));
}));

test("晚于本扩展的boundary删除在自动命名前提交", async () => harness(async (h) => {
  const id = h.manager.appendMessage({ role: "user", content: "secret first prompt", timestamp: Date.now() });
  await h.emit("agent_before_settle", { outcome: "completed", continue: false });
  assert.equal(h.manager.getSessionName(), undefined);
  // Simulate a later extension returning a deletion, committed by the host.
  h.manager.appendContextEdit(id, null);
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getSessionName(), undefined);
  assert.ok(!h.manager.getEntries().some((e) => e.type === "session_info"));
}));
