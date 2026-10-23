import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionBrowser } from "./browser.ts";
import { BrowserEditor } from "./editor.ts";
import { safeText } from "./model.ts";
import { ResumeFlow } from "./resume.ts";
import { validateResumeTarget } from "./resume-target.ts";
import { createRepository } from "./repository.ts";
import { createAutoTitler } from "./auto-title.ts";
import { createTitleStore } from "./titles.ts";
import { createFocusGuard } from "./overlay.ts";

const COMMAND = "session-browser";
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export default function sessionViewer(pi: ExtensionAPI): void {
  let browser: SessionBrowser | undefined;
  let screen: ResumeFlow | undefined;
  let opening = false;
  let shuttingDown = false;
  let editorFactory: EditorFactory | undefined;
  const titles = createTitleStore();
  const autoTitler = createAutoTitler(pi, (title) => browser?.refreshCurrent(title));
  const terminalStates = new Map<string, "Completed" | "Stopped" | "Error">();
  let outcome = "completed";

  pi.registerCommand(COMMAND, {
    description: "按项目、时间、模型或状态浏览、搜索并恢复 Pi 历史会话",
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
            done: () => done(),
          });
          browser = screen.browser;
          return screen;
        }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0, visible: guard.visible }, onHandle: guard.onHandle });
      } catch (error) {
        if (!shuttingDown) ctx.ui.notify(`会话浏览器：${safeText(String(error))}`, "error");
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

  pi.on("session_start", async (_event, ctx) => {
    shuttingDown = false;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const file = ctx.sessionManager.getSessionFile();
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
      ctx.ui.notify("PiSessionViewer 未替换已有自定义编辑器；请使用 /session-browser。", "info");
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
