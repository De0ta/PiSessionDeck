# Changelog

## Unreleased

实现与隔离自动化验证完成；165项测试164通过、1项Windows权限相关跳过，类型检查、工作树打包加载和独立审查修复复核通过。真实终端与完整运行时切换待人工验收，尚未发布，不属于 v1.0.0 发布结果。

- 新增 `n` 当前 cwd 无 prompt 新建、`f` 当前原生 Fork / 历史只读 v1/2/3 严格快照后切换，保留有效分支、引用闭包与末次回复；新运行时追加 ` · Fork`，不继承 pins。创建后打开失败保留文件，支持刷新/重试，避免重复创建。
- 新增 `p` 独立 Pinned 区，跨四种模式、过滤优先、不重复、置顶时间倒序、每组5条；pins 使用 agent 目录独立 sha256 记录并原子写入。
- 新增 `Delete` 非当前单项永久删除及默认 Cancel 的居中深灰确认层；数字仅选择、Enter确认，复核身份与 revision，不提供跨进程锁或停止能力，不级联 Fork、不删除项目。
- 新增 `a` 操作菜单，保留输入模式字母与旧 `r` / `d`；未落盘行标记 Unsaved，禁止 pin / fork 和删除当前会话。
- 历史 Fork 限16 MiB，删除头部限1 MiB；未知格式安全拒绝。详见[管理边界与隔离验收](docs/management.md)。
- 自动标题加强 system prompt，并通过 `cleanModelTitle` 清理“短会话标题-”“会话标题:”“Short session title”等前缀；不改旧标题、不重新请求。

不改包版本、不移动已发布标签，不自动全局安装、不付费、不改真实历史、不发布。

## 1.0.0 — 2026-10-23

First stable GitHub release of Pi Session Viewer. Requires Node >=22.19.0 and Pi 1.4.x. MIT licensed; no npm publication.

### Features

- Full-terminal session list and details, project/all scope, search, five-at-a-time expansion, and Project/Recent/Model/Status grouping.
- Native Markdown reply preview, latest reply's corresponding prompt, model/reasoning/project information, and restrained terminal colors.
- Manual rename with `r`, shared local title cache, and best-effort background first-exchange naming using the current configured model with local fallback.
- Separate same-directory and cross-directory resume pages, explicit confirmation, preserved browser state on return, read-only bounded preflight, and task/queue/draft guards.

### Release hardening

- Strip terminal control sequences from historical model/provider/reasoning metadata before rendering, including OSC clipboard/title and cursor/screen escape sequences.
- Preserve literal trailing backslashes in POSIX directory names instead of conflating them with path separators.
- Add Windows/Ubuntu CI on Node 22.19 and 24, strict checks, regression tests, packed-source loader smoke, and isolated Git-source installation smoke.
- Add MIT license, pinned Git installation/update/uninstall instructions, privacy/cost notes, and packed documentation. Keep npm publication disabled.

### Validation boundary

Automated checks do not constitute a real-terminal compatibility guarantee. Native Linux terminals, SSH/tmux, macOS, other Pi versions, and interactive cross-project lifecycle still require manual verification. No multi-process daemon or cross-process running-state/control capability is provided.

## 0.6.0

Independent same/cross-directory resume pages, browser-state preservation, draft/queue guards, bounded read-only preflight, cancellation and lifecycle protections.

## 0.5.0

Project, Recent, Model, and Status grouping with lazy metadata and stable selection.

## 0.4.0

Background model titles with fallback; latest prompt/reply matching; search-on-demand, `r` rename and refined metadata/key styling.

## 0.3.0

Incremental project expansion, local title synchronization, native Markdown and refined keyboard/layout behavior.

## 0.2.0

Full-terminal dark browser redesign.

## 0.1.0

Initial project/all-scope session browser, search, preview and confirmed restore.
