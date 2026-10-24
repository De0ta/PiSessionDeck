import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

// Run through npm so npm_execpath points at the actual JS CLI on Windows too.
assert.ok(process.env.npm_execpath, "Run npm run smoke:package");
const project = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "pi-session-viewer-package-"));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  // npm publish --dry-run propagates to lifecycle children; this check needs
  // a real archive inside its temporary directory, even during a publish preview.
  const [pack] = JSON.parse(run(process.execPath, [process.env.npm_execpath, "pack", "--dry-run=false", "--ignore-scripts", "--json", "--pack-destination", root], project));
  assert.ok(pack.files.length > 0);
  for (const { path } of pack.files) {
    assert.ok(/^(?:src\/[^/]+\.ts|README(?:\.zh-CN)?\.md|LICENSE|CHANGELOG\.md|package\.json|docs\/install\.md)$/.test(path), `Unexpected packed file: ${path}`);
  }
  for (const required of ["LICENSE", "README.md", "README.zh-CN.md", "CHANGELOG.md", "docs/install.md", "src/index.ts", "src/resume.ts"]) {
    assert.ok(pack.files.some((file) => file.path === required), `Missing ${required}`);
  }
  // Both supported CI operating systems provide tar. Use relative paths so
  // Windows GNU/bsdtar differences cannot misinterpret drive-letter paths.
  await mkdir(join(root, "unpacked"));
  run("tar", ["-xzf", basename(pack.filename), "-C", "unpacked"], root);
  const pkg = join(root, "unpacked", "package");
  await assert.rejects(access(join(pkg, "node_modules")));
  const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.version, pack.version);
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.publishConfig?.registry, "https://registry.npmjs.org/");
  assert.ok(manifest.pi.extensions.length > 0);
  const cwd = join(root, "project");
  const agent = join(root, "agent");
  await mkdir(cwd); await mkdir(agent);
  // Set before dynamically importing Pi; never read or write the real agent dir.
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.PI_CODING_AGENT_SESSION_DIR = join(agent, "sessions");
  process.env.PI_OFFLINE = "1";
  process.env.PI_SKIP_VERSION_CHECK = "1";
  process.env.PI_TELEMETRY = "0";
  const { discoverAndLoadExtensions } = await import("@earendil-works/pi-coding-agent");
  const loaded = await discoverAndLoadExtensions([pkg], cwd, agent);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.ok(loaded.extensions[0].commands.has("session-browser"));
  assert.ok(loaded.extensions[0].handlers.has("session_start"));
  assert.ok(loaded.extensions[0].handlers.has("session_shutdown"));
  console.log(`PASS: ${pack.name}@${pack.version}: ${pack.files.length} packed files; isolated Pi loader registers /session-browser without package-local dependencies.`);
  console.log("No terminal attached, provider calls, real history, global install, or publication.");
} finally {
  await rm(root, { recursive: true, force: true });
}
