import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { SessionBrowser } from "../src/browser.ts";
import { ResumePage } from "../src/resume.ts";
import { ActionDialog } from "../src/action-dialog.ts";
import { COLORS, painter, reasoningColor } from "../src/details.ts";
import { sessionColor } from "../src/model.ts";
import { cwd, session, tick } from "./fixtures.ts";
import { backgrounds, foregrounds, testTheme } from "./theme-fixture.ts";

const keybindings = { matches: (data: string, action: string) => matchesKey(data, action === "tui.select.up" ? "up" : "down") };
function fixture(theme: { style: ReturnType<typeof testTheme>["style"] }) {
  const options = { cwd, theme, keybindings, height: () => 30, requestRender() {} };
  const browser = new SessionBrowser({ ...options,
    repository: { list: async () => [session("a", { name: "Selected task" }), session("b", { name: "Other task" })],
      preview: async () => ({ messages: [], details: { prompt: "Question /some/path", lastMessage: "Theme-aware reply", reasoning: "high" } }) },
    done() {},
  });
  return { options, browser };
}

for (const appearance of ["dark", "light"] as const) {
  test(`${appearance}: default canvas, themed selection/search/panels and identity colors`, async () => {
    const theme = testTheme({ text: appearance === "dark" ? "#cdd6f4" : "#4c4f69", accent: "#89b4fa", muted: "#7f849c" },
      { selectedBg: "#313244", userMessageBg: "#45475a", customMessageBg: "#585b70" });
    const { options, browser } = fixture(theme);
    await tick();
    for (const width of [60, 140]) {
      const lines = browser.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) === width));
      assert.ok(lines[0]!.startsWith("\x1b[49m"), "explicit default background, independent of terminal reports");
      assert.ok(!lines[0]!.includes("\x1b[48;"), "header must never fill a guessed RGB background");
      assert.ok(!lines.at(-1)!.includes("\x1b[48;"), "footer keeps terminal background too");
      const selected = lines.find((line) => stripVTControlCharacters(line).includes("Selected task"))!;
      assert.ok(selected.includes(theme.getBgAnsi("selectedBg")));
      const other = lines.find((line) => stripVTControlCharacters(line).includes("Other task"))!;
      assert.ok(!other.includes("\x1b[48;"), "unselected rows do not inherit selection background");
      assert.ok(other.includes(painter(theme)("Other task", sessionColor("b"))));
    }
    browser.handleInput("\x1b[13~");
    const search = browser.render(140).find((line) => stripVTControlCharacters(line).includes("Search ›"))!;
    assert.ok(search.includes(theme.getBgAnsi("userMessageBg")));
    assert.ok(search.includes(painter(theme)("Search › ", COLORS.blue, true)));
    const page = new ResumePage({ ...options, session: session("b"), confirm() {}, back() {} });
    const dialog = new ActionDialog({ ...options, title: "Actions", description: [], choices: ["Continue", "Cancel"], select() {}, back() {} });
    for (const lines of [page.render(100), dialog.render(72)]) {
      assert.ok(lines.some((line) => line.includes(theme.getBgAnsi("customMessageBg"))));
      assert.ok(lines.some((line) => line.includes(theme.getBgAnsi("selectedBg"))));
      assert.ok(!lines.join("").includes("48;2;12;12;12"));
      assert.ok(!lines.join("").includes("48;2;38;38;38"));
    }
    browser.close();
  });
}

test("no terminal reports: ANSI foreground and default-background fallback needs no RGB guess", async () => {
  const fg = Object.fromEntries(Object.keys(foregrounds).map((key) => [key, key === "text" ? "" : 6]));
  const bg = Object.fromEntries(Object.keys(backgrounds).map((key) => [key, ""]));
  const theme = testTheme(fg, bg, "256color");
  const { options, browser } = fixture(theme);
  await tick();
  browser.handleInput("\x1b[13~");
  const page = new ResumePage({ ...options, session: session("a"), confirm() {}, back() {} });
  const dialog = new ActionDialog({ ...options, title: "Actions", description: [], choices: ["OK"], select() {}, back() {} });
  for (const lines of [browser.render(140), page.render(80), dialog.render(60)]) {
    const output = lines.join("\n");
    assert.ok(output.includes("\x1b[49m"));
    assert.ok(!output.includes("\x1b[48;"));
    assert.ok(!output.includes(";2;"), "fallback does not invent truecolor values");
  }
  browser.close();
});

test("invalidate rebuilds cached details after a live theme change without reloading history", async () => {
  let active = testTheme({ text: "#cdd6f4", accent: "#89b4fa" });
  const { browser } = fixture({ style: (text, options) => active.style(text, options) });
  await tick();
  const before = browser.render(140).join("\n");
  assert.ok(before.includes(painter(active)("Theme-aware reply")));
  active = testTheme({ text: "#4c4f69", accent: "#1e66f5" });
  browser.invalidate();
  const after = browser.render(140).join("\n");
  assert.equal(stripVTControlCharacters(after), stripVTControlCharacters(before));
  assert.ok(after.includes(painter(active)("Theme-aware reply")));
  assert.ok(!after.includes("38;2;205;214;244"), "cached dark-theme text must not survive invalidation");
  browser.close();
});

test("reasoning colors use Pi thinking roles instead of a fixed RGB ramp", () => {
  for (const [level, role] of Object.entries({ off: "thinkingOff", minimal: "thinkingMinimal", low: "thinkingLow", medium: "thinkingMedium", high: "thinkingHigh", xhigh: "thinkingXhigh", max: "thinkingMax" })) {
    assert.equal(reasoningColor(level), role);
  }
  assert.equal(reasoningColor("unknown"), "muted");
});
