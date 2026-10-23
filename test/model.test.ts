import assert from "node:assert/strict";
import test from "node:test";
import { activityTime, filterSessions, groupRows, mergeSessions, pathKey, safeText, sessionTitle } from "../src/model.ts";
import { isBrowserTrigger } from "../src/editor.ts";
import { cwd, session } from "./fixtures.ts";

test("空输入左键：普通箭头和 Kitty；文本、空格、换行和补全不触发", () => {
  assert.equal(isBrowserTrigger("\x1b[D", "", false), true);
  assert.equal(isBrowserTrigger("\x1b[1;1D", "", false), true);
  for (const text of ["a", " ", "\n", "中文"]) assert.equal(isBrowserTrigger("\x1b[D", text, false), false);
  assert.equal(isBrowserTrigger("\x1b[D", "", true), false);
  for (const key of ["\x1b[C", "\x1b[1;5D", "\r", "a", "\x1b"]) assert.equal(isBrowserTrigger(key, "", false), false);
});

test("搜索覆盖标题、项目、ID、消息；多词 AND；当前项目范围", () => {
  const a = session("first", { name: "修复界面", allMessagesText: "TypeScript 中文预览" });
  const b = session("second", { cwd: `${cwd}-other`, allMessagesText: "TypeScript 中文预览" });
  assert.deepEqual(filterSessions([a, b], "typescript 中文", "project", cwd), [a]);
  assert.deepEqual(filterSessions([a, b], "second", "all", cwd), [b]);
  assert.deepEqual(filterSessions([a], "修复界面", "project", cwd), [a]);
  assert.deepEqual(filterSessions([a], "missing", "all", cwd), []);
});

test("按活动时间排序、按项目分组，路径去重", () => {
  const old = session("old", { modified: new Date(0) });
  const other = session("other", { cwd: `${cwd}-other`, modified: new Date(20) });
  const recent = session("recent", { modified: new Date(30) });
  const sorted = filterSessions([old, other, recent], "", "all", cwd);
  assert.deepEqual(sorted.map((s) => s.id), ["recent", "other", "old"]);
  assert.deepEqual(groupRows(sorted).map((r) => r.kind === "project" ? r.cwd : r.session.id), [cwd, "recent", "old", `${cwd}-other`, "other"]);
  assert.equal(mergeSessions([old], [old, recent]).length, 2);
});

test("Windows 路径大小写/分隔符；POSIX 保留大小写；根目录不折叠", () => {
  assert.equal(pathKey("C:\\Projects\\Alpha\\", "win32"), pathKey("c:/projects/alpha", "win32"));
  assert.equal(pathKey("C:/", "win32"), "c:\\");
  assert.equal(pathKey("/", "linux"), "/");
  assert.notEqual(pathKey("/A", "linux"), pathKey("/a", "linux"));
  assert.equal(pathKey("", "win32"), "");
});

test("显示数据清除终端逃逸、控制符和多行标题", () => {
  assert.equal(safeText("\x1b[31m红\x1b[0m\x07\n标题"), "红 标题");
  assert.equal(safeText("行一\n行二", true), "行一\n行二");
  assert.equal(sessionTitle(session("a", { name: "  标题\n二  " })), "标题 二");
  assert.equal(activityTime(new Date(Number.NaN)), "Unknown");
});
