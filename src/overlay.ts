import type { OverlayHandle } from "@earendil-works/pi-tui";

/** Ordinary host dialogs render below overlays. Never leave them focused but invisible. */
export function createFocusGuard(close: () => void): {
  visible(): boolean;
  onHandle(handle: OverlayHandle): void;
} {
  let handle: OverlayHandle | undefined;
  let yielding = false;
  return {
    onHandle(value) { handle = value; },
    visible() {
      // showOverlay checks visibility before assigning initial focus/returning its handle.
      if (!handle) return true;
      if (yielding) return false;
      if (handle.isFocused()) return true;
      yielding = true;
      // Suppress this frame immediately; remove safely outside the compositor/focus change.
      queueMicrotask(close);
      return false;
    },
  };
}
