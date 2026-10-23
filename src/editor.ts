import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export function isBrowserTrigger(data: string, text: string, autocomplete: boolean): boolean {
  return text.length === 0 && !autocomplete && matchesKey(data, "left");
}

export class BrowserEditor extends CustomEditor {
  private readonly openBrowser: () => void;
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, openBrowser: () => void) {
    super(tui, theme, keybindings);
    this.openBrowser = openBrowser;
  }
  override handleInput(data: string): void {
    if (isBrowserTrigger(data, this.getText(), this.isShowingAutocomplete())) {
      this.openBrowser();
      return;
    }
    super.handleInput(data);
  }
}
