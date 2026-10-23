# PiSessionViewer 工作流

## 项目目标

参考 Codex CLI command center，为 Pi 提供终端会话浏览体验。当前选择 Windows 友好的轻量历史管理器，不实现后台多 Agent host。

## 当前阶段

**v1.0.0发布准备中：用户已授权MIT开源与GitHub公开Release，不发布npm。终端控制序列与POSIX路径问题已修复，本地97项测试、类型检查、16文件发布包加载及隔离Git安装通过；Windows/Linux四组CI与公开前审查待完成。真实终端与实际恢复效果仍待人工验收。**

- 用户确认：轻量版已完成，并追加授权两处审查修复、MIT许可证、Windows/Linux CI和GitHub首个正式版公开发布；npm另行决定。
- 仓库可见：`src/`、`test/`、包清单/锁文件、TypeScript 检查、使用文档及四份工作流。
- 已实现：空输入`←`、`/session-browser`、全屏深色双栏、5条展开；v0.5新增Model/Status分组、Recent六档时间组及所有分组的独立展开；保留v0.4当前模型后台拟标题/本地回退、末次回复对应Prompt、隐藏搜索、`r`命名、地址分色、`→`打开、灰白状态与白色按键名/右栏布局，以及安全恢复与手动标题优先；v0.6恢复改为独立页面，同目录简化确认、跨目录对照路径，取消返回原浏览器，预检缺失文件/目录且拒绝携带草稿。
- 已验证：严格类型检查、合成会话测试、真实 Pi 扩展加载器加载；独立审查的问题已修复并回归。
- 未验证：真实终端的焦点/按键/屏幕效果、完整跨项目运行时替换、用户现有扩展组合、Linux/WSL/macOS。
- 未做：安装到用户真实Pi、调用模型、启动后台host、修改真实历史；公开发布尚待CI/审查门槛。隔离安装测试只使用临时目录。

## 交付状态

| 工作项 | 状态 | 说明 |
| --- | --- | --- |
| Codex / Pi API / 开源方案调研 | 已完成 | 详见专题文档，保留平台边界 |
| Windows 原生轻量路线 | 已选定 | 使用 Pi 1.4 公开 API 自研 |
| 轻量浏览器 | 自动化验证通过 | 真实终端验收待完成 |
| GitHub仓库与v1.0 | 当前PRIVATE，准备通过门槛后公开及创建Release | <https://github.com/De0ta/PiSessionViewer>；主分支 `main`，初始实现提交 `08ae51b` |
| 后台多会话中心 | 未实现 | 与轻量历史恢复区分，不伪造运行状态 |

## 接下来

0. 完成Windows/Ubuntu×Node22.19/24 CI、独立发布审查和历史敏感信息检查，通过后公开仓库、标记v1.0.0并验证匿名安装。见[发布记录](../docs/release-v1.0.md)。

1. 按根目录 README 使用 `pi -e .` 临时加载，不自动修改全局配置。
2. 按[人工验收表](../docs/fullscreen-v0.2.md#待人工验收)检查真实终端与可丢弃会话。
3. 按[v0.6恢复页验收](../docs/resume-v0.6.md#人工验收)检查同/跨目录页面、返回保留、缺失目标/草稿拦截和实际恢复；按[v0.5分组验收](../docs/groups-v0.5.md#人工验收)检查四种分组、展开和实时变化；按[v0.4验收](../docs/model-titles-v0.4.md#人工验收)检查命名及详情；归档或后台host仍为独立范围。

## 文档导航

- [plan.md](plan.md)：后续里程碑与验收门槛。
- [docs.md](docs.md)：平台、公开 API 与安全约束。
- [agents.md](agents.md)：授权边界和维护方法。
- [v0.6 独立恢复转换页](../docs/resume-v0.6.md)
- [v0.5 四种会话分组](../docs/groups-v0.5.md)
- [v0.4 模型标题与交互](../docs/model-titles-v0.4.md)
- [v0.3 细节、命名与验证](../docs/refinements-v0.3.md)
- [全屏改版设计与验证](../docs/fullscreen-v0.2.md)
- [初版设计记录](../docs/lightweight-v0.1.md)
- [开源候选调研](../docs/open-source-survey.md)
- [空输入左键分析](../docs/empty-left-entry.md)
