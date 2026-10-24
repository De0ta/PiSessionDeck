import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions, SessionManager, type CustomEditor, type ExtensionCommandContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, ProcessTerminal, TuiMainScreen, TUI_KEYBINDINGS, type EditorTheme } from "@earendil-works/pi-tui";
import { deferred, header, jsonl, session, tick, user } from "./fixtures.ts";
import { createFocusGuard } from "../src/overlay.ts";
import type { ResumeFlow } from "../src/resume.ts";
import { createTitleStore } from "../src/titles.ts";

type EditorFactory = NonNullable<ReturnType<ExtensionCommandContext["ui"]["getEditorComponent"]>>;
async function harness(run: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-viewer-extension-"));
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  try { await run(await setup(dir)); } finally {
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    await rm(dir, { recursive: true, force: true });
  }
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
  const lifecycle = { newSessions: 0, forks: [] as { id: string; position?: string }[] };
  const order: string[] = [];
  const state = { idle: true, pending: false, draft: "", hasUI: true, mode: "tui", customCalls: 0 };
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
      custom: async () => { state.customCalls++; order.push("ui-closed"); },
      getEditorText: () => state.draft,
      confirm: async () => { throw new Error("Native confirmation dialogs must not be used"); },
    },
    switchSession: async (path: string) => { order.push("switch"); switches.push(path); return { cancelled: false }; },
    newSession: async () => { lifecycle.newSessions++; return { cancelled: false }; },
    fork: async (id: string, options?: { position?: string }) => { lifecycle.forks.push({ id, position: options?.position }); return { cancelled: false }; },
  } as unknown as ExtensionCommandContext; // Deliberately partial host double, not a production context cast.
  const emit = async (event: string, fields: Record<string, unknown> = {}) => {
    for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event, entries: [], ...fields }, ctx);
  };
  return { state, ctx, manager, emit, notices, switches, lifecycle, order, sent, command, handlers: extension.handlers, get factory() { return factory; } };
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
  assert.match(h.notices[0]!, /PiSessionDeck.*已有自定义编辑器/);
  h.state.hasUI = false;
  await h.command.handler("", h.ctx);
  assert.equal(h.state.customCalls, 0);
  h.state.hasUI = true; h.state.mode = "rpc";
  await h.command.handler("", h.ctx);
  assert.equal(h.state.customCalls, 0);
}));

test("真实入口连接独立转换页与只读预检；忙碌/队列/草稿和预检后状态变化留在页内", async () => harness(async (h) => {
  const target = session("target", { cwd: h.ctx.cwd, path: join(h.ctx.cwd, "target.jsonl") });
  await writeFile(target.path, JSON.stringify({ type: "session", version: 3, id: target.id, cwd: target.cwd, timestamp: new Date().toISOString() }) + "\n");
  // Isolate public discovery from real user history. Node tests in this file are sequential.
  const original = SessionManager.listAll;
  SessionManager.listAll = async () => [target];
  let drive: (component: ResumeFlow) => Promise<void> = async () => {};
  h.ctx.ui.custom = async <T>(factory: Parameters<typeof h.ctx.ui.custom<T>>[0]) => {
    const result = deferred<T>();
    const tui = new TuiMainScreen(new ProcessTerminal()); tui.requestRender = () => {};
    // Deliberately partial UI host double: production only consumes theme.style here.
    const theme = { style: (text: string) => text } as unknown as Parameters<typeof factory>[1];
    const keys = new KeybindingsManager(TUI_KEYBINDINGS) as unknown as Parameters<typeof factory>[2];
    const component = await factory(tui, theme, keys, (value) => { h.order.push("ui-closed"); result.resolve(value); });
    const flow = component as ResumeFlow; // Actual loader-created component, not a production cast.
    for (let i = 0; i < 100 && !flow.browser.selected; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(flow.browser.selected?.id, target.id);
    await drive(flow);
    return result.promise;
  };
  try {
    for (const kind of ["busy", "pending", "draft", "changed", "cancel", "success"]) {
      h.state.idle = kind !== "busy"; h.state.pending = kind === "pending"; h.state.draft = kind === "draft" ? " " : "";
      drive = async (flow) => {
        flow.handleInput("\r"); assert.equal(flow.phase, "resume");
        if (kind === "cancel") { flow.handleInput("\x1b"); assert.equal(flow.phase, "browse"); flow.close(); return; }
        flow.handleInput("\r");
        if (kind === "changed") h.state.pending = true;
        for (let i = 0; i < 30 && !h.order.includes("ui-closed"); i++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const text = flow.render(120).join("\n");
          if (text.includes("无法恢复")) break;
        }
        if (kind !== "success") { assert.match(flow.render(120).join("\n"), /无法恢复/); flow.close(); }
      };
      h.order.length = 0;
      await h.command.handler("", h.ctx);
      assert.equal(h.switches.length, kind === "success" ? 1 : 0, `${kind}: ${h.notices.join("; ")}`);
    }
    assert.deepEqual(h.order, ["switch", "ui-closed"]);
    assert.deepEqual(h.switches, [target.path]);
    assert.deepEqual(h.notices, [], "conversion errors stay inside the page, not native dialogs");
  } finally { SessionManager.listAll = original; }
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
  const overlay = { focused: false, render: () => ["PiSessionDeck"], handleInput() {}, invalidate() {} };
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

async function manage(h: Awaited<ReturnType<typeof setup>>, sessions: SessionInfo[], run: (flow: ResumeFlow) => Promise<void>): Promise<void> {
  const oldList = SessionManager.listAll;
  SessionManager.listAll = async () => sessions;
  let scenario: Promise<void> | undefined;
  h.ctx.ui.custom = ((factory) => {
    scenario = (async () => {
      const tui = new TuiMainScreen(new ProcessTerminal()); tui.requestRender = () => {};
      const theme = { style: (text: string) => text, fg: (_: string, text: string) => text, bold: (text: string) => text };
      const keys = new KeybindingsManager(TUI_KEYBINDINGS);
      const flow = factory(tui, theme as unknown as Parameters<typeof factory>[1], keys as unknown as Parameters<typeof factory>[2], () => {}) as ResumeFlow;
      try { await waitFor(() => !flow.render(160).join("\n").includes("Loading tasks...")); await run(flow); } finally { flow.close(); }
    })();
    return scenario;
  }) as ExtensionCommandContext["ui"]["custom"];
  try {
    await h.command!.handler("", h.ctx);
    // The command catches UI errors for notifications; assertions must still reject the test.
    assert.ok(scenario, "management UI was opened");
    await scenario;
  } finally { SessionManager.listAll = oldList; }
}
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), "asynchronous management operation completed");
}

test("入口新建保持草稿/队列保护，成功不发送模型消息；宿主shutdown后不访问旧状态", async () => harness(async (h) => {
  await manage(h, [], async (flow) => {
    h.state.draft = "save me"; flow.handleInput("n"); await tick();
    assert.equal(h.lifecycle.newSessions, 0); assert.equal(h.state.draft, "save me"); flow.handleInput("\x1b");
    h.state.draft = ""; h.state.pending = true; flow.handleInput("n"); await tick();
    assert.equal(h.lifecycle.newSessions, 0); flow.handleInput("\x1b"); h.state.pending = false;
    h.ctx.newSession = async () => {
      h.lifecycle.newSessions++;
      await h.emit("session_shutdown", { reason: "new" });
      h.ctx.isIdle = () => { throw new Error("outgoing runtime accessed"); };
      return { cancelled: false };
    };
    flow.handleInput("n"); await waitFor(() => h.lifecycle.newSessions === 1);
    assert.deepEqual(h.sent, []);
  });
}));

for (const menu of [false, true]) test(`入口${menu ? "New菜单" : "n快捷键"}在选中工作区创建独立空会话，不在当前聊天工作区创建`, async () => harness(async (h) => {
  const project = join(h.ctx.cwd, "..", "selected-project"); await mkdir(project);
  const file = join(project, "source.jsonl");
  const original = jsonl({ ...header, id: "selected-source", cwd: project }, user("u", null, "do not copy source prompt"));
  await writeFile(file, original);
  const source = session("selected-source", { path: file, cwd: project });
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    assert.equal(flow.browser.selected?.id, source.id);
    if (menu) { flow.handleInput("a"); flow.handleInput("1"); flow.handleInput("\r"); }
    else flow.handleInput("n");
    await waitFor(() => h.switches.length === 1);
    assert.equal(h.lifecycle.newSessions, 0); assert.deepEqual(h.lifecycle.forks, []); assert.deepEqual(h.sent, []);
    const created = SessionManager.open(h.switches[0]!);
    assert.equal(created.getCwd(), project); assert.notEqual(created.getSessionId(), source.id);
    assert.deepEqual(created.getEntries(), []); assert.equal(created.getHeader()?.parentSession, undefined);
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal(h.manager.getCwd(), h.ctx.cwd, "outgoing manager was not mutated to imitate a workspace switch");
  });
}));

test("入口跨工作区New切换触发shutdown后不访问旧运行时", async () => harness(async (h) => {
  const project = join(h.ctx.cwd, "..", "selected-project"); await mkdir(project);
  const source = session("selected", { cwd: project });
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    h.ctx.switchSession = async (file) => {
      h.switches.push(file);
      await h.emit("session_shutdown", { reason: "switch" });
      h.ctx.isIdle = () => { throw new Error("outgoing runtime accessed"); };
      return { cancelled: false };
    };
    flow.handleInput("n"); await waitFor(() => h.switches.length === 1);
    await tick(); assert.deepEqual(h.notices, []); assert.equal(h.lifecycle.newSessions, 0);
    assert.equal(SessionManager.open(h.switches[0]!).getCwd(), project);
  });
}));

test("入口选中同一工作区时仍走原生New", async () => harness(async (h) => {
  const source = session("same-project", { cwd: h.ctx.cwd });
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    assert.equal(flow.browser.selected?.id, source.id);
    flow.handleInput("n"); await waitFor(() => h.lifecycle.newSessions === 1);
    assert.deepEqual(h.switches, []); assert.deepEqual(h.sent, []);
  });
}));

test("入口跨工作区New在异步创建后重检队列，重试复用空会话", async () => harness(async (h) => {
  const project = join(h.ctx.cwd, "..", "selected-project"); await mkdir(project);
  const source = session("selected", { cwd: project });
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    const prepare = flow.options.actions!.prepareNew;
    let prepares = 0; let created: SessionInfo | undefined;
    flow.options.actions!.prepareNew = async (directory, signal) => {
      prepares++; created = await prepare(directory, signal); h.state.pending = true; return created;
    };
    flow.handleInput("n");
    await waitFor(() => flow.render(140).join("\n").includes("排队消息"));
    assert.ok(created); assert.deepEqual(h.switches, []); assert.equal(h.lifecycle.newSessions, 0);
    h.state.pending = false; flow.handleInput("\r"); await waitFor(() => h.switches.length === 1);
    assert.equal(prepares, 1); assert.equal(h.switches[0], created.path);
  });
}));

test("入口New拒绝缺失工作区而不回退到当前聊天目录", async () => harness(async (h) => {
  const source = session("missing-project", { cwd: join(h.ctx.cwd, "missing-project") });
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    flow.handleInput("n"); await waitFor(() => flow.render(160).join("\n").includes("ENOENT"));
    assert.equal(h.lifecycle.newSessions, 0); assert.deepEqual(h.switches, []); assert.deepEqual(h.sent, []);
    flow.handleInput("\x1b"); assert.equal(flow.browser.selected?.id, source.id);
  });
}));

for (const directory of ["", ".", "relative/project"]) test(`入口New拒绝无效工作区${JSON.stringify(directory)}，包括规范化后与当前项目相同的相对路径`, async () => harness(async (h) => {
  h.ctx.cwd = process.cwd();
  const source = session("invalid-workspace", { cwd: directory });
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    assert.equal(flow.browser.selected?.id, source.id);
    flow.handleInput("n");
    await waitFor(() => flow.render(160).join("\n").includes("不是绝对路径"));
    assert.equal(h.lifecycle.newSessions, 0); assert.deepEqual(h.switches, []);
  });
}));

test("入口当前Fork使用at保留末次回复，新runtime追加Fork名称且不再请求标题模型", async () => harness(async (h) => {
  const file = join(h.ctx.cwd, "current.jsonl"); h.manager.getSessionFile = () => file;
  const id = h.manager.appendMessage({ role: "user", content: "当前提问", timestamp: Date.now() });
  await writeFile(file, jsonl(h.manager.getHeader(), ...h.manager.getEntries()));
  const current = session(h.manager.getSessionId(), { path: file, cwd: h.ctx.cwd });
  await manage(h, [current], async (flow) => {
    flow.handleInput("f"); flow.handleInput("\r"); await waitFor(() => h.lifecycle.forks.length === 1);
    assert.deepEqual(h.lifecycle.forks, [{ id, position: "at" }]); assert.deepEqual(h.switches, []);
  });
  h.manager.appendSessionInfo("Manual source");
  await h.emit("session_start", { reason: "fork" });
  assert.equal(h.manager.getSessionName(), "Manual source · Fork");
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.manager.getSessionName(), "Manual source · Fork"); assert.deepEqual(h.sent, []);
}));

test("入口历史Fork只读创建一次并直接打开副本，宿主拒绝后再次确认复用副本", async () => harness(async (h) => {
  const file = join(h.ctx.cwd, "history.jsonl");
  const original = jsonl({ ...header, id: "history", cwd: h.ctx.cwd }, user("u", null, "source prompt"));
  await writeFile(file, original);
  const source = session("history", { path: file, cwd: h.ctx.cwd });
  await createTitleStore().write(source, "Viewer alias");
  h.ctx.switchSession = async (path) => { h.switches.push(path); return { cancelled: true }; };
  await manage(h, [source], async (flow) => {
    for (let i = 0; i < 5 && flow.browser.selected?.id !== source.id; i++) flow.handleInput("\x1b[B");
    assert.equal(flow.browser.selected?.id, source.id);
    flow.handleInput("f"); flow.handleInput("\r"); await waitFor(() => h.switches.length === 1 && flow.render(120).join("\n").includes("已创建未打开"));
    const created = h.switches[0]!; assert.notEqual(created, file); assert.equal(await readFile(file, "utf8"), original);
    assert.match(await readFile(created, "utf8"), /Viewer alias · Fork/);
    flow.handleInput("\r"); await waitFor(() => h.switches.length === 2 && flow.render(120).join("\n").includes("已创建未打开"));
    assert.equal(h.switches[1], created); assert.deepEqual(h.lifecycle.forks, []); assert.equal(h.lifecycle.newSessions, 0);
    flow.handleInput("\x1b");
  });
}));
