import type { ExtensionAPI, ExtensionContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionBrowser } from "./browser.ts";
import { BrowserEditor } from "./editor.ts";
import { pathKey, safeText } from "./model.ts";
import { createRepository } from "./repository.ts";
import { createFocusGuard } from "./overlay.ts";

const COMMAND = "session-browser";
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export default function sessionViewer(pi: ExtensionAPI): void {
  let browser: SessionBrowser | undefined;
  let opening = false;
  let shuttingDown = false;
  let editorFactory: EditorFactory | undefined;

  pi.registerCommand(COMMAND, {
    description: "按项目浏览、搜索、预览并恢复 Pi 历史会话",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI || opening || shuttingDown) return;
      opening = true;
      try {
        const guard = createFocusGuard(() => browser?.close());
        const selection = await ctx.ui.custom<SessionInfo | undefined>((tui, theme, keybindings, done) => {
          browser = new SessionBrowser({
            cwd: ctx.cwd,
            currentFile: ctx.sessionManager.getSessionFile(),
            currentStatus: () => !ctx.isIdle() ? "Working" : ctx.hasPendingMessages() ? "Queued" : "Ready",
            repository: createRepository(ctx),
            theme, keybindings,
            requestRender: () => tui.requestRender(),
            height: () => Math.max(1, tui.terminal.rows),
            done,
          });
          return browser;
        }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0, visible: guard.visible }, onHandle: guard.onHandle });
        browser = undefined;
        if (!selection || shuttingDown) return;
        if (pathKey(selection.path) === pathKey(ctx.sessionManager.getSessionFile() ?? "")) return;
        if (!ctx.isIdle() || ctx.hasPendingMessages()) {
          ctx.ui.notify("当前任务尚未结束或有排队消息。请先停止或等待完成，再恢复其他会话。", "warning");
          return;
        }
        const confirmed = await ctx.ui.confirm(
          "恢复历史会话？",
          `目标项目：${safeText(selection.cwd)}\n恢复会替换当前会话和项目运行时；当前草稿不会带过去。\n请确认没有其他 Pi 进程正在写入该会话（轻量版无法检测）。`,
        );
        if (!confirmed || shuttingDown) return;
        if (!ctx.isIdle() || ctx.hasPendingMessages()) {
          ctx.ui.notify("当前任务状态已改变，已取消恢复；请等待任务和消息队列结束。", "warning");
          return;
        }
        // The browser is already closed. Successful switching invalidates this ctx.
        await ctx.switchSession(selection.path);
        return;
      } catch (error) {
        if (!shuttingDown) ctx.ui.notify(`会话浏览器：${safeText(String(error))}`, "error");
      } finally {
        browser?.close();
        browser = undefined;
        opening = false;
      }
    },
  });

  pi.on("agent_start", () => { browser?.refreshCurrent(); });
  pi.on("agent_settled", () => { browser?.refreshCurrent(); });
  // message_end extensions run BEFORE persistence. These events run after the
  // relevant message append, including before a potentially long-running tool.
  pi.on("tool_execution_start", () => { browser?.refreshCurrent(); });
  pi.on("turn_end", () => { browser?.refreshCurrent(); });

  pi.on("session_start", (_event, ctx) => {
    shuttingDown = false;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const existing = ctx.ui.getEditorComponent();
    if (existing && existing !== editorFactory) {
      ctx.ui.notify("PiSessionViewer 未替换已有自定义编辑器；请使用 /session-browser。", "info");
      return;
    }
    editorFactory = (tui, theme, keybindings) => new BrowserEditor(tui, theme, keybindings, () => {
      if (!opening && !shuttingDown) {
        // A known extension command, not a model prompt. This flag is essential.
        pi.sendUserMessage(`/${COMMAND}`, { expandPromptTemplates: true });
      }
    });
    ctx.ui.setEditorComponent(editorFactory);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    shuttingDown = true;
    browser?.close();
    browser = undefined;
    if (ctx.hasUI && editorFactory && ctx.ui.getEditorComponent() === editorFactory) ctx.ui.setEditorComponent(undefined);
    editorFactory = undefined;
  });
}
