import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, parseColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import { SessionBrowser, type BrowserOptions } from "./browser.ts";
import { COLORS, painter, type Ink } from "./details.ts";
import { pathKey, safeText, sessionTitle } from "./model.ts";
import { ActionDialog } from "./action-dialog.ts";
import type { SessionRevision } from "./management.ts";

const PANEL = "#262626";
type PageOptions = Pick<BrowserOptions, "cwd" | "theme" | "height" | "keybindings" | "requestRender"> & {
  session: SessionInfo;
  mode?: "fork";
  confirm(): void;
  back(): void;
};

/** A complete page, not a dialog: only its content block has a gray background. */
export class ResumePage implements Component {
  private selected = 0;
  private offset = 0;
  private manualScroll = false;
  busy = false;
  committing = false;
  prepared: SessionInfo | undefined;
  preparationComplete = false;
  private _error = "";
  private errorNeedsAttention = false;
  get error(): string { return this._error; }
  set error(value: string) { this._error = value; this.errorNeedsAttention = !!value; }
  constructor(readonly options: PageOptions) {}
  invalidate(): void {}
  handleInput(data: string): void {
    if (this.committing) return; // Pi exposes no cancellation once switchSession has been dispatched.
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.options.back(); return; }
    if (this.busy) return;
    if (this.options.keybindings.matches(data, "tui.select.up") || this.options.keybindings.matches(data, "tui.select.down")) {
      this.selected = this.options.keybindings.matches(data, "tui.select.up") ? 0 : 1;
      this.manualScroll = false;
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
      this.offset += (matchesKey(data, "pageUp") ? -1 : 1) * Math.max(1, this.options.height() - 2);
      this.manualScroll = true;
    } else if (matchesKey(data, "enter") || matchesKey(data, "right")) {
      if (this.selected === 0) this.options.confirm(); else this.options.back();
      return;
    } else if (data === "1" || data === "2") {
      this.selected = data === "1" ? 0 : 1;
      this.manualScroll = false;
    }
    this.options.requestRender();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(1, this.options.height());
    const margin = width >= 6 ? 1 : 0;
    const columns = width - margin * 2;
    const inset = columns >= 6 ? 2 : 0;
    const contentWidth = Math.max(1, columns - inset * 2);
    const paint = painter(this.options.theme);
    const same = pathKey(this.options.cwd) === pathKey(this.options.session.cwd);
    const rows: { text: string; color?: Ink; bold?: boolean; selected?: boolean }[] = [];
    const add = (text: string, color: Ink = COLORS.dim, bold = false) => {
      for (const line of wrapTextWithAnsi(text, contentWidth)) rows.push({ text: " ".repeat(inset) + line, color, bold });
    };
    add("");
    const fork = this.options.mode === "fork";
    add(fork ? "Fork session" : same ? "Resume session" : "Working directory · resume", COLORS.white, true);
    add(fork ? "原会话保持不变 · 无模型调用" : same ? "Switch conversations in the same directory" : "This session belongs to a different directory");
    if (fork) { add(`New name  ${this.prepared ? sessionTitle(this.prepared) : sessionTitle(this.options.session) + " · Fork"}`, COLORS.text); add(`Source    ${safeText(this.options.session.cwd)}`, COLORS.text); }
    add("");
    add(`Session   ${same ? sessionTitle(this.options.session) : safeText(this.options.session.cwd)}`, COLORS.text);
    add(`${same ? "Directory " : "Current   "}${safeText(this.options.cwd)}`, COLORS.text);
    add("");
    for (const [index, label] of [fork ? this.prepared ? "Open created fork" : "Create and open fork" : same ? "Resume this session" : "Use session directory and resume", "Back to sessions"].entries()) {
      const lines = wrapTextWithAnsi(`${this.selected === index ? "›" : " "} ${index + 1}. ${label}`, Math.max(1, columns - 1));
      for (const text of lines) rows.push({ text, selected: this.selected === index, color: this.selected === index ? COLORS.ink : COLORS.text, bold: this.selected === index });
    }
    add("");
    add(fork ? "复制当前有效分支及末次回复，不自动发送提问。关闭此页不删除已创建的 Fork。" : same ? "工作目录保持不变，将恢复所选会话的上下文。" : "将切换工作目录，并加载目标项目的运行环境。");
    if (this.prepared) add(`已创建未打开：${safeText(this.prepared.path)}`, COLORS.text);
    add("请确认没有其他 Pi 进程正在写入目标会话（轻量版无法检测）。");
    if (this.busy || this.error) { add(""); add(this.busy ? this.committing ? "Pi is switching session… (cannot cancel now)" : "Checking session…" : safeText(this.error), this.busy ? COLORS.dim : COLORS.error); }
    const errorEnd = rows.length;
    add("");
    add(this.committing ? "Waiting for Pi…" : paint("↑/↓", COLORS.white) + paint(" move · ", COLORS.dim) + paint("Enter/→", COLORS.white) + paint(" continue · ", COLORS.dim) + paint("Esc", COLORS.white) + paint(" back · ", COLORS.dim) + paint("PgUp/PgDn", COLORS.white) + paint(" scroll", COLORS.dim));
    add("");
    const selected = rows.findIndex((row) => row.selected);
    if (this.errorNeedsAttention) {
      this.offset = Math.max(0, errorEnd - height + 1);
      this.manualScroll = true;
      this.errorNeedsAttention = false;
    }
    if (!this.manualScroll) {
      if (rows.length <= height) this.offset = 0;
      else if (selected < this.offset) this.offset = selected;
      else if (selected >= this.offset + height) this.offset = selected - height + 1;
    }
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, rows.length - height)));
    const blank = "\x1b[0m" + " ".repeat(width);
    return Array.from({ length: height }, (_, index) => {
      const row = rows[this.offset + index];
      if (!row) return blank;
      const clipped = truncateToWidth(row.text, columns, "");
      const text = clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
      return "\x1b[0m" + " ".repeat(margin) + this.options.theme.style(text, {
        fg: parseColor(row.color ?? COLORS.text), bg: parseColor(row.selected ? COLORS.selected : PANEL), bold: row.bold,
      }) + "\x1b[0m" + " ".repeat(margin);
    });
  }
}

export interface ResumeFlowOptions extends Omit<BrowserOptions, "done" | "onSelect"> {
  actions?: {
    newSession(): Promise<{ cancelled: boolean }>;
    prepareFork(session: SessionInfo, signal: AbortSignal): Promise<SessionInfo | undefined>;
    fork(session: SessionInfo, prepared?: SessionInfo): Promise<{ cancelled: boolean }>;
    captureDelete(session: SessionInfo, signal: AbortSignal): Promise<SessionRevision>;
    delete(session: SessionInfo, revision: SessionRevision, signal: AbortSignal): Promise<string | undefined>;
  };
  canResume(): string | undefined;
  validate(session: SessionInfo, signal: AbortSignal): Promise<void>;
  resume(session: SessionInfo): Promise<{ cancelled: boolean }>;
  done(): void;
}

/** Keep one browser instance alive underneath an independent, exclusive page. */
export class ResumeFlow implements Component, Focusable {
  readonly browser: SessionBrowser;
  private page: ResumePage | undefined;
  private dialog: ActionDialog | undefined;
  private controller: AbortController | undefined;
  private closed = false;
  private _focused = false;
  constructor(readonly options: ResumeFlowOptions) {
    this.browser = new SessionBrowser({ ...options, done: () => this.close(), onSelect: (session) => this.select(session), onAction: (action, session) => this.action(action, session) });
  }
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.browser.focused = value && !this.page && !this.dialog; }
  get phase(): "browse" | "resume" { return this.page ? "resume" : "browse"; }
  private select(session: SessionInfo): void {
    if (this.closed) return;
    if (pathKey(session.path) === pathKey(this.options.currentFile ?? "")) { this.close(); return; }
    const page = new ResumePage({ ...this.options, session, back: () => this.back(), confirm: () => { void this.confirm(page); } });
    this.page = page;
    this.focused = this._focused;
    this.options.requestRender();
  }
  private showDialog(title: string, description: string[], choices: string[], select: (index: number) => void): ActionDialog {
    const dialog = new ActionDialog({ ...this.options, title, description, choices, select, back: () => this.back() });
    this.dialog = dialog;
    this.focused = this._focused;
    this.options.requestRender();
    return dialog;
  }
  private action(action: "new" | "fork" | "delete" | "menu", session?: SessionInfo): void {
    if (this.closed || this.page || this.dialog || !this.options.actions) return;
    if (action === "new") { this.newSession(); return; }
    if (action === "menu") { this.menu(session); return; }
    if (!session) return;
    if (action === "delete") { this.deleteSession(session); return; }
    const page = new ResumePage({ ...this.options, mode: "fork", session, back: () => this.back(), confirm: () => { void this.confirm(page); } });
    this.page = page;
    this.focused = this._focused;
    this.options.requestRender();
  }
  private menu(session?: SessionInfo): void {
    const dialog = this.showDialog("Session actions", session ? [sessionTitle(session)] : [], ["New", "Fork", "Pin", "Rename", "Delete"], (index) => {
      if (index !== 0 && !session) { dialog.error = "请选择一个会话。"; this.options.requestRender(); return; }
      if (index === 2) {
        dialog.busy = dialog.committing = true;
        void this.browser.togglePin(session!).then(() => {
          if (!this.closed && this.dialog === dialog) this.back();
        }, (error: unknown) => {
          if (this.closed || this.dialog !== dialog) return;
          dialog.busy = dialog.committing = false;
          dialog.error = safeText(String(error)); this.options.requestRender();
        });
      } else {
        this.back();
        if (index === 3) this.browser.startRename(session!);
        else this.action(index === 0 ? "new" : index === 1 ? "fork" : "delete", session);
      }
    });
    if (session && this.options.pins) {
      void this.options.pins.read(session).then((pinned) => {
        if (this.closed || this.dialog !== dialog) return;
        dialog.options.choices[2] = pinned === undefined ? "Pin" : "Unpin";
        this.options.requestRender();
      }, () => {});
    }
  }
  private newSession(): void {
    const dialog = this.showDialog("New session", [], ["Retry", "Cancel"], (index) => {
      if (index === 1) this.back(); else void submit();
    });
    const controller = new AbortController();
    this.controller = controller;
    const active = () => !this.closed && this.dialog === dialog && !controller.signal.aborted;
    const submit = async () => {
      if (!active() || dialog.busy) return;
      dialog.busy = true; dialog.error = ""; this.options.requestRender();
      try {
        const before = this.options.canResume();
        if (before) throw new Error(before);
        // No filesystem preflight for New, but still recheck queue/draft after yielding.
        await Promise.resolve();
        if (!active()) return;
        const after = this.options.canResume();
        if (after) throw new Error(after);
        dialog.committing = true; this.options.requestRender();
        const result = await this.options.actions!.newSession();
        if (!active()) return;
        if (result.cancelled) dialog.error = "Pi 已取消新建；可重试。";
        else this.close();
      } catch (error) { if (active()) dialog.error = safeText(String(error)); }
      finally { if (active()) { dialog.busy = dialog.committing = false; this.options.requestRender(); } }
    };
    void submit();
  }
  private deleteSession(session: SessionInfo): void {
    let revision: SessionRevision | undefined;
    const current = pathKey(session.path) === pathKey(this.options.currentFile ?? "");
    const dialog = this.showDialog(`Permanently delete “${sessionTitle(session)}”?`, [
      `${safeText(session.cwd)} · ${safeText(session.id).slice(0, 8)}`,
      "永久删除会话，不可撤销。不删除项目文件或 Fork，不停止其他进程。",
    ], ["Cancel", "Permanently delete session"], (index) => {
      if (index === 0) this.back(); else void submit();
    });
    const controller = new AbortController();
    this.controller = controller;
    const active = () => !this.closed && this.dialog === dialog && !controller.signal.aborted;
    const capture = async () => {
      if (current) { dialog.error = "不能删除当前会话。"; this.options.requestRender(); return; }
      dialog.busy = true; this.options.requestRender();
      try {
        const captured = await this.options.actions!.captureDelete(session, controller.signal);
        if (active()) revision = captured;
      } catch (error) { if (active()) dialog.error = safeText(String(error)); }
      finally { if (active()) { dialog.busy = false; this.options.requestRender(); } }
    };
    const submit = async () => {
      if (!active() || dialog.busy || current) return;
      if (revision === undefined) { await capture(); return; }
      dialog.busy = dialog.committing = true; dialog.error = ""; this.options.requestRender();
      try {
        const warning = await this.options.actions!.delete(session, revision, controller.signal);
        if (!active()) return;
        this.browser.removeSession(session);
        this.back();
        if (warning) this.showDialog("Session deleted", ["删除成功。", safeText(warning)], ["OK"], () => this.back());
      } catch (error) { if (active()) dialog.error = safeText(String(error)); }
      finally { if (active()) { dialog.busy = dialog.committing = false; this.options.requestRender(); } }
    };
    void capture();
  }
  private back(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.page = undefined;
    this.dialog = undefined;
    this.focused = this._focused;
    this.options.requestRender();
  }
  private async confirm(page: ResumePage): Promise<void> {
    if (this.closed || this.page !== page || page.busy) return;
    const controller = new AbortController();
    this.controller = controller;
    const active = () => !this.closed && this.page === page && !controller.signal.aborted;
    page.error = "";
    page.busy = true;
    this.options.requestRender();
    try {
      const before = this.options.canResume();
      if (before) throw new Error(before);
      if (page.options.mode === "fork") {
        if (!page.preparationComplete) {
          const prepared = await this.options.actions!.prepareFork(page.options.session, controller.signal);
          // Creation may finish after Back; make the persisted Fork discoverable
          // without waiting for a scan. Raw snapshot messages are not preview text.
          if (prepared) this.browser.addSession({ ...prepared, firstMessage: "", allMessagesText: "" });
          if (!active()) return;
          page.prepared = prepared;
          page.preparationComplete = true;
        }
      } else await this.options.validate(page.options.session, controller.signal);
      if (!active()) return;
      const after = this.options.canResume();
      if (after) throw new Error(after);
      page.committing = true;
      this.options.requestRender();
      const result = page.options.mode === "fork"
        ? await this.options.actions!.fork(page.options.session, page.prepared)
        : await this.options.resume(page.options.session);
      // A successful host replacement invalidates context and closes us via shutdown.
      if (!active()) return;
      if (result.cancelled) page.error = page.options.mode === "fork" ? "Pi 已取消打开 Fork；可在此页重试，不重复创建。" : "Pi 已取消恢复；可重试或返回列表。";
      else this.close();
    } catch (error) {
      if (active()) page.error = `${page.options.mode === "fork" ? "无法打开 Fork" : "无法恢复"}：${safeText(String(error))}`;
    } finally {
      if (active()) { page.busy = false; page.committing = false; this.controller = undefined; this.options.requestRender(); }
    }
  }
  handleInput(data: string): void { if (!this.closed) (this.dialog ?? this.page ?? this.browser).handleInput(data); }
  render(width: number): string[] { return this.dialog ? this.dialog.renderOver(this.browser.render(width), width) : (this.page ?? this.browser).render(width); }
  invalidate(): void { this.browser.invalidate(); this.page?.invalidate(); this.dialog?.invalidate(); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller?.abort();
    this.browser.close();
    this.options.done();
  }
  dispose(): void { this.close(); }
}
