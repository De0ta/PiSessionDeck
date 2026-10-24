import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { captureSessionRevision, deleteSession, forkHistorySession } from "../src/management.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const signal = () => new AbortController().signal;
const jsonl = (entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
const entry = (type: string, id: string, parentId: string | null, fields: Record<string, unknown> = {}) =>
  ({ type, id, parentId, timestamp, ...fields });
const user = (id: string, parentId: string | null, text = "Question") =>
  entry("message", id, parentId, { message: { role: "user", content: text, timestamp: 1767225600000 } });
const assistant = (id: string, parentId: string) => entry("message", id, parentId, {
  message: {
    role: "assistant", content: [{ type: "text", text: "Final answer" }],
    api: "openai-responses", provider: "openai", model: "gpt-5", stopReason: "stop",
    timestamp: 1767225600001,
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  },
});

type RawEntry = Record<string, any>;
async function fixture(run: (f: {
  dir: string; session: SessionInfo; header: RawEntry;
  put: (entries: unknown[], newline?: boolean) => Promise<void>;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-management-"));
  const path = join(dir, "source.jsonl");
  const id = randomUUID();
  const header = { type: "session", version: 3, id, cwd: dir, timestamp };
  const session: SessionInfo = {
    id, path, cwd: dir, name: "Original title", created: new Date(timestamp), modified: new Date(timestamp),
    messageCount: 2, firstMessage: "Question", allMessagesText: "Question\nFinal answer",
  };
  const put = async (entries: unknown[], newline = true) => {
    const bytes = jsonl(entries);
    await writeFile(path, newline ? bytes : bytes.slice(0, -1));
  };
  try {
    await put([header, user("u", null), assistant("a", "u")]);
    await run({ dir, session, header, put });
  } finally {
    // Restore only our fixture's permissions, including when an assertion fails.
    await chmod(path, 0o600).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

async function snapshot(path: string) {
  return { bytes: await readFile(path), mtimeMs: (await stat(path)).mtimeMs };
}
async function unchanged(path: string, before: Awaited<ReturnType<typeof snapshot>>) {
  assert.deepEqual(await snapshot(path), before, "source bytes and mtime must remain unchanged");
}
async function fork(session: SessionInfo, dir: string): Promise<RawEntry[]> {
  const before = new Set(await readdir(dir));
  await forkHistorySession(session, signal());
  const created = (await readdir(dir)).filter((name) => !before.has(name));
  assert.equal(created.length, 1, "fork must create exactly one sibling file");
  assert.match(created[0]!, /\.jsonl$/);
  const text = await readFile(join(dir, created[0]!), "utf8");
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

async function rejectsReadAndFork(session: SessionInfo, dir: string, invalidHeader = true) {
  const before = await snapshot(session.path);
  const names = await readdir(dir);
  if (invalidHeader) await assert.rejects(async () => captureSessionRevision(session, signal()));
  else await captureSessionRevision(session, signal());
  await assert.rejects(async () => forkHistorySession(session, signal()));
  await unchanged(session.path, before);
  assert.deepEqual(await readdir(dir), names, "invalid input must not leave a fork behind");
}

test("capture and fork accept a read-only source without changing bytes or mtime", async () => {
  await fixture(async ({ session, dir }) => {
    await chmod(session.path, 0o444);
    const before = await snapshot(session.path);
    assert.ok(await captureSessionRevision(session, signal()));
    await fork(session, dir);
    await unchanged(session.path, before);
  });
});

for (const field of ["id", "cwd"] as const) {
  test(`rejects SessionInfo/header ${field} mismatch`, async () => {
    await fixture(async ({ session, dir }) => {
      const stale = { ...session, [field]: field === "id" ? randomUUID() : join(dir, "different") };
      await rejectsReadAndFork(stale, dir);
    });
  });
}

for (const kind of ["empty", "malformed header", "missing header", "malformed JSON tail", "missing parent", "cycle", "duplicate id"] as const) {
  test(`rejects ${kind} without repairing the source`, async () => {
    await fixture(async ({ session, header, dir, put }) => {
      switch (kind) {
        case "empty": await writeFile(session.path, ""); break;
        case "malformed header": await put([{ ...header, id: undefined }]); break;
        case "missing header": await put([user("u", null)]); break;
        case "malformed JSON tail": await writeFile(session.path, jsonl([header, user("u", null)]) + '{"type":"message"'); break;
        case "missing parent": await put([header, user("u", "absent")]); break;
        case "cycle": await put([header, user("u", "a"), assistant("a", "u")]); break;
        case "duplicate id": await put([header, user("u", null), user("u", null)]); break;
      }
      await rejectsReadAndFork(session, dir, ["empty", "malformed header", "missing header"].includes(kind));
    });
  });
}

test("rejects sources larger than 16 MiB", async () => {
  await fixture(async ({ session, header, dir }) => {
    await writeFile(session.path, jsonl([header, user("u", null, "x".repeat(16 * 1024 * 1024))]));
    assert.ok((await stat(session.path)).size > 16 * 1024 * 1024);
    await rejectsReadAndFork(session, dir, false);
  });
});

test("accepts complete final JSON without newline, without repairing it", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    await put([header, user("u", null), assistant("a", "u")], false);
    const before = await snapshot(session.path);
    await captureSessionRevision(session, signal());
    const entries = await fork(session, dir);
    assert.deepEqual(entries.find((e) => e.id === "a"), assistant("a", "u"));
    await unchanged(session.path, before);
  });
});

test("refuses symlinks for capture, fork, and deletion", async (t) => {
  await fixture(async ({ session, dir }) => {
    const revision = await captureSessionRevision(session, signal());
    const link = join(dir, "link.jsonl");
    try { await symlink(session.path, link, "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        t.skip("platform does not permit file symlinks"); return;
      }
      throw error;
    }
    const before = await snapshot(session.path);
    const linked = { ...session, path: link };
    await rejectsReadAndFork(linked, dir);
    await assert.rejects(async () => deleteSession(linked, revision, signal()));
    await unchanged(session.path, before);
    assert.ok((await readdir(dir)).includes("link.jsonl"));
  });
});

test("deletion rejects a changed revision and preserves the changed source", async () => {
  await fixture(async ({ session, header, put }) => {
    const revision = await captureSessionRevision(session, signal());
    await put([header, user("u", null), assistant("a", "u"), entry("session_info", "title", "a", { name: "Changed" })]);
    const before = await snapshot(session.path);
    await assert.rejects(async () => deleteSession(session, revision, signal()));
    await unchanged(session.path, before);
  });
});

test("pre-aborted capture, fork, and deletion leave all files untouched", async () => {
  await fixture(async ({ session, dir }) => {
    const revision = await captureSessionRevision(session, signal());
    const controller = new AbortController(); controller.abort();
    const before = await snapshot(session.path);
    const names = await readdir(dir);
    await assert.rejects(async () => captureSessionRevision(session, controller.signal));
    await assert.rejects(async () => forkHistorySession(session, controller.signal));
    await assert.rejects(async () => deleteSession(session, revision, controller.signal));
    await unchanged(session.path, before);
    assert.deepEqual(await readdir(dir), names);
  });
});

test("successful deletion removes only the selected file", async () => {
  await fixture(async ({ session, dir }) => {
    const sibling = join(dir, "keep.jsonl");
    await writeFile(sibling, "unrelated bytes\n");
    const before = await snapshot(sibling);
    const revision = await captureSessionRevision(session, signal());
    await deleteSession(session, revision, signal());
    await assert.rejects(stat(session.path), { code: "ENOENT" });
    await unchanged(sibling, before);
    assert.deepEqual(await readdir(dir), ["keep.jsonl"]);
  });
});

test("fork uses last physical entry, preserves native metadata and final assistant, and gives a safe title", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const branch = [
      user("u", null),
      entry("model_change", "model", "u", { provider: "openai", modelId: "gpt-5" }),
      entry("thinking_level_change", "thinking", "model", { thinkingLevel: "high" }),
      entry("custom", "native", "thinking", { customType: "extension-state", data: { nested: [1, "keep"] } }),
      entry("context_edit", "edit", "native", { targetId: "u", replacement: { content: "Edited question" } }),
      entry("compaction", "compact", "edit", { summary: "Summary", firstKeptEntryId: "u", tokensBefore: 123, details: { native: true } }),
      assistant("a", "compact"),
    ];
    const title = entry("session_info", "title", "a", { name: "Unsafe\u001b[31m\nTitle" });
    await put([header, ...branch.slice(0, -1), user("unrelated", "u", "Other branch"), branch.at(-1), title]);
    const before = await snapshot(session.path);
    const entries = await fork(session, dir);
    assert.equal(entries[0]!.type, "session");
    assert.equal(entries[0]!.version, 3);
    assert.match(entries[0]!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(entries[0]!.id, session.id);
    assert.equal(entries[0]!.cwd, session.cwd);
    assert.equal(entries[0]!.parentSession, session.path);
    for (const original of branch) assert.deepEqual(entries.find((e) => e.id === original.id), original);
    assert.ok(!entries.some((e) => e.id === "unrelated"));
    const final = entries.at(-1)!;
    assert.equal(final.type, "session_info");
    assert.equal(typeof final.name, "string");
    assert.ok(final.name.trim().length > 0);
    assert.doesNotMatch(final.name, /[\x00-\x1f\x7f]/);
    assert.match(final.name, /(?:fork|分叉|副本|分支)/i, "fork title must carry a recognizable suffix");
    assert.notEqual(final.id, "title");
    assert.equal(final.parentId, "title");
    await unchanged(session.path, before);
  });
});

test("fork retains full reference closure including offbranch fromId ancestors, not unrelated branches", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const root = user("root", null);
    const referenced = [user("off-root", "root"), assistant("off-leaf", "off-root")];
    const summary = entry("branch_summary", "summary", "root", { fromId: "off-leaf", summary: "Earlier work", details: { keep: true } });
    const edit = entry("context_edit", "edit", "summary", { targetId: "root", replacement: null });
    const label = entry("label", "label", "edit", { targetId: "off-leaf", label: "Reference" });
    const compact = entry("compaction", "compact", "label", { firstKeptEntryId: "root", summary: "Compact", tokensBefore: 42 });
    const last = assistant("last", "compact");
    await put([header, root, ...referenced, user("unrelated", "root"), summary, edit, label, compact, last]);
    const before = await snapshot(session.path);
    const entries = await fork(session, dir);
    for (const original of [root, ...referenced, summary, edit, label, compact, last]) {
      assert.deepEqual(entries.find((e) => e.id === original.id), original);
    }
    assert.ok(!entries.some((e) => e.id === "unrelated"));
    const ids = new Set(entries.slice(1).map((e) => e.id));
    for (const e of entries.slice(1)) {
      for (const key of ["parentId", "fromId", "targetId", "firstKeptEntryId"]) {
        if (e[key] != null) assert.ok(ids.has(e[key]), `${e.id}.${key} must resolve`);
      }
    }
    await unchanged(session.path, before);
  });
});

for (const invalid of ["context target missing", "context target offbranch", "compaction missing", "compaction offbranch", "summary missing", "label missing", "future reference", "invalid content", "unsupported version"] as const) {
  test(`Fork rejects ${invalid} without writing`, async () => {
    await fixture(async ({ session, header, dir, put }) => {
      const records: unknown[] = [header, user("u", null), assistant("a", "u"), user("off", "u")];
      switch (invalid) {
        case "context target missing": records.push(entry("context_edit", "bad", "a", { targetId: "missing", replacement: null })); break;
        case "context target offbranch": records.push(entry("context_edit", "bad", "a", { targetId: "off", replacement: null })); break;
        case "compaction missing": records.push(entry("compaction", "bad", "a", { firstKeptEntryId: "missing", summary: "S", tokensBefore: 1 })); break;
        case "compaction offbranch": records.push(entry("compaction", "bad", "a", { firstKeptEntryId: "off", summary: "S", tokensBefore: 1 })); break;
        case "summary missing": records.push(entry("branch_summary", "bad", "a", { fromId: "missing", summary: "S" })); break;
        case "label missing": records.push(entry("label", "bad", "a", { targetId: "missing", label: "L" })); break;
        case "future reference": records.push(entry("label", "bad", "a", { targetId: "future", label: "L" }), user("future", "bad")); break;
        case "invalid content": records.push(entry("message", "bad", "a", { message: { role: "assistant", content: [null] } })); break;
        case "unsupported version": records[0] = { ...header, version: 4 }; break;
      }
      await put(records);
      await rejectsReadAndFork(session, dir, invalid === "unsupported version");
    });
  });
}

test("Fork returns full identity and bounded manual title, with no source mutation", async () => {
  await fixture(async ({ session, header, put }) => {
    await put([header, user("u", null), assistant("a", "u"), entry("session_info", "name", "a", { name: "𐐀".repeat(200) + "\u001b[31m\n" })]);
    const before = await snapshot(session.path);
    const result = await forkHistorySession(session, signal());
    assert.equal(result.parentSessionPath, session.path);
    assert.equal((result as SessionInfo & { parentSessionFile: string }).parentSessionFile, session.path);
    assert.equal(result.cwd, session.cwd);
    assert.equal(result.messageCount, 2);
    assert.equal(result.firstMessage, "Question");
    assert.equal(result.allMessagesText, "Question Final answer");
    assert.equal(result.name, "𐐀".repeat(120) + " · Fork");
    assert.ok(Number.isFinite(result.created.getTime()));
    assert.notEqual(result.id, session.id);
    assert.equal(result.path.includes(result.id), true);
    if (process.platform !== "win32") assert.equal((await stat(result.path)).mode & 0o777, 0o600);
    await unchanged(session.path, before);
  });
});

test("cancellation observed after exclusive open cleans up the empty destination", async () => {
  await fixture(async ({ session, dir }) => {
    const controller = new AbortController();
    const check = controller.signal.throwIfAborted.bind(controller.signal);
    // Per-signal instrumentation: abort exactly at the pre-write boundary,
    // without global filesystem mocks or timing-dependent timers.
    controller.signal.throwIfAborted = () => {
      if (readdirSync(dir).length > 1) controller.abort();
      check();
    };
    const before = await snapshot(session.path);
    await assert.rejects(forkHistorySession(session, controller.signal), { name: "AbortError" });
    assert.deepEqual(await readdir(dir), ["source.jsonl"]);
    await unchanged(session.path, before);
  });
});

test("deletion rejects changed header identity and foreign revision capabilities", async () => {
  await fixture(async ({ session, header, put }) => {
    const revision = await captureSessionRevision(session, signal());
    await assert.rejects(deleteSession(session, Object.freeze({}) as typeof revision, signal()));
    await put([{ ...header, id: randomUUID() }, user("u", null), assistant("a", "u")]);
    const before = await snapshot(session.path);
    await assert.rejects(deleteSession(session, revision, signal()));
    await unchanged(session.path, before);
  });
});

test("legacy compaction index is translated to a retained entry without touching source", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const legacyHeader = { ...header }; delete legacyHeader.version;
    const records: RawEntry[] = [user("u", null), assistant("a", "u"), entry("compaction", "c", "a", {
      firstKeptEntryIndex: 1, summary: "Legacy summary", tokensBefore: 123,
    })];
    for (const record of records) { delete record.id; delete record.parentId; }
    await put([legacyHeader, ...records]);
    const before = await snapshot(session.path);
    const entries = await fork(session, dir);
    const compact = entries.find((e) => e.type === "compaction")!;
    assert.equal(compact.firstKeptEntryId, entries[1]!.id);
    assert.equal(compact.firstKeptEntryIndex, undefined);
    assert.equal(compact.parentId, entries[2]!.id);
    await unchanged(session.path, before);
  });
});

test("native self-kept compaction and root summary sentinel remain valid", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const records = [user("u", null), assistant("a", "u"),
      entry("compaction", "c", "a", { firstKeptEntryId: "c", summary: "No kept messages", tokensBefore: 123 }),
      entry("branch_summary", "s", "c", { fromId: "root", summary: "Root summary" })];
    await put([header, ...records]);
    const entries = await fork(session, dir);
    for (const record of records) assert.deepEqual(entries.find((e) => e.id === record.id), record);
  });
});

test("deep histories validate iteratively without per-entry branch walks", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const records: RawEntry[] = [user("u", null)];
    let parent = "u";
    for (let i = 0; i < 12000; i++) {
      const id = `e${i}`;
      records.push(entry("context_edit", id, parent, { targetId: "u", replacement: { content: `Edit ${i}` } }));
      parent = id;
    }
    await put([header, ...records, assistant("last", parent)]);
    const entries = await fork(session, dir);
    assert.equal(entries.length, records.length + 3);
    assert.deepEqual(entries.find((e) => e.id === "last"), assistant("last", parent));
  });
});

for (const version of [1, 2]) {
  test(`legacy v${version} is migrated only in the fork`, async () => {
    await fixture(async ({ session, header, dir, put }) => {
      const legacyHeader: RawEntry = { ...header };
      if (version === 1) delete legacyHeader.version;
      else legacyHeader.version = 2;
      const legacyUser = user("u", null);
      const legacyMessage = entry("message", "hook", "u", { message: {
        role: "hookMessage", customType: "legacy", content: "Legacy context", display: true,
        details: { preserved: true }, timestamp: 1767225600000,
      } });
      if (version === 1) {
        for (const e of [legacyUser, legacyMessage] as RawEntry[]) { delete e.id; delete e.parentId; }
      }
      await put([legacyHeader, legacyUser, legacyMessage]);
      await chmod(session.path, 0o444);
      const before = await snapshot(session.path);
      await captureSessionRevision(session, signal());
      const entries = await fork(session, dir);
      assert.equal(entries[0]!.version, 3);
      const messages = entries.filter((e) => e.type === "message");
      assert.equal(messages.length, 2);
      assert.equal(messages[0]!.parentId, null);
      assert.equal(messages[1]!.parentId, messages[0]!.id);
      assert.equal(messages[1]!.message.role, "custom");
      assert.equal(messages[1]!.message.content, "Legacy context");
      assert.deepEqual(messages[1]!.message.details, { preserved: true });
      const ids = entries.slice(1).map((e) => e.id);
      assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
      assert.equal(new Set(ids).size, ids.length);
      await unchanged(session.path, before);
    });
  });
}

test("Fork preserves Pi 1.4 system prompt sections and tool updates, including compaction state", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const system = { role: "system", content: [{ type: "text", text: "Base instructions" }], timestamp: 1767225600000,
      sections: { safety: "Keep this", old: null },
      toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }],
      toolsRemoved: [{ name: "write" }],
    };
    await put([header, entry("message", "sys", null, { message: system }), user("u", "sys"), assistant("a", "u"),
      entry("compaction", "c", "a", { summary: "Summary", firstKeptEntryId: "u", tokensBefore: 100, systemMessage: system })]);
    const before = await snapshot(session.path); const entries = await fork(session, dir);
    assert.deepEqual(entries.find((e) => e.id === "sys")!.message, system);
    assert.deepEqual(entries.find((e) => e.id === "c")!.systemMessage, system);
    await unchanged(session.path, before);
  });
});

for (const name of ["New global title", undefined]) {
  test(`Fork uses latest global session title even on a discarded branch: ${String(name)}`, async () => {
    await fixture(async ({ session, header, dir, put }) => {
      await put([header, user("u", null), entry("session_info", "old", "u", { name: "Old branch title" }),
        entry("session_info", "new", "old", { name }), assistant("leaf", "old")]);
      const entries = await fork(session, dir);
      assert.equal(entries.at(-1)!.name, `${name ?? "Question"} · Fork`);
    });
  });
}

test("Fork honors a viewer-only manual alias without changing the source", async () => {
  await fixture(async ({ session }) => {
    const before = await snapshot(session.path);
    const created = await forkHistorySession(session, signal(), "Viewer alias");
    assert.equal(created.name, "Viewer alias · Fork"); await unchanged(session.path, before);
  });
});

test("missing historical cwd permits identity-safe delete but never silently forks into current cwd", async () => {
  await fixture(async ({ session, header, dir, put }) => {
    const { cwd: _cwd, ...legacyHeader } = header;
    await put([legacyHeader, user("u", null), assistant("a", "u")]);
    session.cwd = "";
    const revision = await captureSessionRevision(session, signal());
    const files = await readdir(dir);
    await assert.rejects(forkHistorySession(session, signal()), /working directory is unknown/);
    assert.deepEqual(await readdir(dir), files);
    await deleteSession(session, revision, signal()); await assert.rejects(stat(session.path), /ENOENT/);
  });
});
