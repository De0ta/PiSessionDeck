import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createEmptySession } from "../src/new-session.ts";
import { validateResumeTarget } from "../src/resume-target.ts";

async function fixture(run: (dir: string, project: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-deck-new-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  const project = join(dir, "selected-project"); await mkdir(project);
  try { await run(dir, project); }
  finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("cross-project New persists only a native header, opens in selected cwd and leaves project files unchanged", async () => fixture(async (_dir, project) => {
  await writeFile(join(project, "keep.txt"), "unchanged");
  const created = await createEmptySession(project, new AbortController().signal);
  assert.equal(created.cwd, project); assert.equal(created.messageCount, 0);
  assert.equal(created.firstMessage, ""); assert.equal(created.allMessagesText, "");
  const lines = (await readFile(created.path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1); const header = JSON.parse(lines[0]!);
  assert.equal(header.type, "session"); assert.equal(header.cwd, project); assert.equal(header.id, created.id);
  assert.equal(header.parentSession, undefined);
  const opened = SessionManager.open(created.path);
  assert.equal(opened.getCwd(), project); assert.equal(opened.getSessionId(), created.id);
  assert.deepEqual(opened.getEntries(), []); assert.equal(opened.getLeafId(), null);
  assert.equal(opened.getSessionName(), undefined);
  await validateResumeTarget(created, new AbortController().signal);
  assert.deepEqual(await readdir(project), ["keep.txt"]);
  assert.equal(await readFile(join(project, "keep.txt"), "utf8"), "unchanged");
  if (process.platform !== "win32") assert.equal((await stat(created.path)).mode & 0o077, 0);
}));

test("separate New operations get independent session identities", async () => fixture(async (_dir, project) => {
  const a = await createEmptySession(project, new AbortController().signal);
  const b = await createEmptySession(project, new AbortController().signal);
  assert.notEqual(a.id, b.id); assert.notEqual(a.path, b.path);
}));

test("New rejects unknown, relative, missing, and non-directory workspaces without creating a session store", async () => fixture(async (dir) => {
  const file = join(dir, "file"); await writeFile(file, "keep");
  for (const target of ["", "relative/project", join(dir, "missing"), file]) {
    await assert.rejects(createEmptySession(target, new AbortController().signal));
  }
  assert.equal(await readFile(file, "utf8"), "keep");
  await assert.rejects(stat(join(dir, "agent")), { code: "ENOENT" });
}));

test("New cancelled after exclusive open removes its empty destination", async () => fixture(async (_dir, project) => {
  const controller = new AbortController(); let checks = 0;
  const original = controller.signal.throwIfAborted.bind(controller.signal);
  controller.signal.throwIfAborted = () => {
    if (++checks === 3) controller.abort();
    original();
  };
  await assert.rejects(createEmptySession(project, controller.signal), { name: "AbortError" });
  assert.equal(checks, 3);
  const sessionDir = SessionManager.create(project).getSessionDir();
  assert.deepEqual(await readdir(sessionDir), []);
  assert.deepEqual(await readdir(project), []);
}));

test("aborted New does not create a session store or change the workspace", async () => fixture(async (dir, project) => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createEmptySession(project, controller.signal), { name: "AbortError" });
  assert.deepEqual(await readdir(project), []);
  await assert.rejects(stat(join(dir, "agent")), { code: "ENOENT" });
}));
