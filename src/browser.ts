import type { KeybindingsManager, SessionInfo, Theme, ThemeBg } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type MarkdownTheme } from "@earendil-works/pi-tui";
import { activityTime, filterSessions, GROUP_MODES, groupRows, pathKey, rowKey, safeText, sessionColor, sessionGroup, sessionTitle, sessionIdentity, isUnsaved, PINNED_GROUP, type GroupingOptions, type GroupMode, type ListRow, type Preview, type Scope, type SessionModel } from "./model.ts";
import type { SessionRepository } from "./repository.ts";
import type { PinStore } from "./pins.ts";
export type BrowserAction = "new" | "fork" | "delete" | "menu";

import { COLORS, detailLines, painter, type Ink } from "./details.ts";
type StyledLine = { text: string; color?: Ink; bold?: boolean };
export interface BrowserOptions {
  cwd: string;
  currentFile?: string;
  currentStatus?(): "Ready" | "Working" | "Queued" | "Completed" | "Stopped" | "Error";
  currentModel?(): SessionModel | undefined;
  now?(): number;
  markdownTheme?: MarkdownTheme;
  repository: SessionRepository;
  theme: Pick<Theme, "style">;
  keybindings: Pick<KeybindingsManager, "matches">;
  requestRender(): void;
  height(): number;
  onSelect?(selection: SessionInfo): void;
  onAction?(action: BrowserAction, session?: SessionInfo): void;
  pins?: PinStore;
  done(selection: SessionInfo | undefined): void;
}

export class SessionBrowser implements Component, Focusable {
  private search = new Input({ prompt: "" });
  private renameInput = new Input({ prompt: "" });
  private renaming: SessionInfo | undefined;
  private renameBusy = false;
  private renamedTitles = new Map<string, string>();
  private pinTimes = new Map<string, number>();
  private pinOverrides = new Map<string, number | undefined>();
  private pinBusy = false;
  private removed = new Set<string>();
  private added = new Map<string, SessionInfo>();
  private expanded = new Map<string, number>();
  private detailCache: { key: string; preview: Preview; lines: string[]; maxOffset: number } | undefined;
  private searchOpen = false;
  private helpOpen = false;
  private helpOffset = 0;
  private groupMode: GroupMode = "project";
  private selectedGroup: { mode: GroupMode; path: string; key: string } | undefined;
  private modelNames: ReadonlyMap<string, SessionModel> = new Map();
  private modelAbort: AbortController | undefined;
  private modelsLoading = false;
  private sessions: SessionInfo[] = [];
  private visibleCache: { sessions: SessionInfo[]; query: string; scope: Scope; result: SessionInfo[] } | undefined;
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
    this.search.onSubmit = () => this.activateSelection();
    this.search.onEscape = () => this.setSearch(false);
    void this.refresh();
  }
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.search.focused = value && this.searchOpen && !this.helpOpen && !this.renaming;
    this.renameInput.focused = value && !!this.renaming && !this.renameBusy;
  }
  get selected(): SessionInfo | undefined { return this.visibleSessions().find((s) => s.path === this.selectedPath); }
  private visibleSessions(): SessionInfo[] {
    const query = this.searchOpen ? this.search.getValue() : "";
    const cache = this.visibleCache;
    if (cache?.sessions === this.sessions && cache.query === query && cache.scope === this.scope) return cache.result;
    const filtered = filterSessions(this.sessions, query, this.scope, this.options.cwd);
    const result = filtered;
    this.visibleCache = { sessions: this.sessions, query, scope: this.scope, result };
    return result;
  }
  private grouping(): GroupingOptions {
    return { mode: this.groupMode, now: this.options.now?.() ?? Date.now(),
      modelFor: (session) => this.isCurrent(session) && this.options.currentModel ? this.options.currentModel() : this.modelNames.get(pathKey(session.path)),
      statusFor: (session) => this.status(session), pinnedAt: (session) => this.pinTimes.get(sessionIdentity(session)) };
  }
  private rows(): ListRow[] {
    const options = this.grouping();
    const sessions = this.visibleSessions();
    const selected = this.selected;
    if (selected) {
      const { key } = sessionGroup(selected, options);
      const previous = this.selectedGroup;
      // Time passing or live metadata can move an already-visible selection to a
      // collapsed bucket. Keep that same conversation visible in its new bucket.
      if (previous?.mode === this.groupMode && previous.path === selected.path && previous.key !== key) {
        const members = sessions.filter((session) => sessionGroup(session, options).key === key);
        const index = members.findIndex((session) => session.path === selected.path);
        if (index >= (this.expanded.get(key) ?? 5)) this.expanded.set(key, Math.ceil((index + 1) / 5) * 5);
      }
      this.selectedGroup = { mode: this.groupMode, path: selected.path, key };
    } else this.selectedGroup = undefined;
    return groupRows(sessions, this.expanded, options);
  }
  private async loadModels(): Promise<void> {
    this.modelAbort?.abort();
    const controller = new AbortController();
    this.modelAbort = controller;
    if (!this.options.repository.models || this.groupMode !== "model" || this.closed) { this.modelsLoading = false; return; }
    this.modelsLoading = true; this.renderAgain();
    try {
      const models = await this.options.repository.models(this.sessions, controller.signal);
      if (controller.signal.aborted || this.closed) return;
      this.modelNames = models;
      this.chooseValidSelection();
    } catch (error) {
      if (controller.signal.aborted || this.closed) return;
      this.error = `Could not load model groups: ${safeText(String(error))}`;
    } finally {
      if (!controller.signal.aborted && !this.closed) { this.modelsLoading = false; this.renderAgain(); }
    }
  }
  private choices(): ListRow[] { return this.rows().filter((row) => rowKey(row) !== undefined); }
  private activateSelection(): void {
    if (this.loading) return;
    const row = this.choices().find((row) => rowKey(row) === this.selectedPath);
    if (row?.kind === "more") {
      const key = row.key;
      const old = this.expanded.get(key) ?? 5;
      this.expanded.set(key, old + 5);
      const options = this.grouping();
      const members = this.visibleSessions().filter((s) => sessionGroup(s, options).key === key);
      if (key === PINNED_GROUP) members.sort((a, b) => (options.pinnedAt?.(b) ?? 0) - (options.pinnedAt?.(a) ?? 0) || a.path.localeCompare(b.path));
      const next = members[old];
      this.selectedPath = next?.path;
      void this.loadPreview(next);
      this.renderAgain();
    } else if (this.selected) {
      if (this.options.onSelect) this.options.onSelect(this.selected);
      else this.finish(this.selected);
    }
  }
  startRename(session: SessionInfo): void {
    if (this.closed || !this.options.repository.rename) return;
    this.renaming = session;
    this.renameInput.setValue(sessionTitle(session));
    this.renameInput.handleInput("\x1b[F");
    this.focused = this._focused; this.renderAgain();
  }
  async togglePin(session: SessionInfo): Promise<void> {
    if (this.closed || this.loading || this.pinBusy || !this.options.pins) return;
    if (isUnsaved(session)) { this.error = "This conversation is not saved yet; send a message before pinning."; this.renderAgain(); return; }
    this.pinBusy = true;
    const key = sessionIdentity(session);
    const pinned = !this.pinTimes.has(key);
    try {
      await this.options.pins.write(session, pinned);
      const time = pinned ? (await this.options.pins.read(session)) ?? Date.now() : undefined;
      if (this.closed) return;
      this.pinOverrides.set(key, time);
      if (time === undefined) this.pinTimes.delete(key); else this.pinTimes.set(key, time);
      this.error = "";
      // Moving into a collapsed group must not hide the selected conversation.
      if (this.selectedPath === session.path) {
        const options = this.grouping();
        const group = sessionGroup(session, options).key;
        const members = this.visibleSessions().filter((s) => sessionGroup(s, options).key === group);
        if (group === PINNED_GROUP) members.sort((a, b) => (options.pinnedAt?.(b) ?? 0) - (options.pinnedAt?.(a) ?? 0) || a.path.localeCompare(b.path));
        const index = members.findIndex((s) => sessionIdentity(s) === key);
        if (index >= 5) this.expanded.set(group, Math.ceil((index + 1) / 5) * 5);
      }
      this.chooseValidSelection();
    } catch (error) { if (!this.closed) this.error = `Could not pin: ${safeText(String(error))}`; }
    finally { this.pinBusy = false; this.renderAgain(); }
  }
  addSession(session: SessionInfo): void {
    if (this.closed) return;
    this.added.set(sessionIdentity(session), session);
    this.sessions = [session, ...this.sessions.filter((item) => sessionIdentity(item) !== sessionIdentity(session))];
    this.renderAgain();
  }
  removeSession(session: SessionInfo): void {
    if (this.closed) return;
    const choices = this.choices();
    const index = choices.findIndex((row) => row.kind === "session" && sessionIdentity(row.session) === sessionIdentity(session));
    this.removed.add(sessionIdentity(session));
    this.added.delete(sessionIdentity(session));
    this.sessions = this.sessions.filter((s) => sessionIdentity(s) !== sessionIdentity(session));
    this.pinTimes.delete(sessionIdentity(session));
    this.renamedTitles.delete(pathKey(session.path));
    this.modelNames = new Map([...this.modelNames].filter(([key]) => key !== pathKey(session.path)));
    this.options.repository.forget?.(session);
    this.detailCache = undefined;
    if (this.selectedPath === session.path) {
      const next = this.choices();
      const adjacent = next[Math.max(0, Math.min(index, next.length - 1))];
      this.selectedPath = adjacent ? rowKey(adjacent) : undefined;
      void this.loadPreview(adjacent?.kind === "session" ? adjacent.session : undefined);
    }
    this.chooseValidSelection(); this.renderAgain();
  }
  private async saveRename(): Promise<void> {
    const session = this.renaming;
    const title = safeText(this.renameInput.getValue()).slice(0, 160);
    if (!session || !title || !this.options.repository.rename || this.renameBusy) return;
    this.renameBusy = true; this.focused = this._focused; this.renderAgain();
    try {
      await this.options.repository.rename(session, title);
      if (this.closed) return;
      this.renamedTitles.set(pathKey(session.path), title);
      this.sessions = this.sessions.map((s) => pathKey(s.path) === pathKey(session.path) ? { ...s, name: title } : s);
      this.renaming = undefined;
      this.error = "";
      this.chooseValidSelection();
    } catch (error) { if (!this.closed) this.error = `Could not rename: ${safeText(String(error))}`; }
    finally { this.renameBusy = false; this.focused = this._focused; this.renderAgain(); }
  }
  invalidate(): void { this.search.invalidate(); this.renameInput.invalidate(); this.detailCache = undefined; }
  private renderAgain(): void { if (!this.closed) this.options.requestRender(); }
  private isCurrent(session: SessionInfo): boolean { return pathKey(session.path) === pathKey(this.options.currentFile ?? ""); }
  private status(session: SessionInfo): string { return this.isCurrent(session) ? (isUnsaved(session) ? "Unsaved" : this.options.currentStatus?.() ?? "Ready") : "Saved"; }
  private setSearch(open: boolean): void {
    this.searchOpen = open;
    this.expanded.clear();
    if (!open) this.search.setValue("");
    this.focused = this._focused;
    this.chooseValidSelection();
    this.renderAgain();
  }

  async refresh(): Promise<void> {
    if (this.closed) return;
    this.listAbort?.abort();
    this.modelAbort?.abort(); this.modelsLoading = false;
    const controller = new AbortController();
    this.listAbort = controller;
    // Only protect changes made DURING this scan; fresh reads are authoritative.
    this.renamedTitles.clear();
    this.pinOverrides.clear();
    this.loading = true;
    this.error = "";
    this.renderAgain();
    try {
      const sessions = await this.options.repository.list(this.scope, controller.signal);
      if (controller.signal.aborted || this.closed) return;
      const pins = new Map<string, number>();
      if (this.options.pins) for (let start = 0; start < sessions.length; start += 24) {
        await Promise.all(sessions.slice(start, start + 24).map(async (session) => {
          const time = await this.options.pins!.read(session);
          if (time !== undefined) pins.set(sessionIdentity(session), time);
        }));
        if (controller.signal.aborted || this.closed) return;
      }
      for (const [key, time] of this.pinOverrides) { if (time === undefined) pins.delete(key); else pins.set(key, time); }
      this.pinTimes = pins;
      const discovered = sessions.filter((session) => !this.removed.has(sessionIdentity(session)));
      for (const [key, session] of this.added) {
        if (discovered.some((item) => sessionIdentity(item) === key)) this.added.delete(key);
        else discovered.push(session);
      }
      this.sessions = discovered.map((session) => {
        const name = this.renamedTitles.get(pathKey(session.path));
        return name ? { ...session, name } : session;
      });
      this.loading = false;
      this.chooseValidSelection(true);
      void this.loadModels();
    } catch (error) {
      if (controller.signal.aborted || this.closed) return;
      this.loading = false;
      this.error = `Could not load sessions: ${safeText(String(error))}`;
    }
    this.renderAgain();
  }
  /** Only the in-process session has a trustworthy live status/projection. */
  refreshCurrent(title?: string): void {
    if (this.closed) return;
    if (title !== undefined) {
      if (this.options.currentFile) this.renamedTitles.set(pathKey(this.options.currentFile), title);
      this.sessions = this.sessions.map((session) => this.isCurrent(session) ? { ...session, name: title } : session);
    }
    if (this.groupMode === "model" || this.groupMode === "status") this.chooseValidSelection();
    const selected = this.selected;
    if (selected && this.isCurrent(selected)) void this.loadPreview(selected, true);
    this.renderAgain();
  }
  private chooseValidSelection(reload = false): void {
    const choices = this.choices();
    const next = choices.find((row) => rowKey(row) === this.selectedPath) ??
      choices.find((row) => row.kind === "session" && this.isCurrent(row.session)) ?? choices[0];
    if (reload || (next && rowKey(next)) !== this.selectedPath) {
      this.selectedPath = next ? rowKey(next) : undefined;
      void this.loadPreview(next?.kind === "session" ? next.session : undefined);
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
    this.modelAbort?.abort();
    this.previewAbort?.abort();
    this.options.done(selection);
  }
  private changeScope(): void {
    this.scope = this.scope === "all" ? "project" : "all";
    this.expanded.clear();
    this.sessions = [];
    this.selectedPath = undefined;
    void this.loadPreview(undefined);
    void this.refresh();
  }
  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, "ctrl+c")) { this.finish(undefined); return; }
    if (this.renaming) {
      if (matchesKey(data, "escape") && !this.renameBusy) { this.renaming = undefined; this.focused = this._focused; }
      else if (matchesKey(data, "enter")) { void this.saveRename(); return; }
      else if (!this.renameBusy) this.renameInput.handleInput(data);
      this.renderAgain(); return;
    }
    if (!this.searchOpen && !this.helpOpen && matchesKey(data, "r") && this.selected && this.options.repository.rename) {
      this.startRename(this.selected); return;
    }
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
    if (matchesKey(data, "enter") || (!this.searchOpen && matchesKey(data, "right"))) { this.activateSelection(); return; }
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab") || matchesKey(data, "ctrl+o")) { this.changeScope(); return; }
    if (matchesKey(data, "ctrl+r")) { void this.refresh(); return; }
    if (!this.searchOpen && !this.loading) {
      if (data === "p" && this.selected && this.options.pins) { void this.togglePin(this.selected); return; }
      if (this.options.onAction) {
        if (data === "n") { this.options.onAction("new", this.selected); return; }
        if (data === "a") { this.options.onAction("menu", this.selected); return; }
        if (this.selected && (data === "f" || matchesKey(data, "delete"))) {
          this.options.onAction(data === "f" ? "fork" : "delete", this.selected); return;
        }
      }
    }
    if (!this.searchOpen && data === "g") {
      this.groupMode = GROUP_MODES[(GROUP_MODES.indexOf(this.groupMode) + 1) % GROUP_MODES.length]!;
      this.expanded.clear(); this.chooseValidSelection();
      void this.loadModels(); this.renderAgain(); return;
    }
    if (!this.searchOpen && (data === "d" || matchesKey(data, "left"))) {
      this.narrowDetails = data === "d"; this.renderAgain(); return;
    }
    if (matchesKey(data, "shift+up") || matchesKey(data, "shift+down")) {
      this.previewOffset = Math.max(0, this.previewOffset + (matchesKey(data, "shift+up") ? -1 : 1));
      this.renderAgain(); return;
    }
    const up = this.options.keybindings.matches(data, "tui.select.up");
    const down = this.options.keybindings.matches(data, "tui.select.down");
    const pageUp = matchesKey(data, "pageUp");
    const pageDown = matchesKey(data, "pageDown");
    if (up || down || pageUp || pageDown) {
      const visible = this.choices();
      if (visible.length) {
        const index = Math.max(0, visible.findIndex((row) => rowKey(row) === this.selectedPath));
        const step = pageUp || pageDown ? Math.max(1, this.options.height() - 8) : 1;
        const next = visible[Math.max(0, Math.min(visible.length - 1, index + (up || pageUp ? -step : step)))];
        if (next && rowKey(next) !== this.selectedPath) { this.selectedPath = rowKey(next); void this.loadPreview(next.kind === "session" ? next.session : undefined); }
      }
      this.renderAgain(); return;
    }
    if (this.searchOpen) {
      const query = this.search.getValue();
      this.search.handleInput(data);
      if (query !== this.search.getValue()) { this.expanded.clear(); this.chooseValidSelection(); }
      this.renderAgain();
    }
  }

  private details(columns: number, height: number): string[] {
    const selected = this.selected;
    if (!selected) return [this.selectedPath?.startsWith("more:") ? painter(this.options.theme)("Enter", COLORS.white) + painter(this.options.theme)(" to show the next 5 conversations.", COLORS.dim) : this.preview.note ?? "No task selected."];
    const key = JSON.stringify([columns, height, this.previewOffset, selected.path, selected.name, this.status(selected)]);
    if (this.detailCache?.key === key && this.detailCache.preview === this.preview) return this.detailCache.lines;
    const result = detailLines({ session: selected, preview: this.preview, status: this.status(selected), current: this.isCurrent(selected), width: columns, height, offset: this.previewOffset, paint: painter(this.options.theme), markdownTheme: this.options.markdownTheme });
    this.previewOffset = Math.min(this.previewOffset, result.maxOffset);
    this.detailCache = { key, preview: this.preview, ...result };
    return result.lines;
  }
  private helpLines(width: number): StyledLine[] {
    const groups = [
      ["Navigate", "↑ / ↓       Move", "Enter / →   Open", "PgUp/PgDn   Page", "Esc         Back", "Ctrl+C      Close"],
      ["Tasks", "Enter / →   Resume / Show more", "Shift+↑/↓   Scroll last reply", "d / ←       Details / list (narrow)", ...(this.options.repository.rename ? ["r           Rename task"] : []), ...(this.options.onAction ? ["n           New conversation", "f           Fork conversation", "Delete      Delete conversation", "a           Actions"] : []), ...(this.options.pins ? ["p           Pin / unpin"] : [])],
      ["View", "Tab/S-Tab   Filter", "F3          Search", "g           Project/Recent/Model/Status", "Ctrl+R      Refresh", "?           Help"],
    ];
    const paint = painter(this.options.theme);
    const action = (text: string, index: number) => {
      if (!index) return paint(text, COLORS.white, true);
      const match = /^(.+?)( {2,})(.*)$/.exec(text);
      return match ? paint(match[1]!, COLORS.white) + paint(match[2]! + match[3]!, COLORS.dim) : paint(text, COLORS.dim);
    };
    if (width >= 100) {
      const col = Math.floor(width / 3);
      return Array.from({ length: Math.max(...groups.map((group) => group.length)) }, (_, i) => ({
        text: groups.map((group) => {
          const text = truncateToWidth(action(group[i] ?? "", i), col, "");
          return text + " ".repeat(Math.max(0, col - visibleWidth(text)));
        }).join(""), color: i === 0 ? COLORS.white : COLORS.text, bold: i === 0,
      }));
    }
    return groups.flatMap((group) => [...group.map((text, i) => ({ text: action(text, i), color: i ? COLORS.text : COLORS.white, bold: i === 0 })), { text: "" }]);
  }

  render(width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(1, this.options.height());
    const fit = (text: string, columns: number) => {
      const clipped = truncateToWidth(text, Math.max(0, columns), "");
      return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
    };
    const cell = (text: string, columns: number, color: Ink = COLORS.text, bg: ThemeBg | undefined = COLORS.bg, bold = false) =>
      "\x1b[49m" + this.options.theme.style(fit(text, columns), { fg: color, bg, bold });
    const paint = painter(this.options.theme);
    const wide = width >= 100;
    const rightWidth = wide ? Math.max(34, Math.min(58, Math.floor(width * 0.3))) : width;
    const leftWidth = wide ? width - rightWidth - 3 : width;
    const label = this.renaming ? "Rename › " : "Search › ";
    const activeInput = this.renaming ? this.renameInput : this.search;
    const searchText = this.renaming || this.searchOpen ? activeInput.render(Math.max(1, leftWidth - 9)).join("") : "";
    const searchBar = cell(paint(label, COLORS.blue, true) + searchText, leftWidth, COLORS.text, COLORS.search);
    const lines = [
      cell(`PiSessionDeck    Group: ${{ project: "Project", recent: "Recent", model: "Model", status: "Status" }[this.groupMode]}  g`, width, COLORS.white, COLORS.bg, true),
      cell(`${this.scope === "all" ? "[All]" : " All "}  ${this.scope === "project" ? "[This project]" : " This project "}    ${this.visibleSessions().length} tasks    ${paint("Tab", COLORS.white)}${paint(" filter · ", COLORS.dim)}${paint("F3", COLORS.white)}${paint(" search", COLORS.dim)}`, width, COLORS.dim),
      ...(this.renaming || this.searchOpen ? [searchBar + (wide ? cell(" │ ", 3, COLORS.border) + cell("", rightWidth) : "")] : []),
      cell("─".repeat(width), width, COLORS.border),
    ];
    const bodyHeight = Math.max(0, height - lines.length - 2);
    const contentHeight = Math.max(0, bodyHeight - 1);
    const rows = this.rows();
    const selectedRow = rows.findIndex((row) => rowKey(row) === this.selectedPath);
    const start = Math.max(0, Math.min(Math.max(0, rows.length - contentHeight), selectedRow - Math.floor(contentHeight / 2)));
    const table = (title: string, status: string, updated: string) => {
      if (leftWidth < 42) return fit(title, leftWidth);
      return `${fit(title, leftWidth - 22)} ${fit(status, 9)} ${fit(updated, 11)}`;
    };
    const list = rows.slice(start, start + contentHeight).map((row) => {
      if (row.kind === "spacer") return cell("", leftWidth);
      if (row.kind === "project") return cell(`${safeText(row.cwd) || "Unknown project"}  ${row.count}`, leftWidth, COLORS.dim);
      if (row.kind === "group") return cell(`${safeText(row.label)}  ${row.count}`, leftWidth, COLORS.dim);
      const selected = rowKey(row) === this.selectedPath;
      const bg = selected ? COLORS.selected : COLORS.bg;
      if (row.kind === "more") return cell(`${selected ? "›" : " "}   Show more (${row.remaining} remaining)`, leftWidth, selected ? COLORS.ink : COLORS.dim, bg);
      const status = this.status(row.session);
      const circle = status === "Working" ? COLORS.blue : status === "Completed" ? COLORS.green : COLORS.dim;
      const title = paint(selected ? "› " : "  ", selected ? COLORS.ink : COLORS.dim) + paint(this.pinTimes.has(sessionIdentity(row.session)) ? "★ " : "○ ", circle) + paint(sessionTitle(row.session), selected ? COLORS.ink : sessionColor(row.session.id), selected);
      const titleWidth = leftWidth < 42 ? leftWidth : leftWidth - 22;
      const titleCell = cell(title, titleWidth, COLORS.text, bg);
      return leftWidth < 42 ? titleCell : titleCell + cell(` ${fit(status, 9)} `, 11, COLORS.text, bg) + cell(fit(activityTime(row.session.modified), 11), 11, COLORS.dim, bg);
    });
    if (!list.length) list.push(cell(this.loading ? "Loading tasks..." : "No matching tasks.", leftWidth, COLORS.dim));
    const details = this.details(rightWidth, contentHeight);
    const draw = (line: StyledLine | undefined, columns: number) => cell(line?.text ?? "", columns, line?.color ?? COLORS.text, COLORS.bg, line?.bold);
    if (this.helpOpen) {
      const help = this.helpLines(width);
      this.helpOffset = Math.min(this.helpOffset, Math.max(0, help.length - contentHeight));
      if (bodyHeight) lines.push(cell("Task shortcuts", width, COLORS.white, COLORS.bg, true));
      for (let i = 0; i < contentHeight; i++) lines.push(draw(help[this.helpOffset + i], width));
    } else if (wide) {
      const separator = cell(" │ ", 3, COLORS.border);
      if (bodyHeight) lines.push(cell(table("Tasks", "Status", "Updated"), leftWidth, COLORS.dim) + separator + cell("Task details", rightWidth, COLORS.white, COLORS.bg, true));
      for (let i = 0; i < contentHeight; i++) lines.push((list[i] ?? cell("", leftWidth)) + separator + cell(details[i] ?? "", rightWidth));
    } else {
      if (bodyHeight) lines.push(cell(this.narrowDetails ? "Task details    ← tasks" : "Tasks    d details", width, COLORS.white, COLORS.bg, true));
      for (let i = 0; i < contentHeight; i++) lines.push(this.narrowDetails ? cell(details[i] ?? "", width) : (list[i] ?? cell("", width)));
    }
    const status = this.error || (this.loading || this.modelsLoading ? paint(this.loading ? "Loading tasks... " : "Loading model groups... ", COLORS.dim) + paint("Esc", COLORS.white) + paint(" to cancel", COLORS.dim) : this.helpOpen ? "Only available actions are listed." : "Saved = history only; activity in other Pi processes is unknown.");
    lines.push(cell(status, width, this.error ? COLORS.error : COLORS.dim));
    const hints = this.renaming ? [["Enter", "save"], ["Esc", "cancel"]] : this.helpOpen ? [["Esc", "back"], ["↑/↓", "scroll"]] : [["?", "help"], ["Esc", "back"], ["↑/↓", "move"], ["Enter/→", "open / more"], ["F3", "search"], ...(this.options.onAction ? [["n", "new"], ["a", "actions"]] : []), ...(this.options.repository.rename ? [["r", "rename"]] : []), ["Shift+↑/↓", "reply"]];
    lines.push(cell(hints.map(([key, action]) => paint(key!, COLORS.white) + paint(` ${action}`, COLORS.dim)).join("   "), width, COLORS.dim));
    return lines.slice(0, height).map((line) => truncateToWidth(line, width, ""));
  }
}
