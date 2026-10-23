import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { parseSessionEntries, SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, parseColor, styleText, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { SessionBrowser } from "../src/browser.ts";
import { colorPromptAddresses, COLORS, detailLines, painter } from "../src/details.ts";
import { firstExchangeFromManager, previewFromManager } from "../src/repository.ts";
import { cwd, header, jsonl, session, tick, user } from "./fixtures.ts";

const theme = { style: (text: string, options: Parameters<typeof styleText>[1]) => styleText(text, options, "truecolor") };
const paint = painter(theme);
function fixture(sessions = [session("a")]) {
  const done: (SessionInfo | undefined)[] = [];
  const browser = new SessionBrowser({ cwd, repository: { list: async () => sessions, preview: async () => ({ messages: [] }), rename: async () => {} }, theme,
    keybindings: { matches: (data, action) => matchesKey(data, action === "tui.select.up" ? "up" : "down") }, height: () => 28, requestRender() {}, done: (s) => done.push(s) });
  browser.focused = true;
  return { browser, done };
}
const assistant = (id: string, parentId: string, text: string) => ({ type: "message", id, parentId, timestamp: header.timestamp,
  message: { role: "assistant", content: [{ type: "text", text }], provider: "fake", model: "fake", timestamp: 1, stopReason: "stop" } });

test("Prompt跟随最后回复的提问，不被排队的新问题错配；自动标题仍取首轮", () => {
  const memory = SessionManager.inMemory(cwd, undefined, parseSessionEntries(jsonl(header,
    user("u1", null, "First prompt"), assistant("a1", "u1", "First reply"),
    user("u2", "a1", "Secret second"), assistant("a2", "u2", "Last reply"),
    { type: "context_edit", id: "e", parentId: "a2", timestamp: header.timestamp, targetId: "u2", replacement: { content: "Safe second prompt" } },
    user("queued", "e", "Queued question without reply"),
  )));
  assert.equal(previewFromManager(memory).details?.prompt, "Safe second prompt");
  assert.equal(previewFromManager(memory).details?.lastMessage, "Last reply");
  assert.deepEqual(firstExchangeFromManager(memory), { prompt: "First prompt", reply: "First reply" });
  memory.appendContextEdit("u2", null);
  assert.equal(previewFromManager(memory).details?.prompt, "[Omitted from context]", "never substitute the earlier question");
});

test("命名取首轮最终回复，不用工具调用前的准备性解说", () => {
  const memory = SessionManager.inMemory(cwd, undefined, parseSessionEntries(jsonl(header,
    user("u", null, "Diagnose the bug"), assistant("comment", "u", "I will investigate"),
    assistant("final", "comment", "The actual issue is an invalid timeout"),
    user("u2", "final", "Another topic"), assistant("a2", "u2", "Another answer"),
  )));
  assert.deepEqual(firstExchangeFromManager(memory), { prompt: "Diagnose the bug", reply: "The actual issue is an invalid timeout" });
});

test("无回复时显示最新提问；标题输入不包含后续轮次", () => {
  const memory = SessionManager.inMemory(cwd);
  memory.appendMessage({ role: "user", content: "First", timestamp: 1 });
  memory.appendMessage({ role: "user", content: "Latest", timestamp: 2 });
  assert.equal(previewFromManager(memory).details?.prompt, "Latest");
  assert.deepEqual(firstExchangeFromManager(memory), { prompt: "First", reply: undefined });
});

test("右方向键等同Enter恢复，Show more则展开，宽窄屏一致", async () => {
  for (const width of [60, 140]) {
    const f = fixture(); await tick(); f.browser.render(width); f.browser.handleInput("\x1b[C");
    assert.equal(f.done[0]?.id, "a");
    const more = fixture(Array.from({ length: 7 }, (_, i) => session(String(i), { modified: new Date(100 - i) })));
    await tick(); more.browser.render(width);
    for (let i = 0; i < 5; i++) more.browser.handleInput("\x1b[B");
    more.browser.handleInput("\x1b[C"); await tick();
    assert.equal(more.browser.selected?.id, "5");
    assert.equal(more.done.length, 0); more.browser.close();
  }
});

test("搜索栏默认不占行、只在搜索/重命名时出现，r在搜索中仍是普通文本", async () => {
  const f = fixture(); await tick();
  const screen = () => stripVTControlCharacters(f.browser.render(140).join("\n"));
  assert.doesNotMatch(screen(), /Search ›|Rename ›/);
  f.browser.handleInput("\x1bOR"); f.browser.handleInput("r");
  assert.match(screen(), /Search › r/); assert.doesNotMatch(screen(), /Rename ›/);
  f.browser.handleInput("\x1b"); assert.doesNotMatch(screen(), /Search ›/);
  f.browser.handleInput("r"); assert.match(screen(), /Rename ›/);
  f.browser.handleInput("\x1b"); assert.doesNotMatch(screen(), /Rename ›/);
  assert.ok(f.browser.render(140).every((s) => visibleWidth(s) === 140)); f.browser.close();
});

test("Status列标题为灰色，每行状态为灰白色，Updated仍为灰色", async () => {
  const f = fixture(); await tick(); const lines = f.browser.render(160);
  const selected = lines.find((s) => stripVTControlCharacters(s).includes("Saved"))!;
  const whiteStatus = theme.style(" Saved     ", { fg: parseColor(COLORS.text), bg: parseColor(COLORS.selected), bold: false });
  assert.ok(selected.includes(whiteStatus));
  const heading = lines.find((s) => stripVTControlCharacters(s).includes("Status"))!;
  assert.ok(heading.includes("38;2;146;146;146"));
  f.browser.close();
});

test("Prompt中的裸URL、Markdown链接和本地路径均彩色，OSC内容不被改写", () => {
  const prompt = "https://example.com/a\n[资料](https://example.org/docs)\nD:/project/src/main.ts\n/home/user/project";
  const result = detailLines({ session: session("a"), preview: { messages: [], details: { prompt, lastMessage: "Reply" } },
    status: "Saved", current: false, width: 100, height: 45, offset: 0, paint });
  const lines = result.lines.slice(result.lines.findIndex((s) => stripVTControlCharacters(s) === "Prompt") + 1);
  const text = stripVTControlCharacters(lines.join("\n"));
  for (const address of ["https://example.com/a", "D:/project/src/main.ts", "/home/user/project"]) {
    assert.ok(text.includes(address), address);
    const line = lines.find((s) => stripVTControlCharacters(s).includes(address))!;
    assert.ok(line.includes("38;2;117;181;255"), `${address} should be blue`);
  }
  const labelled = lines.find((s) => stripVTControlCharacters(s).includes("资料"))!;
  assert.ok(labelled.includes(paint("资料", COLORS.blue)), "label color must override nested default-text color");
  assert.ok(lines.join("").includes("https://example.org/docs"), "URL remains inline or in an OSC hyperlink");
  const osc = "\x1b]8;;https://example.com\x1b\\";
  assert.ok(colorPromptAddresses(osc + "Link" + "\x1b]8;;\x1b\\", paint).includes(osc));
});

function styledText(text: string) {
  let foreground = "";
  let bold = false;
  const chars: { value: string; foreground: string; bold: boolean }[] = [];
  for (const token of text.split(/(\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]))/g)) {
    if (token.startsWith("\x1b")) {
      const sgr = /^\x1b\[([\d;]*)m$/.exec(token);
      const codes = sgr?.[1]?.split(";").map(Number) ?? [];
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 38 && codes[i + 1] === 2) {
          foreground = "#" + codes.slice(i + 2, i + 5).map((n) => n.toString(16).padStart(2, "0")).join(""); i += 4;
        } else if (code === 39 || code === 0) foreground = "";
        if (code === 1) bold = true;
        else if (code === 22 || code === 0) bold = false;
      }
    } else chars.push(...token.split("").map((value) => ({ value, foreground, bold })));
  }
  return { plain: chars.map((c) => c.value).join(""), chars };
}

function assertColor(line: string, value: string, color: string) {
  const styled = styledText(line);
  const index = styled.plain.indexOf(value);
  assert.ok(index >= 0, `missing ${value}`);
  assert.ok(styled.chars.slice(index, index + value.length).every((c) => c.foreground === color), `${value} must be ${color}`);
}

test("Prompt标题、引用、代码块地址统一蓝色，链接保留加粗/原生样式", () => {
  const plain = (text: string) => text;
  const markdownTheme: MarkdownTheme = { heading: (s) => paint(s, COLORS.green, true), link: plain, linkUrl: plain,
    code: (s) => paint(s, COLORS.provider), codeBlock: (s) => paint(s, COLORS.provider), codeBlockBorder: plain,
    quote: (s) => paint(s, COLORS.dim), quoteBorder: plain, hr: plain, listBullet: plain,
    bold: (s) => theme.style(s, { bold: true }), italic: plain, strikethrough: plain, underline: (s) => theme.style(s, { underline: true }),
    highlightCode: (code) => code.split("\n").map((s) => s.replace("/code", paint("/code", COLORS.provider))),
  };
  const result = detailLines({ session: session("a"), preview: { messages: [], details: { lastMessage: "Reply",
    prompt: "# Heading /heading/project\n\n> Quote /quote/project\n\n```text\n/code/project\n```\n\n[**Docs**](https://example.com)" } },
    status: "Saved", current: false, width: 100, height: 70, offset: 0, paint, markdownTheme });
  const lines = result.lines.slice(result.lines.findIndex((s) => stripVTControlCharacters(s) === "Prompt") + 1);
  for (const value of ["/heading/project", "/quote/project", "/code/project", "Docs"]) {
    const line = lines.find((s) => stripVTControlCharacters(s).includes(value))!;
    assertColor(line, value, COLORS.blue);
    if (value === "Docs") {
      const styled = styledText(line); const index = styled.plain.indexOf(value);
      assert.ok(styled.chars.slice(index, index + value.length).every((c) => c.bold), "link emphasis must survive foreground override");
    }
  }
});

test("窄屏软换行后标题、引用和代码块地址的所有续行仍蓝色", () => {
  const path = "/really/long/engineering/workspace/components/session/browser/project";
  for (const prompt of [`# ${path}`, `> ${path}`, `\`\`\`text\n${path}\n\`\`\``, `**${path}**`]) {
    const result = detailLines({ session: session("a"), preview: { messages: [], details: { lastMessage: "Reply", prompt } },
      status: "Saved", current: false, width: 24, height: 80, offset: 0, paint });
    const lines = result.lines.slice(result.lines.findIndex((s) => stripVTControlCharacters(s) === "Prompt") + 1);
    const address = lines.filter((s) => !stripVTControlCharacters(s).trim().startsWith("```"));
    const characters = address.flatMap((s) => styledText(s).chars).filter((c) => !/[│\s]/.test(c.value));
    assert.equal(characters.map((c) => c.value).join(""), path, prompt);
    assert.ok(characters.every((c) => c.foreground === COLORS.blue), prompt);
  }
});

test("右栏标题前留空行，状态前有独立着色圆圈，Reasoning与分行Project隔开", () => {
  const result = detailLines({ session: session("a", { name: "A task" }), preview: { messages: [], details: { lastMessage: "Reply", prompt: "Question", reasoning: "high" } },
    status: "Completed", current: false, width: 80, height: 30, offset: 0, paint });
  const plain = result.lines.map(stripVTControlCharacters);
  assert.equal(plain[0], ""); assert.equal(plain[1], "A task");
  const status = result.lines.find((s) => stripVTControlCharacters(s) === "○ Completed")!;
  assertColor(status, "Completed", COLORS.text); assertColor(status, "○", COLORS.green);
  const reasonIndex = plain.indexOf("Reasoning: high");
  assert.deepEqual(plain.slice(reasonIndex + 1, reasonIndex + 4), ["", "Project:", cwd]);
});

test("过滤栏、帮助、加载提示和底栏所有按键名均白色", async () => {
  const f = fixture();
  const loading = f.browser.render(160).find((s) => stripVTControlCharacters(s).includes("Esc to cancel"))!;
  assertColor(loading, "Esc", COLORS.white);
  await tick();
  let lines = f.browser.render(160);
  const filter = lines.find((s) => stripVTControlCharacters(s).includes("Tab filter"))!;
  assertColor(filter, "Tab", COLORS.white); assertColor(filter, "F3", COLORS.white);
  assertColor(lines.at(-1)!, "Enter/→", COLORS.white);
  f.browser.handleInput("?");
  for (const width of [80, 160]) {
    lines = f.browser.render(width);
    const help = lines.find((s) => stripVTControlCharacters(s).includes("Enter / →"))!;
    assertColor(help, "Enter / →", COLORS.white);
  }
  f.browser.close();
});
