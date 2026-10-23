import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions, SessionManager, type CustomEditor, type ExtensionCommandContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, ProcessTerminal, TuiMainScreen, TUI_KEYBINDINGS, type EditorTheme } from "@earendil-works/pi-tui";
import { deferred, session, tick } from "./fixtures.ts";

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
  const ctx = {
    get hasUI() { return state.hasUI; }, get mode() { return state.mode; }, cwd, sessionManager: SessionManager.inMemory(cwd),
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
  const emit = async (event: string) => {
    for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event }, ctx);
  };
  return { state, ctx, emit, notices, switches, order, sent, command, get factory() { return factory; } };
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
