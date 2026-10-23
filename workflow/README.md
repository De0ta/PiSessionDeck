# PiSessionViewer 工作流

## 项目目标

参考 Codex CLI command center，为 Pi 提供终端会话浏览体验。当前选择 Windows 友好的轻量历史管理器，不实现后台多 Agent host。

## 当前阶段

**轻量版 v0.1 已编码并通过自动化验证，真实终端人工验收待完成。**

- 用户确认：先实现轻量版，并在本人 GitHub 建立私有仓库。
- 仓库可见：`src/`、`test/`、包清单/锁文件、TypeScript 检查、使用文档及四份工作流。
- 已实现：空输入 `←` 与 `/session-browser`、当前/全部项目搜索、分组列表、双栏/窄屏预览、确认后恢复、忙碌与待处理消息保护。
- 已验证：严格类型检查、合成会话测试、真实 Pi 扩展加载器加载；独立审查的问题已修复并回归。
- 未验证：真实终端的焦点/按键/屏幕效果、完整跨项目运行时替换、用户现有扩展组合、Linux/WSL/macOS。
- 未做：安装到用户 Pi、调用模型、启动后台 host、修改真实历史、公开发布。

## 交付状态

| 工作项 | 状态 | 说明 |
| --- | --- | --- |
| Codex / Pi API / 开源方案调研 | 已完成 | 详见专题文档，保留平台边界 |
| Windows 原生轻量路线 | 已选定 | 使用 Pi 1.4 公开 API 自研 |
| 轻量浏览器 | 自动化验证通过 | 真实终端验收待完成 |
| 私有 GitHub 仓库 | 已创建 | <https://github.com/De0ta/PiSessionViewer>；代码推送在交付时核实 |
| 后台多会话中心 | 未实现 | 与轻量历史恢复区分，不伪造运行状态 |

## 接下来

1. 按根目录 README 使用 `pi -e .` 临时加载，不自动修改全局配置。
2. 按[人工验收表](../docs/lightweight-v0.1.md#待人工验收)检查真实终端与可丢弃会话。
3. 依据反馈修正体验，再决定是否扩展命名/归档或后台 host。

## 文档导航

- [plan.md](plan.md)：后续里程碑与验收门槛。
- [docs.md](docs.md)：平台、公开 API 与安全约束。
- [agents.md](agents.md)：授权边界和维护方法。
- [轻量版设计与验证](../docs/lightweight-v0.1.md)
- [开源候选调研](../docs/open-source-survey.md)
- [空输入左键分析](../docs/empty-left-entry.md)
