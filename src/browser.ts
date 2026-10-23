import type { KeybindingsManager, SessionInfo, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, parseColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import { activityTime, filterSessions, groupRows, pathKey, safeText, sessionColor, sessionTitle, type ListRow, type Preview, type Scope } from "./model.ts";
import type { SessionRepository } from "./repository.ts";

const COLORS = { bg: "#0c0c0c", text: "#dadada", white: "#ffffff", dim: "#929292", border: "#555555", selected: "#659ee8", ink: "#101820", error: "#ee9696" } as const;
type Ink = `#${string}`;
type StyledLine = { text: string; color?: Ink; bold?: boolean };
export interface BrowserOptions {
  cwd: string;
  currentFile?: string;
  currentStatus?(): "Ready" | "Working" | "Queued";
  repository: SessionRepository;
  theme: Pick<Theme, "style">;
  keybindings: Pick<KeybindingsManager, "matches">;
  requestRender(): void;
  height(): number;
  done(selection: SessionInfo | undefined): void;
}

export class SessionBrowser implements Component, Focusable {
  private search = new Input({ prompt: "Search: ", placeholder: "Title, project, or message" });
  private searchOpen = false;
  private helpOpen = false;
  private helpOffset = 0;
  private grouped = true;
  private sessions: SessionInfo[] = [];
  private visibleCache: { sessions: SessionInfo[]; query: string; scope: Scope; grouped: boolean; result: SessionInfo[] } | undefined;
  private selectedPath: string | undefined;
  private scope: Scope = "all";
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
    this.search.onEscape = () => this.setSearch(false);
    void this.refresh();
  }
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.search.focused = value && this.searchOpen && !this.helpOpen; }
  get selected(): SessionInfo | undefined { return this.visibleSessions().find((s) => s.path === this.selectedPath); }
  private visibleSessions(): SessionInfo[] {
    const query = this.searchOpen ? this.search.getValue() : "";
    const cache = this.visibleCache;
    if (cache?.sessions === this.sessions && cache.query === query && cache.scope === this.scope && cache.grouped === this.grouped) return cache.result;
    const filtered = filterSessions(this.sessions, query, this.scope, this.options.cwd);
    const result = this.grouped ? groupRows(filtered).flatMap((row) => row.kind === "session" ? [row.session] : []) : filtered;
    this.visibleCache = { sessions: this.sessions, query, scope: this.scope, grouped: this.grouped, result };
    return result;
  }
  invalidate(): void { this.search.invalidate(); }
  private renderAgain(): void { if (!this.closed) this.options.requestRender(); }
  private isCurrent(session: SessionInfo): boolean { return pathKey(session.path) === pathKey(this.options.currentFile ?? ""); }
  private status(session: SessionInfo): string { return this.isCurrent(session) ? (this.options.currentStatus?.() ?? "Ready") : "Saved"; }
  private setSearch(open: boolean): void {
    this.searchOpen = open;
    if (!open) this.search.setValue("");
    this.focused = this._focused;
    this.chooseValidSelection();
    this.renderAgain();
  }

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
      this.error = `Could not load sessions: ${safeText(String(error))}`;
    }
    this.renderAgain();
  }
  /** Only the in-process session has a trustworthy live status/projection. */
  refreshCurrent(): void {
    if (this.closed) return;
    const selected = this.selected;
    if (selected && this.isCurrent(selected)) void this.loadPreview(selected, true);
    this.renderAgain();
  }
  private chooseValidSelection(reload = false): void {
    const visible = this.visibleSessions();
    const next = visible.find((s) => s.path === this.selectedPath) ??
      visible.find((s) => this.isCurrent(s)) ?? visible[0];
    if (reload || next?.path !== this.selectedPath) {
      this.selectedPath = next?.path;
      void this.loadPreview(next);
    }
  }
  private async loadPreview(session: SessionInfo | undefined, retain = false): Promise<void> {
    this.previewAbort?.abort();
    const controller = new AbortController();
    this.previewAbort = controller;
    if (!retain) {
      this.previewOffset = 0;
      this.preview = { messages: [], note: session ? "Loading details..." : "No matching tasks." };
    }
    this.renderAgain();
    if (!session) return;
    try {
      const preview = await this.options.repository.preview(session, controller.signal);
      if (controller.signal.aborted || this.closed) return;
      this.preview = preview;
    } catch (error) {
      if (controller.signal.aborted || this.closed) return;
      this.preview = { messages: [], note: `Details unavailable: ${safeText(String(error))}` };
    }
    this.renderAgain();
  }
  close(): void { this.finish(undefined); }
  dispose(): void { this.close(); }
  private finish(selection: SessionInfo | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.listAbort?.abort();
    this.previewAbort?.abort();
    this.options.done(selection);
  }
  private changeScope(): void {
    this.scope = this.scope === "all" ? "project" : "all";
    this.sessions = [];
    this.selectedPath = undefined;
    void this.loadPreview(undefined);
    void this.refresh();
  }
  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, "ctrl+c")) { this.finish(undefined); return; }
    if (matchesKey(data, "escape")) {
      if (this.helpOpen) { this.helpOpen = false; this.focused = this._focused; this.renderAgain(); }
      else if (this.searchOpen) this.setSearch(false);
      else this.finish(undefined);
      return;
    }
    if (matchesKey(data, "f3")) {
      this.helpOpen = false;
      this.setSearch(!this.searchOpen);
      return;
    }
    if (this.helpOpen) {
      if (data === "?") { this.helpOpen = false; this.focused = this._focused; }
      else if (matchesKey(data, "up") || matchesKey(data, "pageUp")) this.helpOffset = Math.max(0, this.helpOffset - (matchesKey(data, "pageUp") ? 8 : 1));
      else if (matchesKey(data, "down") || matchesKey(data, "pageDown")) this.helpOffset += matchesKey(data, "pageDown") ? 8 : 1;
      this.renderAgain(); return;
    }
    if (!this.searchOpen && data === "?") { this.helpOpen = true; this.helpOffset = 0; this.focused = this._focused; this.renderAgain(); return; }
    if (matchesKey(data, "enter")) { if (!this.loading && this.selected) this.finish(this.selected); return; }
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab") || matchesKey(data, "ctrl+o")) { this.changeScope(); return; }
    if (matchesKey(data, "ctrl+r")) { void this.refresh(); return; }
    if (!this.searchOpen && data === "g") { this.grouped = !this.grouped; this.renderAgain(); return; }
    if (!this.searchOpen && (matchesKey(data, "right") || matchesKey(data, "left"))) {
      this.narrowDetails = matchesKey(data, "right"); this.renderAgain(); return;
    }
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
        const step = pageUp || pageDown ? Math.max(1, this.options.height() - 8) : 1;
        const next = visible[Math.max(0, Math.min(visible.length - 1, index + (up || pageUp ? -step : step)))];
        if (next && next.path !== this.selectedPath) { this.selectedPath = next.path; void this.loadPreview(next); }
      }
      this.renderAgain(); return;
    }
    if (this.searchOpen) {
      const query = this.search.getValue();
      this.search.handleInput(data);
      if (query !== this.search.getValue()) this.chooseValidSelection();
      this.renderAgain();
    }
  }

  private detailLines(columns: number): StyledLine[] {
    const selected = this.selected;
    if (!selected) return [{ text: this.preview.note ?? "No task selected.", color: COLORS.dim }];
    const lines: StyledLine[] = [];
    const add = (text: string, color: Ink = COLORS.text, bold = false) => {
      for (const part of wrapTextWithAnsi(safeText(text, true), Math.max(1, columns))) lines.push({ text: part, color, bold });
    };
    add(sessionTitle(selected), COLORS.white, true);
    add(`○ ${this.status(selected)}${this.isCurrent(selected) ? " · Current" : ""}`, COLORS.dim);
    add("");
    add(`Model: ${this.preview.details?.model ?? "Unknown"}`);
    add(`Reasoning: ${this.preview.details?.reasoning ?? "Not recorded"}`);
    add("");
    add("Project", COLORS.dim); add(selected.cwd || "Unknown"); add("");
    add("Last message", COLORS.dim); add(this.preview.details?.lastMessage ?? "No reply yet"); add("");
    add("Prompt", COLORS.dim); add(this.preview.details?.prompt ?? "Not recorded");
    if (this.preview.note) { add(""); add(this.preview.note, COLORS.dim); }
    return lines;
  }
  private helpLines(width: number): StyledLine[] {
    const groups = [
      ["Navigate", "↑ / ↓       Move", "Enter       Open", "PgUp/PgDn   Page", "Esc         Back", "Ctrl+C      Close"],
      ["Tasks", "Enter       Resume", "Shift+↑/↓   Scroll details", "← / →       List / details (narrow)"],
      ["View", "Tab/S-Tab   Filter", "F3          Search", "g           Group", "Ctrl+R      Refresh", "?           Help"],
    ];
    if (width >= 100) {
      const col = Math.floor(width / 3);
      return Array.from({ length: 7 }, (_, i) => ({
        text: groups.map((group) => {
          const text = truncateToWidth(group[i] ?? "", col, "");
          return text + " ".repeat(Math.max(0, col - visibleWidth(text)));
        }).join(""), color: i === 0 ? COLORS.white : COLORS.text, bold: i === 0,
      }));
    }
    return groups.flatMap((group) => [...group.map((text, i) => ({ text, color: i ? COLORS.text : COLORS.white, bold: i === 0 })), { text: "" }]);
  }

  render(width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(1, this.options.height());
    const fit = (text: string, columns: number) => {
      const clipped = truncateToWidth(text, Math.max(0, columns), "");
      return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
    };
    const cell = (text: string, columns: number, color: Ink = COLORS.text, bg: Ink = COLORS.bg, bold = false) =>
      this.options.theme.style(fit(text, columns), { fg: parseColor(color), bg: parseColor(bg), bold });
    const lines = [
      cell(`Session manager    Group: ${this.grouped ? "Project" : "Recent"}  g`, width, COLORS.white, COLORS.bg, true),
      cell(`${this.scope === "all" ? "[All]" : " All "}  ${this.scope === "project" ? "[This project]" : " This project "}    ${this.visibleSessions().length} tasks    Tab filter · F3 search`, width, COLORS.dim),
    ];
    if (this.searchOpen && !this.helpOpen) lines.push(cell(this.search.render(width).join(""), width));
    lines.push(cell("─".repeat(width), width, COLORS.border));
    const bodyHeight = Math.max(0, height - lines.length - 2);
    const contentHeight = Math.max(0, bodyHeight - 1);
    const wide = width >= 100;
    const rightWidth = wide ? Math.max(34, Math.min(58, Math.floor(width * 0.3))) : width;
    const leftWidth = wide ? width - rightWidth - 3 : width;
    const rows: ListRow[] = this.grouped ? groupRows(this.visibleSessions()) : this.visibleSessions().map((session) => ({ kind: "session", session }));
    const selectedRow = rows.findIndex((row) => row.kind === "session" && row.session.path === this.selectedPath);
    const start = Math.max(0, Math.min(Math.max(0, rows.length - contentHeight), selectedRow - Math.floor(contentHeight / 2)));
    const table = (title: string, status: string, updated: string) => {
      if (leftWidth < 42) return fit(title, leftWidth);
      return `${fit(title, leftWidth - 22)} ${fit(status, 9)} ${fit(updated, 11)}`;
    };
    const list = rows.slice(start, start + contentHeight).map((row) => {
      if (row.kind === "project") {
        const count = this.visibleSessions().filter((s) => pathKey(s.cwd) === pathKey(row.cwd)).length;
        return cell(`${safeText(row.cwd) || "Unknown project"}  ${count}`, leftWidth, COLORS.dim);
      }
      const selected = row.session.path === this.selectedPath;
      const title = `${selected ? "›" : " "} ○ ${sessionTitle(row.session)}`;
      return cell(table(title, this.status(row.session), activityTime(row.session.modified)), leftWidth,
        selected ? COLORS.ink : sessionColor(row.session.id), selected ? COLORS.selected : COLORS.bg, selected);
    });
    if (!list.length) list.push(cell(this.loading ? "Loading tasks..." : "No matching tasks.", leftWidth, COLORS.dim));
    const detailLines = this.detailLines(rightWidth);
    this.previewOffset = Math.min(this.previewOffset, Math.max(0, detailLines.length - contentHeight));
    const details = detailLines.slice(this.previewOffset, this.previewOffset + contentHeight);
    const draw = (line: StyledLine | undefined, columns: number) => cell(line?.text ?? "", columns, line?.color ?? COLORS.text, COLORS.bg, line?.bold);
    if (this.helpOpen) {
      const help = this.helpLines(width);
      this.helpOffset = Math.min(this.helpOffset, Math.max(0, help.length - contentHeight));
      if (bodyHeight) lines.push(cell("Task shortcuts", width, COLORS.white, COLORS.bg, true));
      for (let i = 0; i < contentHeight; i++) lines.push(draw(help[this.helpOffset + i], width));
    } else if (wide) {
      const separator = cell(" │ ", 3, COLORS.border);
      if (bodyHeight) lines.push(cell(table("Tasks", "Status", "Updated"), leftWidth, COLORS.dim) + separator + cell("Task details", rightWidth, COLORS.white, COLORS.bg, true));
      for (let i = 0; i < contentHeight; i++) lines.push((list[i] ?? cell("", leftWidth)) + separator + draw(details[i], rightWidth));
    } else {
      if (bodyHeight) lines.push(cell(this.narrowDetails ? "Task details    ← tasks" : "Tasks    → details", width, COLORS.white, COLORS.bg, true));
      for (let i = 0; i < contentHeight; i++) lines.push(this.narrowDetails ? draw(details[i], width) : (list[i] ?? cell("", width)));
    }
    const status = this.error || (this.loading ? "Loading tasks... Esc to cancel" : this.helpOpen ? "Only available actions are listed." : "Saved = history only; activity in other Pi processes is unknown.");
    lines.push(cell(status, width, this.error ? COLORS.error : COLORS.dim));
    lines.push(cell(this.helpOpen ? "Esc back   ↑/↓ scroll" : "? help   Esc back   ↑/↓ move   Enter open   F3 search   Shift+↑/↓ details", width, COLORS.dim));
    return lines.slice(0, height).map((line) => truncateToWidth(line, width, ""));
  }
}
