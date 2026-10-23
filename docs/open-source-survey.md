# Pi 会话管理器开源候选调研

核查日期：2026-10-23。范围：Pi 内的终端插件，重点对照 Codex CLI 会话命令中心与空输入 `←` 入口。

## 结论与证据边界

**存在很接近目标的开源插件：`sidstack/pi-codex-agents`，而且已经实现空输入左方向键入口。** 因而无需从“生态里完全没有方案”的假设出发。

但该项目明确要求 Linux，当前环境的 Node 为 Windows 原生 `win32`。不能把 Git Bash 当作 Linux，也不能以 Pi 版本符合要求就认定整包兼容。

本次进行了网页检索、README/manifest/许可证与关键源码核查；没有安装候选扩展、运行候选测试、启动 host 或执行模型请求。下文的功能是上游声明及静态代码证据，不是当前机器的实测验收。此调查不是全生态穷尽搜索，也不是完整安全审计。

## 候选对照

| 项目 | 形态与主要能力 | 与目标关系 | 兼容性/边界 |
| --- | --- | --- | --- |
| [sidstack/pi-codex-agents](https://github.com/sidstack/pi-codex-agents) | Pi 原生视图、全屏命令中心、跨项目持久会话、后台执行、草稿保留、取消/停止 | 最接近；明确支持空输入 `←` | Linux；Node >=22.19.0；Pi >=1.3.0 <1.5.0；包含私有 UI 适配 |
| [vahidkowsari/pi-session-manager](https://github.com/vahidkowsari/pi-session-manager) | `/sessions`、`/sall` TUI 覆盖层；搜索、恢复、删除、当前会话命名、项目范围切换 | 轻量历史管理参考；不是后台任务指挥中心 | 核查源码 0.1.0，仍导入 `@mariozechner/*`；与当前 `@earendil-works/*` 宿主的兼容性未测试 |
| [1993yihuan/pi-ui-extension](https://github.com/1993yihuan/pi-ui-extension) | 右侧栏、Advanced Sessions、命名、置顶、搜索、排序、回收站、批量清理 | 会话管理较丰富，但不是同样的左键命令中心 | 包页面 README 为 1.9.7；要求 Pi >=1.3.0、Node >=22.19.0 和 fullscreen 模式；未本机测试 |
| [ogulcancelik/pi-extensions / pi-codex-subagents](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-codex-subagents) | `/subagents`、子进程任务、等待/中断/继续、实时浏览 | Codex 风格子 Agent，不是所有项目主会话中心 | 控制以当前父会话为边界；跨会话总览是只读 |
| [Dwsy/pi-session-manager](https://github.com/Dwsy/pi-session-manager) | Tauri 桌面、网页/无头服务，多 Agent 历史索引、搜索、统计与继续工作 | 历史工作台参考，不是目标形态 | README 自述不替代 Agent 原生执行工作流；不要与同名轻量终端扩展混淆 |

## 重点：pi-codex-agents

### 身份和发布核验

- 上游：<https://github.com/sidstack/pi-codex-agents>。
- 包页面：<https://pi.dev/packages/pi-codex-agents>。
- npm `latest` 核查为 `1.2.0`：<https://registry.npmjs.org/pi-codex-agents/latest>。
- 核查源码 commit：`0b25ba0126668f3a67b4886b4c88b1768ee41ff1`，与 npm 元数据 `gitHead` 一致。
- 许可证：[MIT](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/LICENSE)。允许修改/分发，但复制实质代码时需保留版权与许可声明。
- `package.json` 用 `pi.extensions` 加载 `dist/extension.js`；不是另一个独立聊天应用。

### 已声明或有源码支持的目标能力

- `/agents`、`Ctrl+G`、空输入 `←` 打开管理器。
- 跨项目会话搜索，Active / Inactive / All 过滤。
- 新建本目录会话，或通过目录选择器创建其他目录的会话。
- 切换时保留草稿、在途任务、原生 Pi 组件和交互对话框。
- `Ctrl+X` 取消当前任务，`Ctrl+K` 显式停止所选会话；取消与停止是两个动作。
- 前端断开后受管会话可继续执行；重新连接同一 host。
- 普通 Pi 历史显示为 inactive，打开时复制成独立受管会话，不直接接管普通历史文件的写入权。

它不是截图的逐项复刻：过滤栏和快捷键不同；本次未确认具有相同的右侧详情、worktree、pin/hide/archive 操作集合。不能直接承诺“安装后与 Codex 完全一致”。

### 空输入左键的直接证据

[导航源码第 5–19 行](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/src/features/navigation.ts#L5-L19) 包含：

```ts
(config.leftArrowEntry && matchesKey(data, "left") && empty && prompts === 0)
```

其中 `empty` 来自 `ctx.ui.getEditorText() === ""`。主编辑器有草稿时不命中，保留普通左移。条件还排除等待用户交互的 prompt；这里的 `prompts` 不是历史中用户消息总数。

前端 [src/extension.ts:160-194](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/src/extension.ts#L160-L194) 注册 `onTerminalInput`，匹配后返回 `{ consume: true }`，并维护 prompt 计数和打开状态。具体防冲突边界仍需运行回归。

### 后台机制并非普通 switchSession

[架构说明](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/docs/ARCHITECTURE.md)：

```text
普通 Pi 前端 + 扩展
  → 临时交出终端
    → 持久 host
      → 多个 SDK runtime + InteractiveMode
      → 历史、草稿、终端租约与受管状态
```

这解释了为什么后台任务不会随着普通 `ctx.switchSession()` 被销毁：它管理自己的多个运行时，只切换终端归属。不是简单给原生 `/resume` 换皮。

代价包括：

- 受管运行时共享一个 host 进程，第三方扩展的模块全局状态不保证隔离。
- 一个 host 同时仅允许一个附着终端；另一个前端需要接管。
- Pi 暂无公开的完整实时视图附着 API；项目使用有版本防护的私有 UI/退出适配。
- 外部编辑器和继承 stdio 的交互式子进程不属于其支持范围。

### Windows 原生移植障碍

不是仅修改路径分隔符就能移植：

1. [src/core/storage.ts:6-29](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/src/core/storage.ts#L6-L29) 从 `/proc/${pid}/stat` 取得进程起始身份，防止 PID 复用导致锁判断错误。
2. [src/core/host.ts:32-65](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/src/core/host.ts#L32-L65) 用 Linux 抽象 Unix socket 做内核级 host 唯一性保护。
3. host 通道、状态文件和 socket 依赖 Unix 权限/所有权语义，Windows 需另行设计 IPC 与权限模型。
4. 还需验证信号、后台进程存活、终端交还、退出与崩溃恢复。

若选择 Windows 移植，需系统性替换这些机制；不能用取消锁或忽略权限错误作为“兼容修复”。若选择 WSL，应运行 Linux Node/Pi 并先使用隔离的测试状态，不与 Windows 活跃历史并发写入。

### 使用前应知

上游安装命令如下，仅记录，**本轮未执行**：

```sh
pi install npm:pi-codex-agents@1.2.0
```

- 默认 `autoAttach: true` 会改变 Pi 启动行为；试用时宜关闭，手动 `/agents` 或 `←` 进入。
- 默认 `autoName: true` 会在首次完成后额外调用模型生成标题，正常计费；无付费验证宜关闭。
- 移除扩展会保留其会话与状态；不应误以为卸载即清理所有后台数据。
- 安装成功不等于平台兼容，不等于 host 已安全停止，也不等于截图功能全部满足。

## 对本项目的建议

- **若接受 Linux/WSL**：优先对该项目做隔离验证，再决定是否需要为布局或操作补功能。
- **若必须保留 Windows 原生 Pi**：先做使用公开 API 的历史管理器与空输入入口；后台 host 单独决策。
- **若要完整复用并支持 Windows**：把平台适配和宿主私有 API 回归列为独立里程碑。

路线仍待用户选择；本项目没有安装或内嵌这些项目的代码。

## 检索范围与其他来源

检索角度包括 `pi coding agent extension session manager codex`、`pi agent packages session browser`、`pi-codex-agents github` 和同名会话管理器辨别。优先回到项目源码和包元数据核验，而非只引用搜索摘要。

- [轻量浏览器 README 与源码](https://github.com/vahidkowsari/pi-session-manager)
- [侧栏包说明](https://pi.dev/packages/pi-ui-extension)
- [子 Agent 插件 README](https://github.com/ogulcancelik/pi-extensions/blob/main/packages/pi-codex-subagents/README.md)
- [桌面/网页工作台 README](https://github.com/Dwsy/pi-session-manager/blob/main/README.md)
