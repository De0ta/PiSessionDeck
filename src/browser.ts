import type { KeybindingsManager, SessionInfo, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import { activityTime, filterSessions, groupRows, pathKey, safeText, sessionTitle, type Preview, type Scope } from "./model.ts";
import type { SessionRepository } from "./repository.ts";

export interface BrowserOptions {
  cwd: string;
  currentFile?: string;
  repository: SessionRepository;
  theme: Pick<Theme, "fg" | "bold">;
  keybindings: Pick<KeybindingsManager, "matches">;
  requestRender(): void;
  height(): number;
  done(selection: SessionInfo | undefined): void;
}

export class SessionBrowser implements Component, Focusable {
  private search = new Input({ prompt: "搜索 > ", placeholder: "标题 / 项目 / 消息内容" });
  private sessions: SessionInfo[] = [];
  private visibleCache: { sessions: SessionInfo[]; query: string; scope: Scope; result: SessionInfo[] } | undefined;
  private selectedPath: string | undefined;
  private scope: Scope = "project";
  private loading = false;
  private error = "";
  private preview: Preview = { messages: [] };
  private previewOffset = 0;
  private narrowDetails = false;
  private listAbort: AbortController | undefined;
  private previewAbort: AbortController | undefined;
  private closed = false;
  private _focused = false;
  readonly options: BrowserOptions;

  constructor(options: BrowserOptions) {
    this.options = options;
    this.search.onSubmit = () => { if (!this.loading && this.selected) this.finish(this.selected); };
    this.search.onEscape = () => this.finish(undefined);
    void this.refresh();
  }
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.search.focused = value; }
  get selected(): SessionInfo | undefined { return this.visibleSessions().find((s) => s.path === this.selectedPath); }
  private visibleSessions(): SessionInfo[] {
    const query = this.search.getValue();
    const cache = this.visibleCache;
    if (cache?.sessions === this.sessions && cache.query === query && cache.scope === this.scope) return cache.result;
    // Navigation follows project-grouped display order, not global timestamp order.
    const result = groupRows(filterSessions(this.sessions, query, this.scope, this.options.cwd))
      .flatMap((row) => row.kind === "session" ? [row.session] : []);
    this.visibleCache = { sessions: this.sessions, query, scope: this.scope, result };
    return result;
  }
  invalidate(): void { this.search.invalidate(); }
  private renderAgain(): void { if (!this.closed) this.options.requestRender(); }

  async refresh(): Promise<void> {
    if (this.closed) return;
    this.listAbort?.abort();
    const controller = new AbortController();
    this.listAbort = controller;
    this.loading = true;
    this.error = "";
    this.renderAgain();
    try {
      const sessions = await this.options.repository.list(this.scope, controller.signal);
      if (controller.signal.aborted || this.closed) return;
      this.sessions = sessions;
      this.loading = false;
      this.chooseValidSelection(true);
    } catch (error) {
      if (controller.signal.aborted || this.closed) return;
      this.loading = false;
      this.error = `读取失败：${safeText(String(error))}`;
    }
    this.renderAgain();
  }

  private chooseValidSelection(reload = false): void {
    const visible = this.visibleSessions();
    const next = visible.find((s) => s.path === this.selectedPath) ??
      visible.find((s) => pathKey(s.path) === pathKey(this.options.currentFile ?? "")) ?? visible[0];
    if (reload || next?.path !== this.selectedPath) {
      this.selectedPath = next?.path;
      void this.loadPreview(next);
    }
  }
  private async loadPreview(session: SessionInfo | undefined): Promise<void> {
    this.previewAbort?.abort();
    const controller = new AbortController();
    this.previewAbort = controller;
    this.previewOffset = 0;
    this.preview = { messages: [], note: session ? "正在读取预览…" : "没有匹配的会话。" };
    this.renderAgain();
    if (!session) return;
    try {
      const preview = await this.options.repository.preview(session, controller.signal);
      if (controller.signal.aborted || this.closed) return;
      this.preview = preview;
    } catch (error) {
      if (controller.signal.aborted || this.closed) return;
      this.preview = { messages: [], note: `预览不可用：${safeText(String(error))}` };
    }
    this.renderAgain();
  }

  close(): void { this.finish(undefined); }
  private finish(selection: SessionInfo | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.listAbort?.abort();
    this.previewAbort?.abort();
    this.options.done(selection);
  }
  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.finish(undefined); return; }
    if (matchesKey(data, "enter")) { if (!this.loading && this.selected) this.finish(this.selected); return; }
    if (matchesKey(data, "ctrl+o")) {
      this.scope = this.scope === "project" ? "all" : "project";
      this.sessions = [];
      this.selectedPath = undefined;
      void this.loadPreview(undefined);
      void this.refresh();
      return;
    }
    if (matchesKey(data, "ctrl+r")) { void this.refresh(); return; }
    if (matchesKey(data, "tab")) { this.narrowDetails = !this.narrowDetails; this.renderAgain(); return; }
    if (matchesKey(data, "shift+up") || matchesKey(data, "shift+down")) {
      this.previewOffset = Math.max(0, this.previewOffset + (matchesKey(data, "shift+up") ? -3 : 3));
      this.renderAgain(); return;
    }
    const up = this.options.keybindings.matches(data, "tui.select.up");
    const down = this.options.keybindings.matches(data, "tui.select.down");
    const pageUp = matchesKey(data, "pageUp");
    const pageDown = matchesKey(data, "pageDown");
    if (up || down || pageUp || pageDown) {
      const visible = this.visibleSessions();
      if (visible.length) {
        const index = Math.max(0, visible.findIndex((s) => s.path === this.selectedPath));
        const step = pageUp || pageDown ? 8 : 1;
        const next = visible[Math.max(0, Math.min(visible.length - 1, index + (up || pageUp ? -step : step)))];
        if (next && next.path !== this.selectedPath) { this.selectedPath = next.path; void this.loadPreview(next); }
      }
      this.renderAgain(); return;
    }
    const query = this.search.getValue();
    this.search.handleInput(data);
    if (query !== this.search.getValue()) this.chooseValidSelection();
    this.renderAgain();
  }

  render(width: number): string[] {
    if (width < 1) return [];
    const { theme } = this.options;
    const fit = (text: string, columns: number) => {
      const clipped = truncateToWidth(text, Math.max(0, columns), "");
      return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
    };
    const height = Math.max(7, Math.min(32, this.options.height()));
    const bodyHeight = height - 6;
    const sessions = this.visibleSessions();
    const selected = this.selected;
    const rows = groupRows(sessions);
    const selectedRow = rows.findIndex((row) => row.kind === "session" && row.session.path === this.selectedPath);
    const start = Math.max(0, Math.min(Math.max(0, rows.length - bodyHeight), selectedRow - Math.floor(bodyHeight / 2)));
    const list = rows.slice(start, start + bodyHeight).map((row) => {
      if (row.kind === "project") return theme.fg("dim", `▸ ${safeText(row.cwd) || "未知目录"}`);
      const active = pathKey(row.session.path) === pathKey(this.options.currentFile ?? "");
      const label = `${row.session.path === this.selectedPath ? ">" : " "}${active ? "●" : " "} ${sessionTitle(row.session)}`;
      return row.session.path === this.selectedPath ? theme.fg("accent", label) : label;
    });
    if (!list.length) list.push(theme.fg("muted", this.loading ? "正在读取会话…" : "没有匹配的会话"));

    const details = (columns: number): string[] => {
      const lines: string[] = [];
      const wrap = (text: string) => wrapTextWithAnsi(safeText(text, true), Math.max(1, columns));
      if (selected) {
        lines.push(theme.bold(truncateToWidth(sessionTitle(selected), columns)), ...wrap(selected.cwd));
        lines.push(theme.fg("dim", `${activityTime(selected.modified)} · ${selected.messageCount} 条消息（含工具）`));
        if (pathKey(selected.path) === pathKey(this.options.currentFile ?? "")) lines.push(theme.fg("success", "● 当前会话"));
        lines.push("");
      }
      if (this.preview.note) lines.push(...wrap(this.preview.note).map((line) => theme.fg("dim", line)), "");
      for (const message of this.preview.messages) {
        lines.push(theme.fg(message.role === "user" ? "accent" : "muted", message.role === "user" ? "你" : "助手"));
        lines.push(...wrap(message.text), "");
      }
      this.previewOffset = Math.min(this.previewOffset, Math.max(0, lines.length - bodyHeight));
      return lines.slice(this.previewOffset, this.previewOffset + bodyHeight);
    };
    const body: string[] = [];
    if (width >= 90) {
      const leftWidth = Math.min(64, Math.floor((width - 3) * 0.46));
      const rightWidth = width - leftWidth - 3;
      const right = details(rightWidth);
      for (let i = 0; i < bodyHeight; i++) body.push(`${fit(list[i] ?? "", leftWidth)} ${theme.fg("border", "│")} ${fit(right[i] ?? "", rightWidth)}`);
    } else {
      const content = this.narrowDetails ? details(width) : list;
      for (let i = 0; i < bodyHeight; i++) body.push(fit(content[i] ?? "", width));
    }
    const status = this.error || (this.loading ? "正在读取…（Esc 可取消）" : `${sessions.length} 个会话 · ● 仅表示当前会话，不代表运行状态`);
    return [
      theme.fg("accent", theme.bold(`PiSessionViewer · ${this.scope === "project" ? "当前项目" : "全部项目"}${width < 90 && this.narrowDetails ? " · 详情" : ""}`)),
      ...this.search.render(width),
      theme.fg("border", "─".repeat(width)),
      ...body,
      theme.fg(this.error ? "error" : "dim", status),
      theme.fg("muted", "↑↓ 选择 · Enter 恢复 · Ctrl+O 范围 · Ctrl+R 刷新"),
      theme.fg("dim", "Shift+↑↓ 滚动详情 · Tab 窄屏详情 · Esc 返回"),
    ].map((line) => truncateToWidth(line, width));
  }
}
