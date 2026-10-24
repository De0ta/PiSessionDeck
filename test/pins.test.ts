import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathKey } from "../src/model.ts";
import { createPinStore } from "../src/pins.ts";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-session-viewer-pins-test-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const session = { id: "session-id", path: join(tmpdir(), "source-session.jsonl") };
const filename = (identity = session) => createHash("sha256").update(`${pathKey(identity.path)}\0${identity.id}`).digest("hex") + ".json";

test("pins persist timestamps, refresh, and unpin without creating missing directories", async () => fixture(async (dir) => {
  const directory = join(dir, "pins");
  const store = createPinStore(directory);
  assert.equal(await store.read(session), undefined);
  await store.remove(session);
  await store.write(session, false);
  assert.deepEqual(await readdir(dir), []);
  const before = Date.now();
  await store.write(session, true);
  const pinnedAt = await createPinStore(directory).read(session);
  assert.ok(pinnedAt !== undefined && pinnedAt >= before && pinnedAt <= Date.now());
  assert.deepEqual(await readdir(directory), [filename()]);
  if (process.platform !== "win32") assert.equal((await stat(join(directory, filename()))).mode & 0o777, 0o600);
  // An old valid timestamp must be replaced, not retained.
  await writeFile(join(directory, filename()), '{"pinnedAt":1}');
  await store.write(session, true);
  assert.ok((await store.read(session))! >= before);
  await store.write(session, false);
  assert.equal(await store.read(session), undefined);
  await store.write(session, true);
  await store.remove(session);
  await store.remove(session);
  assert.deepEqual(await readdir(directory), []);
}));

test("identity uses normalized paths and session IDs independently", async () => fixture(async (dir) => {
  const store = createPinStore(dir);
  const first = { id: "same", path: join(dir, "session.jsonl") };
  const normalized = { ...first, path: join(dir, "nested") + "/../session.jsonl" };
  const otherId = { ...first, id: "other" };
  const otherPath = { ...first, path: join(dir, "other.jsonl") };
  await store.write(first, true);
  assert.equal(await store.read(normalized), await store.read(first));
  if (process.platform === "win32") assert.equal(await store.read({ ...first, path: first.path.toUpperCase() }), await store.read(first));
  assert.equal(await store.read(otherId), undefined);
  assert.equal(await store.read(otherPath), undefined);
  await store.write(otherId, true);
  await store.write(otherPath, true);
  assert.equal((await readdir(dir)).length, 3);
  await store.remove(normalized);
  assert.equal(await store.read(first), undefined);
  assert.ok(await store.read(otherId));
  assert.ok(await store.read(otherPath));
}));

test("missing, malformed, nonpositive, nonfinite and oversized records fail safely", async () => fixture(async (dir) => {
  const store = createPinStore(dir);
  const target = join(dir, filename());
  assert.equal(await store.read(session), undefined);
  for (const text of ["", "{", "null", "[]", "true", "123", "{}", '{"pinnedAt":"123"}',
    '{"pinnedAt":null}', '{"pinnedAt":false}', '{"pinnedAt":0}', '{"pinnedAt":-1}',
    '{"pinnedAt":1e999}', '{"pinnedAt":NaN}', '{"pinnedAt":1}' + " ".repeat(4096)]) {
    await writeFile(target, text);
    assert.equal(await store.read(session), undefined, text.slice(0, 80));
  }
  await writeFile(target, '{"pinnedAt":123.5}');
  assert.equal(await store.read(session), 123.5);
  await writeFile(target, '{"pinnedAt":1}'.padEnd(4096, " "));
  assert.equal(await store.read(session), 1);
  await rm(target);
  await mkdir(target);
  assert.equal(await store.read(session), undefined);
}));

test("parallel records and writers preserve independent pins and leave no temporary files", async () => fixture(async (dir) => {
  const store = createPinStore(dir);
  const sessions = Array.from({ length: 24 }, (_, i) => ({ ...session, id: `id-${i}` }));
  await Promise.all(sessions.map((identity) => store.write(identity, true)));
  assert.ok((await Promise.all(sessions.map((identity) => createPinStore(dir).read(identity)))).every((time) => time !== undefined));
  await Promise.all(Array.from({ length: 12 }, () => createPinStore(dir).write(sessions[0]!, true)));
  await Promise.all(sessions.slice(1).filter((_, i) => i % 2 === 0).map((identity) => store.remove(identity)));
  for (let i = 0; i < sessions.length; i++) {
    assert.equal((await store.read(sessions[i]!)) !== undefined, i === 0 || i % 2 === 0);
  }
  assert.ok((await readdir(dir)).every((name) => /^[a-f0-9]{64}\.json$/.test(name)));
}));

test("write/remove propagate real IO failures and failed rename cleans temporary files", async () => fixture(async (dir) => {
  const blocked = join(dir, "not-a-directory");
  await writeFile(blocked, "block");
  const blockedStore = createPinStore(blocked);
  await assert.rejects(blockedStore.write(session, true));
  assert.equal(await blockedStore.read(session), undefined);
  const directory = join(dir, "pins");
  await mkdir(join(directory, filename()), { recursive: true });
  const store = createPinStore(directory);
  await assert.rejects(store.write(session, true));
  await assert.rejects(store.remove(session));
  await assert.rejects(store.write(session, false));
  assert.deepEqual(await readdir(directory), [filename()]);
}));

test("pin operations never change source JSONL bytes or mtime", async () => fixture(async (dir) => {
  const source = { id: "source", path: join(dir, "session.jsonl") };
  const text = '{"type":"session","id":"source","version":3}\n';
  await writeFile(source.path, text);
  const before = await stat(source.path);
  const store = createPinStore(join(dir, "pins"));
  await store.read(source);
  await store.write(source, true);
  await store.read(source);
  await store.write(source, false);
  await store.write(source, true);
  await store.remove(source);
  assert.equal(await readFile(source.path, "utf8"), text);
  assert.equal((await stat(source.path)).mtimeMs, before.mtimeMs);
}));
