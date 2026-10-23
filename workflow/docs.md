# 项目事实与约束

## 已核实

- 项目名：PiSessionViewer；当前项目目录原先只有 `pics/` 中四张 Codex CLI 截图，没有插件工程。
- 本机此前核查：Codex CLI `0.164.0`，`@earendil-works/pi-coding-agent` `1.4.0`。
- 本轮终端核查：Windows/Git Bash，Node `v24.13.0`，`process.platform === "win32"`。这不是 WSL 运行时。
- Pi 原生 `/resume` 已具备历史搜索、恢复、重命名、删除和范围切换；本项目轻量界面增强浏览与预览，不替代其全部功能。
- 项目包名 `pi-session-viewer`、命令 `/session-browser`、版本 `0.4.0`；私有仓库 <https://github.com/De0ta/PiSessionViewer>。未发布 npm 包。
- Pi 扩展可提供自定义 TUI、编辑器和终端输入监听。空输入左键入口技术上可实现，不必向模型发送 prompt。

## 已找到的外部方案

- `sidstack/pi-codex-agents`：MIT，核查版本 `1.2.0`，要求 Linux、Node `>=22.19.0`、Pi `>=1.3.0 <1.5.0`；明确支持空输入 `←` 与持久后台会话。
- `vahidkowsari/pi-session-manager`：轻量 TUI 会话浏览器，核查源码版本 `0.1.0`；仍引用 `@mariozechner/*`，当前宿主兼容性未验证。
- `pi-ui-extension`：全屏侧栏与高级会话管理，非相同的命令中心交互。
- `pi-codex-subagents`：管理父会话下的子 Agent，不等同于全局项目会话中心。
- 同名的 `Dwsy/pi-session-manager` 是桌面/网页历史工作台，不能与前述终端扩展混淆。

来源、功能区别与源码定位见 [开源候选调研](../docs/open-source-survey.md)。以上均为文档/静态源码核查，不是本机运行测试结果。

## 约束

- 空输入定义优先为严格 `""`，而非 `.trim() === ""`；空格和换行仍属于草稿。
- 裸左键快捷键无法仅凭回调返回来保留正常左移；入口需单独处理焦点、弹窗和重入。
- Pi 1.4 的公开 `ctx.switchSession(path)` 会重建目标 session.cwd 对应的项目运行时，支持跨项目恢复；不提供 `cwdOverride`，缺失的目标 cwd 会报错，不能用 `process.chdir()` 绕过。
- 切换当前 Pi 会话会替换运行时；实时多会话需额外管理机制。
- 主候选依赖 Linux `/proc`、抽象 Unix socket 和权限/锁语义；不能保证 Windows 原生直接可用。
- 在 Linux/WSL 测试时应使用 Linux Node/Pi；不能默认识别或直接共享 Windows 用户目录中的活动历史。

## 已选定的实现

- 使用 Pi 1.4 公开 API 自研 Windows 友好的轻量版，不安装 Linux host，不使用 Pi 私有接口；依赖兼容区间 `>=1.4.0 <1.5.0`。
- 可以在任务运行时浏览，但运行中或有待处理消息时不允许恢复；确认前后均复查状态。
- 已有自定义编辑器时不覆盖，提示使用命令；默认编辑器由 CustomEditor 子类保留原生行为。
- 全屏 UI 使用公开 `ctx.ui.custom(..., { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 } })`；逐行填满终端行列，不替换聊天组件。
- 默认全部历史；`Tab`过滤、`F3`搜索（输入栏默认隐藏）、`g`分组、`?`帮助、`r`命名、`Enter`/`→`打开；窄屏`d`/`←`切详情/列表。
- 详情只读文件 + 内存解析；模型/推理由投影获取，最后回复/对应提问从完整当前分支解析并应用该分支的 context_edit，不被压缩裁掉；不使用 SessionManager.open()。
- 当前进程状态来自 `isIdle()` / `hasPendingMessages()` 与已观察的完成/取消/错误事件；其他历史只标记 `Saved`，不检测跨进程活动或推测安全接管。
- 每项目默认5条、Show more每次5条；详情使用原生Markdown和分区裁剪保留Prompt。自动名称先本地提炼，再通过`ctx.modelRegistry.streamSimple()`后台请求当前模型拟写；15秒超时/失败保留回退，已有标题和命名标记不重算；`r`当前名称走公开API，历史别名写agent目录自有文件，恢复后转原生。
- 当前模型命名、按键和分色见[v0.4设计](../docs/model-titles-v0.4.md)；[v0.3设计](../docs/refinements-v0.3.md)保留历史决策。
- 技术细节与验证边界见[全屏改版设计与验证](../docs/fullscreen-v0.2.md)。真实终端和跨项目端到端验收仍待完成。
