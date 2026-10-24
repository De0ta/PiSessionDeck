import { compositeTuiLine, matchesKey, parseColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { BrowserOptions } from "./browser.ts";
import { COLORS } from "./details.ts";
import { safeText } from "./model.ts";

export interface ActionDialogOptions extends Pick<BrowserOptions, "theme" | "height" | "keybindings" | "requestRender"> {
  title: string;
  description: string[];
  choices: string[];
  select(index: number): void;
  back(): void;
}

/** Exclusive input surface; the browser remains visible behind the centered panel. */
export class ActionDialog implements Component {
  selected = 0;
  busy = false;
  committing = false;
  private offset = 0;
  private manualScroll = false;
  private attention = false;
  private _error = "";
  get error(): string { return this._error; }
  set error(value: string) { this._error = value; this.attention = !!value; }
  constructor(readonly options: ActionDialogOptions) {}
  invalidate(): void {}
  handleInput(data: string): void {
    if (this.committing) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.options.back(); return; }
    if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
      this.offset += matchesKey(data, "pageUp") ? -1 : 1;
      this.manualScroll = true;
    } else if (!this.busy) {
      if (this.options.keybindings.matches(data, "tui.select.up")) this.selected = Math.max(0, this.selected - 1);
      else if (this.options.keybindings.matches(data, "tui.select.down")) this.selected = Math.min(this.options.choices.length - 1, this.selected + 1);
      else if (/^[1-9]$/.test(data) && Number(data) <= this.options.choices.length) this.selected = Number(data) - 1;
      else if (matchesKey(data, "enter")) { this.options.select(this.selected); return; }
      else return;
      this.manualScroll = false;
    }
    this.options.requestRender();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(1, this.options.height());
    const inner = Math.max(1, width - (width >= 6 ? 4 : 0));
    const rows: { text: string; selected?: boolean; error?: boolean }[] = [];
    const add = (text: string, error = false) => {
      for (const line of wrapTextWithAnsi(safeText(text), inner)) rows.push({ text: line, error });
    };
    add(this.options.title);
    for (const text of this.options.description) add(text);
    add("");
    const choiceRows: number[] = [];
    this.options.choices.forEach((label, index) => {
      choiceRows.push(rows.length);
      for (const line of wrapTextWithAnsi(`${index === this.selected ? "›" : " "} ${index + 1}. ${label}`, inner)) rows.push({ text: line, selected: index === this.selected });
    });
    if (this.busy) add(this.committing ? "Submitting… (cannot cancel now)" : "Checking…");
    if (this.error) add(this.error, true);
    const errorEnd = rows.length;
    add("↑/↓ select · Enter confirm · Esc back · PgUp/PgDn scroll");
    const available = Math.min(height, rows.length);
    if (this.attention) { this.offset = Math.max(0, errorEnd - available); this.attention = false; this.manualScroll = true; }
    if (!this.manualScroll) {
      const selected = choiceRows[this.selected] ?? 0;
      if (selected < this.offset) this.offset = selected;
      if (selected >= this.offset + available) this.offset = selected - available + 1;
    }
    this.offset = Math.max(0, Math.min(this.offset, rows.length - available));
    const inset = width >= 6 ? 2 : 0;
    return rows.slice(this.offset, this.offset + available).map((row) => {
      const clipped = truncateToWidth(row.text, inner, "");
      const text = " ".repeat(inset) + clipped + " ".repeat(Math.max(0, width - inset - visibleWidth(clipped)));
      return "\x1b[0m" + this.options.theme.style(text, { fg: parseColor(row.selected ? COLORS.ink : row.error ? COLORS.error : COLORS.text), bg: parseColor(row.selected ? COLORS.selected : "#262626"), bold: row.selected }) + "\x1b[0m";
    });
  }
  renderOver(base: string[], width: number): string[] {
    if (width < 1) return [];
    const height = Math.max(1, this.options.height());
    const columns = Math.min(width, 72);
    const panel = this.render(columns);
    const left = Math.floor((width - columns) / 2);
    const top = Math.floor((height - panel.length) / 2);
    return Array.from({ length: height }, (_, index) => compositeTuiLine(base[index] ?? "", index >= top && index < top + panel.length ? panel[index - top]! : "", index >= top && index < top + panel.length ? left : 0, index >= top && index < top + panel.length ? columns : 0, width));
  }
}
