# 项目事实与约束

## 已核实

- 项目名：PiSessionViewer；当前项目目录原先只有 `pics/` 中四张 Codex CLI 截图，没有插件工程。
- 本机此前核查：Codex CLI `0.164.0`，`@earendil-works/pi-coding-agent` `1.4.0`。
- 本轮终端核查：Windows/Git Bash，Node `v24.13.0`，`process.platform === "win32"`。这不是 WSL 运行时。
- Pi 原生 `/resume` 已具备历史搜索、恢复、重命名、删除和范围切换；本项目轻量界面增强浏览与预览，不替代其全部功能。
- 项目包名 `pi-session-viewer`、命令 `/session-browser`、版本`1.0.0`，MIT，GitHub已公开并创建非预发布正式Release；注释标签目标a75c1ac30f1f0c7ba8d605481d1d9b25a1e77892。 <https://github.com/De0ta/PiSessionViewer>。未发布 npm 包。
- Pi 扩展可提供自定义 TUI、编辑器和终端输入监听。空输入左键入口技术上可实现，不必向模型发送 prompt。

- v1.0修复历史model/provider/reasoning字段终端控制注入，并在POSIX保留合法反斜杠；回归测试覆盖OSC52/标题/清屏定位及Linux/macOS路径。
- 打包白名单16文件，包含源码、许可证、变更记录与安装指南；真实Pi加载器从临时解包目录直接按manifest加载。Git安装smoke调用实际CLI，临时配置和本地Git传输，不使用用户状态或模型。
- Windows/Ubuntu×Node22.19/24四组CI已全部通过（run39999387318）；97测试和两种smoke通过。禁用Git凭据的匿名固定提交实际安装/加载也通过；固定标签匿名安装及Release附件SHA256回验也已通过；最终发布提交CI为run39999968949。人工终端端到端未验收。独立审查无发布阻塞，7提交/112文件对象未发现凭据或真实会话/截图。

## M3 已授权边界（Unreleased，待人工验收）

- `n` 当前 cwd 新建，不带 prompt；`f` 当前用 `ctx.fork(leaf, { position: 'at' })`，在新 runtime 的 `session_start`（reason 为 fork）追加 ` · Fork`，不继承 pins。
- 历史 Fork 不先恢复源：只读严格解析 v1/2/3，保留有效分支、引用闭包和 latest reply，写新文件后 `ctx.switchSession`；16 MiB上限，未知格式拒绝。已创建未打开文件保留，刷新可发现，原页重试复用它，避免重复创建。
- `p` 独立 Pinned 区跨 Project/Recent/Model/Status，搜索/项目过滤先应用，不在原组重复，按置顶时间倒序，每组默认5条。记录位于 `getAgentDir()/pi-session-viewer/pins`，以规范化路径和会话ID计算 sha256 独立文件，临时文件写入后原子 rename，不写源 JSONL。
- `Delete` 只永久删除非当前单个会话；头部最多1 MiB，未知格式安全拒绝，复核身份和 revision。无跨进程锁，不能排除最后检查与删除间竞态；不停止其他进程、不级联 Fork、不删除项目。
- 删除确认参照 `pics/删除对话.jpg`：居中深灰弹层、默认 Cancel 蓝条；数字仅选择，Enter确认。`a` 操作菜单，输入模式保留字母，兼容旧 `r` / `d`。
- 未落盘当前行显示 Unsaved，不能删除当前会话、不能 pin / fork。自动标题加强 system prompt 与 `cleanModelTitle` 去前缀，不修改旧标题、不重新请求。
- 工作树实现已通过类型检查、165项测试中的164项（另1项Windows符号链接权限跳过）、打包加载和独立审查修复复核；完整宿主切换与真实终端人工验收仍待完成。详见[管理实现边界与验收](../docs/management.md)。以上不覆盖 v1.0 已发布事实，包版本仍为1.0.0，不移动已发标签。

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
- Pi 1.4 的公开 `ctx.switchSession(path)` 会重建目标 session.cwd 对应的项目运行时，支持跨项目恢复；不提供`cwdOverride`；宿主内部`rebuild`虽有目录覆盖能力，公开交互适配器不会转发。本插件转换页只提供会话目录恢复，缺失目录在页内只读预检阻止；Pi原生`/resume`另有目录回退，不能用`process.chdir()`绕过。
- 切换当前 Pi 会话会替换运行时；实时多会话需额外管理机制。
- 主候选依赖 Linux `/proc`、抽象 Unix socket 和权限/锁语义；不能保证 Windows 原生直接可用。
- 在 Linux/WSL 测试时应使用 Linux Node/Pi；不能默认识别或直接共享 Windows 用户目录中的活动历史。

## 已选定的实现

- 使用 Pi 1.4 公开 API 自研 Windows 友好的轻量版，不安装 Linux host，不使用 Pi 私有接口；依赖兼容区间 `>=1.4.0 <1.5.0`。
- 可以在任务运行时浏览，但任务运行、有待处理消息或有任何编辑器草稿时不允许恢复；异步目标预检前后均复查。Pi可能迁移草稿，本插件不承诺自动丢弃或保全切换后的草稿。
- 已有自定义编辑器时不覆盖，提示使用命令；默认编辑器由 CustomEditor 子类保留原生行为。
- 全屏 UI 使用公开 `ctx.ui.custom(..., { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 } })`；逐行填满终端行列，不替换聊天组件。
- 默认全部历史；`Tab`过滤、`F3`搜索（输入栏默认隐藏）、`g`分组、`?`帮助、`r`命名、`Enter`/`→`打开；窄屏`d`/`←`切详情/列表。
- 详情只读文件 + 内存解析；模型/推理由投影获取，最后回复/对应提问从完整当前分支解析并应用该分支的 context_edit，不被压缩裁掉；不使用 SessionManager.open()。
- 当前进程状态来自 `isIdle()` / `hasPendingMessages()` 与已观察的完成/取消/错误事件；其他历史只标记 `Saved`，不检测跨进程活动或推测安全接管。
- `g`循环Project/Recent/Model/Status；Recent按modified分为<5小时、<1天、<7天、<30天、<90天及>=90天六档（下限为前一档上限）。模型分组采用当前分支有效provider/modelId，历史元数据只读解析，4并发、16MiB上限、stat修订缓存，异常为Unknown model；当前模型实时投影优先。状态聚合沿用当前真实状态/历史Saved。
- 各组默认5条、Show more每次5条；详情使用原生Markdown和分区裁剪保留Prompt。自动名称先本地提炼，再通过`ctx.modelRegistry.streamSimple()`后台请求当前模型拟写；15秒超时/失败保留回退，已有标题和命名标记不重算；`r`当前名称走公开API，历史别名写agent目录自有文件，恢复后转原生。
- 恢复页面用一个ResumeFlow根组件在原浏览器与ResumePage间切换；同目录简化显示，跨目录对比路径。仅顶部内容块灰色、其他行默认底色填满遮挡，非原生弹窗。Esc返回保留同一浏览器状态；提交后无公开取消API，等待宿主结果或shutdown。
- 提交前只读核查最多64KiB会话头、ID/cwd/版本/时间戳、目标目录可访问及文件修订；不创建缺失文件、不迁移。仍不能完整验证正文或排除之后竞态；实际恢复由宿主负责，可能迁移旧格式或发生内部错误。详见[v0.6恢复页](../docs/resume-v0.6.md)。
- 四种分组、模型元数据及时间边界见[v0.5设计](../docs/groups-v0.5.md)；当前模型命名、按键和分色见[v0.4设计](../docs/model-titles-v0.4.md)；[v0.3设计](../docs/refinements-v0.3.md)保留历史决策。
- 技术细节与验证边界见[全屏改版设计与验证](../docs/fullscreen-v0.2.md)。真实终端和跨项目端到端验收仍待完成。
