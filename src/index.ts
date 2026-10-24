import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionBrowser } from "./browser.ts";
import { BrowserEditor } from "./editor.ts";
import { isUnsaved, pathKey, safeText, summarizeTitle } from "./model.ts";
import { ResumeFlow } from "./resume.ts";
import { validateResumeTarget } from "./resume-target.ts";
import { createRepository, firstExchangeFromManager } from "./repository.ts";
import { createAutoTitler } from "./auto-title.ts";
import { createTitleStore } from "./titles.ts";
import { createFocusGuard } from "./overlay.ts";
import { createPinStore } from "./pins.ts";
import { captureSessionRevision, deleteSession, forkHistorySession } from "./management.ts";
import { createEmptySession, validateNewSessionCwd } from "./new-session.ts";

const COMMAND = "session-browser";
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export default function sessionDeck(pi: ExtensionAPI): void {
  let browser: SessionBrowser | undefined;
  let screen: ResumeFlow | undefined;
  let opening = false;
  let shuttingDown = false;
  let editorFactory: EditorFactory | undefined;
  const titles = createTitleStore();
  const pins = createPinStore();
  const autoTitler = createAutoTitler(pi, (title) => browser?.refreshCurrent(title));
  const terminalStates = new Map<string, "Completed" | "Stopped" | "Error">();
  let outcome = "completed";

  pi.registerCommand(COMMAND, {
    description: "PiSessionDeck：按项目、时间、模型或状态浏览、搜索并管理 Pi 会话",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI || opening || shuttingDown) return;
      opening = true;
      try {
        const guard = createFocusGuard(() => screen?.close());
        await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
          screen = new ResumeFlow({
            cwd: ctx.cwd,
            currentFile: ctx.sessionManager.getSessionFile(),
            currentStatus: () => !ctx.isIdle() ? "Working" : ctx.hasPendingMessages() ? "Queued" : terminalStates.get(ctx.sessionManager.getSessionId()) ?? "Ready",
            currentModel: () => ctx.sessionManager.buildSessionProjection().model ?? undefined,
            repository: createRepository(ctx, (name) => pi.setSessionName(name), titles),
            pins,
            markdownTheme: getMarkdownTheme(),
            theme, keybindings,
            requestRender: () => tui.requestRender(),
            height: () => Math.max(1, tui.terminal.rows),
            canResume: () => {
              if (shuttingDown) return "会话正在关闭，已取消恢复。";
              if (!ctx.isIdle() || ctx.hasPendingMessages()) return "当前任务尚未结束或有排队消息，请等待完成后重试。";
              if (ctx.ui.getEditorText() !== "") return "当前编辑器有草稿，请先返回聊天保存或清空，再恢复其他会话。";
              return undefined;
            },
            validate: validateResumeTarget,
            resume: (selection) => ctx.switchSession(selection.path),
            actions: {
              prepareNew: async (cwd, signal) => {
                const currentCwd = ctx.cwd;
                await validateNewSessionCwd(cwd, signal);
                return pathKey(cwd) === pathKey(currentCwd) ? undefined : createEmptySession(cwd, signal);
              },
              newSession: async (prepared) => {
                if (!prepared) return ctx.newSession();
                await validateResumeTarget(prepared, new AbortController().signal);
                if (shuttingDown) throw new Error("会话正在关闭。");
                if (!ctx.isIdle() || ctx.hasPendingMessages() || ctx.ui.getEditorText() !== "") throw new Error("当前任务、队列或草稿已变化，请处理后重试。");
                return ctx.switchSession(prepared.path);
              },
              prepareFork: async (selection, signal) => {
                if (isUnsaved(selection)) throw new Error("会话尚未保存，请先发送一条消息，再 Fork。");
                await validateResumeTarget(selection, signal);
                if (pathKey(selection.path) === pathKey(ctx.sessionManager.getSessionFile() ?? "")) {
                  if (selection.id !== ctx.sessionManager.getSessionId() || !ctx.sessionManager.getLeafId()) throw new Error("当前会话没有可分叉的内容。");
                  return undefined;
                }
                const alias = await titles.read(selection);
                return forkHistorySession(selection, signal, alias);
              },
              fork: async (selection, prepared) => {
                if (prepared) {
                  await validateResumeTarget(prepared, new AbortController().signal);
                  // This asynchronous preflight can outlive an idle state.
                  if (shuttingDown) throw new Error("会话正在关闭。");
                  if (!ctx.isIdle() || ctx.hasPendingMessages() || ctx.ui.getEditorText() !== "") throw new Error("当前任务、队列或草稿已变化，请处理后重试。");
                  return ctx.switchSession(prepared.path);
                }
                const leaf = ctx.sessionManager.getLeafId();
                if (selection.id !== ctx.sessionManager.getSessionId() || !leaf) throw new Error("当前会话已变化，请刷新后重试。");
                return ctx.fork(leaf, { position: "at" });
              },
              captureDelete: captureSessionRevision,
              delete: async (selection, revision, signal) => {
                if (pathKey(selection.path) === pathKey(ctx.sessionManager.getSessionFile() ?? "")) throw new Error("不能删除当前会话，请先新建或切换。");
                await deleteSession(selection, revision, signal);
                const cleanup = await Promise.allSettled([titles.remove(selection), pins.remove(selection)]);
                return cleanup.some((result) => result.status === "rejected") ? "会话已删除，但部分本地标题或置顶缓存清理失败。" : undefined;
              },
            },
            done: () => done(),
          });
          browser = screen.browser;
          return screen;
        }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0, visible: guard.visible }, onHandle: guard.onHandle });
      } catch (error) {
        if (!shuttingDown) ctx.ui.notify(`PiSessionDeck：${safeText(String(error))}`, "error");
      } finally {
        screen?.close();
        screen = undefined;
        browser = undefined;
        opening = false;
      }
    },
  });

  pi.on("agent_start", (_event, ctx) => {
    outcome = "completed";
    terminalStates.delete(ctx.sessionManager.getSessionId());
    browser?.refreshCurrent();
  });
  pi.on("agent_before_settle", (event) => {
    outcome = event.outcome;
  });
  pi.on("agent_settled", (event, ctx) => {
    terminalStates.set(ctx.sessionManager.getSessionId(), event.aborted ? "Stopped" : outcome === "error" ? "Error" : "Completed");
    // Settlement runs after ALL boundary hooks and their edits have committed.
    // Naming in before_settle would leak text redacted by a later extension.
    if (ctx.mode === "tui" && !event.aborted && outcome === "completed") autoTitler.start(ctx);
    browser?.refreshCurrent(pi.getSessionName());
  });
  // message_end extensions run BEFORE persistence. These events run after the
  // relevant message append, including before a potentially long-running tool.
  pi.on("model_select", () => { browser?.refreshCurrent(); });
  pi.on("tool_execution_start", () => { browser?.refreshCurrent(); });
  pi.on("turn_end", () => { browser?.refreshCurrent(); });

  pi.on("session_start", async (event, ctx) => {
    shuttingDown = false;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const file = ctx.sessionManager.getSessionFile();
    // Run on the replacement runtime, never call the outgoing extension API
    // after ctx.fork(). Native forks otherwise inherit the source's exact name.
    if (event.reason === "fork") {
      const name = pi.getSessionName() || summarizeTitle(firstExchangeFromManager(ctx.sessionManager).prompt || "Untitled task");
      pi.setSessionName(`${Array.from(safeText(name)).slice(0, 150).join("")} · Fork`);
    }
    const originalName = pi.getSessionName();
    const importAlias = async () => {
      if (!file) return;
      const identity = { path: file, id: ctx.sessionManager.getSessionId() };
      const alias = await titles.read(identity);
      if (!alias || shuttingDown || ctx.sessionManager.getSessionFile() !== file) return;
      // Promote the viewer alias only after restoring that session as current.
      // A concurrent /name edit wins; never rewrite an inactive history file.
      if (pi.getSessionName() === originalName) pi.setSessionName(alias);
      await titles.remove(identity);
    };
    const existing = ctx.ui.getEditorComponent();
    if (existing && existing !== editorFactory) {
      ctx.ui.notify("PiSessionDeck 未替换已有自定义编辑器；请使用 /session-browser。", "info");
      await importAlias().catch(() => {});
      return;
    }
    editorFactory = (tui, theme, keybindings) => new BrowserEditor(tui, theme, keybindings, () => {
      if (!opening && !shuttingDown) {
        // A known extension command, not a model prompt. This flag is essential.
        pi.sendUserMessage(`/${COMMAND}`, { expandPromptTemplates: true });
      }
    });
    ctx.ui.setEditorComponent(editorFactory);
    await importAlias().catch(() => {});
  });

  pi.on("session_shutdown", (_event, ctx) => {
    shuttingDown = true;
    autoTitler.cancel();
    screen?.close();
    screen = undefined;
    browser = undefined;
    if (ctx.hasUI && editorFactory && ctx.ui.getEditorComponent() === editorFactory) ctx.ui.setEditorComponent(undefined);
    editorFactory = undefined;
  });
}
