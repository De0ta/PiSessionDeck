import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "pi-session-viewer-install-"));
const cwd = join(root, "work");
const agent = join(root, "agent");
const env = { ...process.env,
  PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
  PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", CI: "true",
  GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: `url.${pathToFileURL(project).href}.insteadOf`,
  GIT_CONFIG_VALUE_0: "https://github.com/De0ta/PiSessionViewer.git",
  GIT_CONFIG_KEY_1: "protocol.file.allow", GIT_CONFIG_VALUE_1: "always",
  npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false",
  npm_config_update_notifier: "false", npm_config_offline: "true",
};
delete env.NODE_PATH; delete env.NODE_OPTIONS;
// Avoid inherited case-insensitive npm settings conflicting on Windows.
for (const key of Object.keys(env)) {
  if (key.startsWith("NPM_CONFIG_") && Object.hasOwn(env, key.toLowerCase())) delete env[key];
}
function run(command, args, where = cwd) {
  const result = spawnSync(command, args, { cwd: where, env, encoding: "utf8", timeout: 120_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
try {
  await mkdir(cwd); await mkdir(agent);
  const sha = run("git", ["rev-parse", "HEAD"], project);
  const source = `git:https://github.com/De0ta/PiSessionViewer.git@${sha}`;
  const hostEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const cli = resolve(dirname(fileURLToPath(hostEntry)), "bundle", "cli.js");
  // Real CLI and real package manager; only Git transport is redirected locally.
  run(process.execPath, [cli, "install", source, "--no-approve"]);
  const settings = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
  assert.ok(settings.packages.includes(source), "CLI must persist the pinned source in isolated settings");
  Object.assign(process.env, {
    PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
  });
  const { DefaultPackageManager, SettingsManager, discoverAndLoadExtensions } = await import("@earendil-works/pi-coding-agent");
  const manager = new DefaultPackageManager({ cwd, agentDir: agent,
    settingsManager: SettingsManager.create(cwd, agent, { projectTrusted: false }) });
  const installed = manager.getInstalledPath(source, "user");
  assert.ok(installed);
  assert.equal(run("git", ["rev-parse", "HEAD"], installed), sha);
  await assert.rejects(access(join(installed, "node_modules", "@earendil-works", "pi-coding-agent")));
  const resources = await manager.resolve(async () => "error");
  const paths = resources.extensions.filter((resource) => resource.enabled).map((resource) => resource.path);
  const loaded = await discoverAndLoadExtensions(paths, cwd, agent);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.ok(loaded.extensions[0].commands.has("session-browser"));
  const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  console.log(`PASS: real pi install, pinned ${sha.slice(0, 7)}, package ${manifest.version}, persisted settings and loader registration.`);
  console.log("Git transport redirected to local committed HEAD; no public reachability claim, terminal, provider call, real history, global install, or publication.");
} finally {
  await rm(root, { recursive: true, force: true });
}
