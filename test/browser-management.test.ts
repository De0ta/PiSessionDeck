import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { SessionManager, type ExtensionContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { SessionBrowser, type BrowserAction } from "../src/browser.ts";
import { filterSessions, GROUP_MODES, groupRows, isUnsaved, PINNED_GROUP, sessionIdentity } from "../src/model.ts";
import type { PinStore } from "../src/pins.ts";
import { createRepository } from "../src/repository.ts";
import { createTitleStore } from "../src/titles.ts";
import { cwd, deferred, session, tick } from "./fixtures.ts";

function fixture(items: SessionInfo[], options: { pins?: Map<string, number>; list?: () => Promise<SessionInfo[]> } = {}) {
  const times = options.pins ?? new Map<string, number>();
  const actions: { action: BrowserAction; session?: SessionInfo }[] = [];
  const writes: boolean[] = [];
  let clock = 100;
  let height = 30;
  const pins: PinStore = { read: async (s) => times.get(sessionIdentity(s)),
    write: async (s, pinned) => { writes.push(pinned); if (pinned) times.set(sessionIdentity(s), ++clock); else times.delete(sessionIdentity(s)); },
    remove: async (s) => { times.delete(sessionIdentity(s)); } };
  const browser = new SessionBrowser({ cwd, currentFile: items[0]?.path, pins,
    repository: { list: options.list ?? (async () => items), preview: async () => ({ messages: [] }), rename: async () => {} },
    theme: { style: (text) => text }, keybindings: { matches: (data, action) => matchesKey(data, action === "tui.select.up" ? "up" : "down") },
    height: () => height, requestRender() {}, done() {}, onAction: (action, selected) => actions.push({ action, session: selected }),
  });
  return { browser, times, writes, actions, set height(value: number) { height = value; } };
}
const text = (browser: SessionBrowser) => stripVTControlCharacters(browser.render(160).join("\n"));
const selectedId = (browser: SessionBrowser) => browser.selected?.id;

test("Pinned is unique, newest-pin-first, independently expandable and filtered before grouping in every mode", () => {
  const items = Array.from({ length: 9 }, (_, i) => session(String(i), { cwd: i === 8 ? join(cwd, "other") : cwd }));
  const pinnedAt = (s: SessionInfo) => Number(s.id) < 7 ? Number(s.id) + 1 : undefined;
  for (const mode of GROUP_MODES) {
    const rows = groupRows(items, new Map(), { mode, pinnedAt });
    assert.deepEqual(rows[0], { kind: "group", key: PINNED_GROUP, label: "Pinned", count: 7 });
    assert.deepEqual(rows.filter((row) => row.kind === "session").map((row) => row.session.id).slice(0, 5), ["6", "5", "4", "3", "2"]);
    assert.ok(rows.some((row) => row.kind === "more" && row.key === PINNED_GROUP && row.remaining === 2));
    const all = groupRows(items, new Map([[PINNED_GROUP, 10]]), { mode, pinnedAt });
    const ids = all.filter((row) => row.kind === "session").map((row) => row.session.id);
    assert.equal(ids.length, 9); assert.equal(new Set(ids).size, 9);
    const filtered = groupRows(filterSessions(items, "7", "project", cwd), new Map(), { mode, pinnedAt });
    assert.deepEqual(filtered.filter((row) => row.kind === "session").map((row) => row.session.id), ["7"]);
    assert.ok(!filtered.some((row) => row.kind === "group" && row.key === PINNED_GROUP));
  }
});

test("management keys dispatch only in browse mode; search and rename keep literal input; Show more cannot be managed", async () => {
  const f = fixture(Array.from({ length: 7 }, (_, i) => session(String(i)))); await tick();
  for (const key of ["n", "f", "a", "\x1b[3~"]) f.browser.handleInput(key);
  assert.deepEqual(f.actions.map((value) => value.action), ["new", "fork", "menu", "delete"]);
  assert.ok(f.actions.slice(1).every((value) => value.session?.id === "0"));
  f.browser.handleInput("\x1b[13~");
  for (const key of ["n", "f", "a", "p"]) f.browser.handleInput(key);
  assert.equal(f.actions.length, 4); assert.equal(f.writes.length, 0);
  assert.match(text(f.browser), /nfap/);
  f.browser.handleInput("\x1b");
  f.browser.handleInput("r");
  for (const key of ["n", "f", "a", "p"]) f.browser.handleInput(key);
  assert.equal(f.actions.length, 4); assert.match(text(f.browser), /nfap/);
  f.browser.handleInput("\x1b");
  for (let i = 0; i < 5; i++) f.browser.handleInput("\x1b[B");
  assert.equal(f.browser.selected, undefined);
  f.browser.handleInput("f"); f.browser.handleInput("p"); f.browser.handleInput("\x1b[3~");
  assert.equal(f.actions.length, 4); assert.equal(f.writes.length, 0);
  f.browser.handleInput("n"); assert.equal(f.actions.at(-1)?.action, "new");
  f.browser.close();
});

test("pin/unpin preserves selection even in collapsed destination; pinned Show more follows pin order", async () => {
  const items = Array.from({ length: 12 }, (_, i) => session(String(i), { modified: new Date(10000 - i) }));
  const times = new Map(items.slice(0, 7).map((s, i) => [sessionIdentity(s), i + 1]));
  const f = fixture(items, { pins: times }); await tick();
  // Current item 0 is beyond the collapsed pinned five; initially choose a visible item.
  for (let i = 0; i < 5; i++) f.browser.handleInput("\x1b[B");
  assert.equal(f.browser.selected, undefined);
  f.browser.handleInput("\r"); await tick();
  assert.equal(selectedId(f.browser), "1", "sixth pinned row follows pin time, not activity order");
  await f.browser.togglePin(f.browser.selected!);
  assert.equal(selectedId(f.browser), "1"); assert.match(text(f.browser), /会话 1/);
  await f.browser.togglePin(f.browser.selected!);
  assert.equal(selectedId(f.browser), "1"); assert.ok(text(f.browser).indexOf("会话 1") < text(f.browser).indexOf("会话 6"));
  for (let i = 0; i < 4; i++) { f.browser.handleInput("g"); assert.match(text(f.browser), /Pinned/); }
  f.browser.close();
});

test("pin persistence survives refresh; success beats a stale scan and deletion cannot be resurrected", async () => {
  const items = [session("a"), session("b"), session("c")];
  const pending = deferred<SessionInfo[]>(); let scans = 0;
  const f = fixture(items, { list: () => ++scans === 1 ? Promise.resolve(items) : pending.promise }); await tick();
  await f.browser.togglePin(items[0]!); assert.match(text(f.browser), /Pinned/);
  const refresh = f.browser.refresh();
  f.browser.removeSession(items[0]!);
  pending.resolve(items); await refresh;
  assert.notEqual(f.browser.selected?.id, "a"); assert.doesNotMatch(text(f.browser), /会话 a/);
  assert.equal(f.browser.selected?.id, "b"); f.browser.close();
});

test("empty browser can create; tiny windows stay bounded and management help is scrollable", async () => {
  const f = fixture([]); await tick(); f.browser.handleInput("n"); assert.equal(f.actions[0]?.action, "new");
  f.browser.handleInput("?");
  for (const height of [1, 2, 7, 30]) for (const width of [1, 2, 20, 100, 160]) {
    f.height = height; const rows = f.browser.render(width);
    assert.equal(rows.length, height); assert.ok(rows.every((row) => visibleWidth(row) === width));
  }
  f.browser.close();
});

test("new unsaved current session is an explicitly transient row without writing any history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viewer-unsaved-"));
  try {
    const project = join(dir, "project"); const sessions = join(dir, "sessions"); await mkdir(project); await mkdir(sessions);
    const manager = SessionManager.create(project, sessions);
    const file = manager.getSessionFile()!;
    // Project-only scan avoids all real user history.
    const ctx = { cwd: project, sessionManager: manager } as unknown as ExtensionContext;
    const repository = createRepository(ctx, undefined, createTitleStore(join(dir, "titles")));
    const result = await repository.list("project", new AbortController().signal);
    assert.equal(result.length, 1); assert.equal(result[0]?.id, manager.getSessionId());
    assert.ok(isUnsaved(result[0]!)); assert.match(result[0]?.name ?? "", /not saved/);
    await assert.rejects(readFile(file), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
