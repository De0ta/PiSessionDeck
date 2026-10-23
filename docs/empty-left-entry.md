# 空输入时按左方向键进入会话管理器

## 需求与当前状态

用户希望像 Codex CLI 一样，在没有输入 prompt 时按 `←` 进入会话管理页面。

建议把语义明确为：**主编辑器完全为空时触发，而不是仅第一次发送消息前触发**。编辑器中有文字、空格或换行时继续执行正常左移。

结论：Pi 扩展可以实现；已有开源项目有对应源码。本项目现已采用下述方案 A 实现并进行自动化测试，真实终端人工验收待完成。设计与最新状态见[轻量版 v0.1](lightweight-v0.1.md)。下文候选方案与源码分析保留调研时语境。

## 已存在的实现

`sidstack/pi-codex-agents` 的 [导航模块](https://github.com/sidstack/pi-codex-agents/blob/0b25ba0126668f3a67b4886b4c88b1768ee41ff1/src/features/navigation.ts#L5-L19) 判断：

```ts
matchesKey(data, "left") && empty && prompts === 0
```

还受 `leftArrowEntry` 配置控制。`empty` 来源是 `ctx.ui.getEditorText() === ""`，`prompts` 是当前等待交互的 UI prompt 数，不是聊天轮数。

前端用 `ctx.ui.onTerminalInput()` 条件消费按键；受管 host 则维护自己的终端与 prompt 生命周期。该方案证明入口已有实践，但完整包有 Linux 平台约束，详见 [开源调研](open-source-survey.md)。

## Pi 1.4.0 公开能力与陷阱

以下定位相对已安装包 `C:/Users/De0ta/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/`，并非本仓库源码。

### 不建议直接注册裸 left 快捷键

```ts
registerShortcut(shortcut: KeyId, options: {
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
}): void;
```

`dist/modes/interactive/interactive-mode.js:1754-1767` 匹配后直接返回已处理。即使 handler 检测到非空并提前返回，原来的左移也不会继续。因此，“注册 left 后在 handler 里判断空输入”不是完整解决方案。

### 方案 A：主编辑器内条件拦截

通过 `ctx.ui.setEditorComponent()`，继承 `CustomEditor`，仅在主编辑器真正收到 `←` 且条件满足时接管，其余交给 `super.handleInput(data)`。

- 相关签名：`setEditorComponent(factory: EditorFactory | undefined): void`。
- 示例：安装包 `examples/extensions/modal-editor.ts:29-66,84-87`。
- 优点：主编辑器失去焦点后通常不接收按键，比全局拦截更容易保留弹窗行为。
- 风险：会替换现有编辑器；与其他自定义编辑器扩展共存需明确设计，不能直接覆盖用户配置。

轻量版已选定此路径；检测到已有自定义编辑器时不覆盖，并保留 `/session-browser` 命令退路。

### 方案 B：原始终端输入监听

`ctx.ui.onTerminalInput()` 可在命中条件后同步返回 `{ consume: true }`，不命中返回 `undefined`，因此能保留正常左移。

但监听发生在焦点分发之前：`node_modules/@earendil-works/pi-tui/dist/tui.js:719-733,775-780`。如果只判断主编辑器为空，会误抢对话框或 overlay 中的左键。需要维护交互 prompt、管理器开启状态和焦点规则；不能把回调改成异步后再决定是否消费。

该路径不必替换编辑器，上游完整 host 采用它，但其状态保护不能直接省略。

## 从按键进入会话命令

快捷键/普通事件上下文是 `ExtensionContext`，不含 `switchSession()`；扩展命令 handler 才有 `ExtensionCommandContext`。

拟议公开 API 流程：

1. 注册一个本扩展拥有且名称明确的管理器命令，作为快捷入口的后端与手动退路。
2. 在 TUI 主编辑器的合适位置检测空输入左键，立即同步消费并设置防重入标志。
3. 异步派发前复查空输入、当前会话、空闲/队列状态；捕获失败并恢复标志。
4. 命令 handler 展示 `ctx.ui.custom()`，拿到选择后先关闭 UI，再切换会话。
5. 切换后旧上下文失效；后续操作使用 `withSession` 提供的新上下文。

Pi 1.4.0 可用桥接形式（示意，尚未实现）：

```ts
pi.sendUserMessage("/your-session-manager", {
  expandPromptTemplates: true,
});
```

**前提是该命令已通过 `pi.registerCommand()` 注册。** 当前 `dist/core/agent-session.js:1636-1647,1698-1709` 会优先识别扩展命令并返回，因此不会为命中的扩展命令启动模型请求。`dist/core/agent-session.js:1910-1936` 显示 `sendUserMessage` 默认不展开，需要显式启用。

不要照抄成 `sendUserMessage("/resume")`：这条入口并不执行全部交互式内置命令；未命中的文字可能成为真实模型输入。实现时还需验证命令名称冲突、reload 和失效上下文，不能仅靠示意片段保证行为。

## 建议的最小保护条件

- `ctx.mode === "tui"`。
- 文本严格为 `""`；不要无意中把空格草稿视为空。
- 没有正在打开的管理器；按键连发不能重复打开。
- 没有正在使用的弹窗、overlay 或自动补全交互。
- 轻量历史管理版建议先限制为空闲且无排队消息；允许运行中浏览是后续单独设计项。
- 若允许运行中浏览，恢复操作不能无提示地停止当前任务。受管后台 host 与普通会话切换需区别处理。

## 真实终端待执行验证表

入口键码、编辑器文字/提交、已有编辑器冲突、取消、异步竞态与恢复状态保护已有自动化覆盖；以下为真实终端人工验收，仍未测试，不表示通过：

| 场景 | 预期 |
| --- | --- |
| 全新或已有历史，编辑器为空，按 `←` | 打开一次管理器，不发送模型请求 |
| 编辑器有普通文字、中文、多行或纯空格 | 保持正常光标移动，草稿不变 |
| 对话框/overlay/自动补全使用左键 | 不被管理器入口抢占 |
| 长按或快速连按左键 | 不重复打开、不产生未处理 Promise |
| Esc 退出管理器 | 回到原会话，草稿和焦点正确 |
| 选择会话恢复 | 关闭管理器后执行，遵守运行状态和取消策略 |
| reload、会话替换、反复进入退出 | 清理旧监听，不重复注册或使用失效上下文 |
| 与其他编辑器/UI 扩展同用 | 不静默覆盖，冲突行为可解释 |
| Windows Terminal、Git Bash 与 Linux/WSL | 分别验证键码、显示、焦点与终端恢复，不相互代替 |
