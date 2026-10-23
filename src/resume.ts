import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, parseColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import { SessionBrowser, type BrowserOptions } from "./browser.ts";
import { COLORS, painter, type Ink } from "./details.ts";
import { pathKey, safeText, sessionTitle } from "./model.ts";

const PANEL = "#262626";
type PageOptions = Pick<BrowserOptions, "cwd" | "theme" | "height" | "keybindings" | "requestRender"> & {
  session: SessionInfo;
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
    add(same ? "Resume session" : "Working directory · resume", COLORS.white, true);
    add(same ? "Switch conversations in the same directory" : "This session belongs to a different directory");
    add("");
    add(`Session   ${same ? sessionTitle(this.options.session) : safeText(this.options.session.cwd)}`, COLORS.text);
    add(`${same ? "Directory " : "Current   "}${safeText(this.options.cwd)}`, COLORS.text);
    add("");
    for (const [index, label] of [same ? "Resume this session" : "Use session directory and resume", "Back to sessions"].entries()) {
      const lines = wrapTextWithAnsi(`${this.selected === index ? "›" : " "} ${index + 1}. ${label}`, Math.max(1, columns - 1));
      for (const text of lines) rows.push({ text, selected: this.selected === index, color: this.selected === index ? COLORS.ink : COLORS.text, bold: this.selected === index });
    }
    add("");
    add(same ? "工作目录保持不变，将恢复所选会话的上下文。" : "将切换工作目录，并加载目标项目的运行环境。");
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
  canResume(): string | undefined;
  validate(session: SessionInfo, signal: AbortSignal): Promise<void>;
  resume(session: SessionInfo): Promise<{ cancelled: boolean }>;
  done(): void;
}

/** Keep one browser instance alive underneath an independent, exclusive page. */
export class ResumeFlow implements Component, Focusable {
  readonly browser: SessionBrowser;
  private page: ResumePage | undefined;
  private controller: AbortController | undefined;
  private closed = false;
  private _focused = false;
  constructor(readonly options: ResumeFlowOptions) {
    this.browser = new SessionBrowser({ ...options, done: () => this.close(), onSelect: (session) => this.select(session) });
  }
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.browser.focused = value && !this.page; }
  get phase(): "browse" | "resume" { return this.page ? "resume" : "browse"; }
  private select(session: SessionInfo): void {
    if (this.closed) return;
    if (pathKey(session.path) === pathKey(this.options.currentFile ?? "")) { this.close(); return; }
    const page = new ResumePage({ ...this.options, session, back: () => this.back(), confirm: () => { void this.confirm(page); } });
    this.page = page;
    this.focused = this._focused;
    this.options.requestRender();
  }
  private back(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.page = undefined;
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
      await this.options.validate(page.options.session, controller.signal);
      if (!active()) return;
      const after = this.options.canResume();
      if (after) throw new Error(after);
      page.committing = true;
      this.options.requestRender();
      const result = await this.options.resume(page.options.session);
      // A successful host replacement invalidates context and closes us via shutdown.
      if (!active()) return;
      if (result.cancelled) page.error = "Pi 已取消恢复；可重试或返回列表。";
      else this.close();
    } catch (error) {
      if (active()) page.error = `无法恢复：${safeText(String(error))}`;
    } finally {
      if (active()) { page.busy = false; page.committing = false; this.controller = undefined; this.options.requestRender(); }
    }
  }
  handleInput(data: string): void { if (!this.closed) (this.page ?? this.browser).handleInput(data); }
  render(width: number): string[] { return (this.page ?? this.browser).render(width); }
  invalidate(): void { this.browser.invalidate(); this.page?.invalidate(); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller?.abort();
    this.browser.close();
    this.options.done();
  }
  dispose(): void { this.close(); }
}
