# PiSessionViewer

[English](README.md) | **简体中文**

**面向 Pi 的键盘优先会话浏览器。在终端中定位历史对话、预览上下文，并回到原项目继续工作。**

[![CI](https://github.com/De0ta/PiSessionViewer/actions/workflows/ci.yml/badge.svg)](https://github.com/De0ta/PiSessionViewer/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/De0ta/PiSessionViewer)](https://github.com/De0ta/PiSessionViewer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

PiSessionViewer 在 Pi 内提供全屏、面向项目的本地会话视图。无需离开终端，即可搜索历史、查看最近一轮问答，并恢复目标会话。

## 为什么选择 PiSessionViewer

- **跨项目定位对话。** 按项目、最近活动、模型或状态分组；搜索标题、项目路径、会话 ID 和消息文本，多个关键词采用 AND 匹配。
- **切换前先了解上下文。** 宽屏分栏展示元数据、末次回复及其对应提问，使用 Pi 原生 Markdown 渲染；窄屏提供独立详情视图。
- **以键盘完成操作。** 在空输入框按 `←`，或输入 `/session-browser` 打开。搜索、导航、重命名与帮助各有明确入口。
- **让标题更有辨识度。** 新的未命名会话先使用本地回退标题，首次成功交互后可由当前模型生成标题；用户手动命名始终优先。
- **明确确认后再恢复。** 独立确认页展示目标项目。有草稿、运行中任务或排队消息时阻止切换，不静默丢弃当前工作。
- **浏览过程保持本地。** 浏览、搜索与预览不调用模型，也不改写会话历史。自动命名是唯一使用模型的功能，详见[隐私与安全](#隐私与安全)。

这是本地会话浏览器，不是后台 Agent 编排器，也不是其他 Pi 进程的实时监控面板。

## 安装

要求 **Node.js 22.19.0+**、**Git**，以及 `@earendil-works/pi-coding-agent` 提供的 **Pi 1.4.x**。

```sh
pi install git:github.com/De0ta/PiSessionViewer@v1.0.0
```

重启 Pi，然后输入：

```text
/session-browser
```

也可以在主编辑器完全为空时按 `←`。编辑器包含文字、空格或换行，或自动补全处于活动状态时，保留原生按键行为。其他扩展已接管自定义编辑器时，请使用命令入口。

Pi 直接加载 TypeScript 扩展，无需编译、手动复制文件或单独配置 API 密钥。自动命名复用你已有的 Pi 模型配置与凭据。

默认安装到个人配置，以便跨项目切换后继续使用。除非明确需要项目级安装，否则不要添加 `--local`。不要同时加载已安装副本和 `pi -e .` 开发副本。

**分发方式：** 正式版通过 GitHub 提供，尚未发布 npm 包。固定标签不会因 `pi update --extensions` 自动升级到新版本；升级时应移除旧来源，再安装新的已发布标签。详见[安装、更新与卸载指南](https://github.com/De0ta/PiSessionViewer/blob/main/docs/install.md)。

## 快速开始

1. 打开 `/session-browser`，默认显示全部项目的会话。
2. 按 `F3` 搜索，按 `Tab` 限定当前项目，或按 `g` 切换分组。
3. 使用 `↑` / `↓` 选择对话，在详情栏查看最近一轮问答。
4. 按 `Enter` 或 `→` 进入恢复确认页。
5. 核对目标后确认，由 Pi 切换会话及其项目运行时。

按 `Esc` 可返回而不恢复。退出确认页后，原有搜索、分组、展开状态、选中项及详情滚动位置都会保留。

### 分组与预览

每组默认显示五条会话，选择 `Show more` 再展开五条。最近活动按六个互不重叠的区间划分：不足 5 小时、5 小时至 1 天、1–7 天、7–30 天、30–90 天，以及 90 天及以上。模型分组按供应商与模型 ID 聚合。

预览跟随当前分支，尊重已提交的上下文编辑。显示末次回复及其对应提问；尚无回复时显示最新提问。不展示思考内容和工具结果。

只有当前 Pi 进程的会话具有可观察的运行时状态。其他历史统一显示 `Saved`，**不代表其他进程已经停止使用该会话**。

## 会话管理 · 尚未发布

`main` 分支已包含以下增强。**这些功能不属于已发布的 `v1.0.0`。**

| 按键 | 操作 |
| --- | --- |
| `n` | 在当前工作目录新建空会话，不发送提问。 |
| `f` | 分叉选中会话的有效分支，保留末次回复，并打开副本。 |
| `p` | 置顶或取消置顶已保存会话；四种分组模式均有独立 `Pinned` 区。 |
| `Delete` | 打开确认弹层，永久删除一个非当前会话文件。 |
| `a` | 打开 New、Fork、Pin / Unpin、Rename、Delete 操作菜单。 |

搜索与重命名时，字母仍作为文本输入。尚未落盘的当前会话显示 `Unsaved`，不能置顶或分叉；当前会话不能删除。

分叉具有独立身份，标题追加 ` · Fork`，不继承置顶。历史分叉通过验证后的只读快照创建，不先恢复或改写源会话。如果副本已创建但打开失败，会保留该副本；在原确认页重试会复用它。

删除默认选中 **Cancel**。数字键仅改变选择，只有 `Enter` 提交。删除只影响单个会话文件，不删除项目或分叉，也不停止其他进程。置顶与历史标题别名独立于会话历史存储。

这些增强已通过类型检查、隔离测试、打包加载验证及独立代码审查。**真实终端交互和完整宿主运行时切换仍待人工验收。** 实现约束与验收清单见[会话管理专题](https://github.com/De0ta/PiSessionViewer/blob/main/docs/management.md)。

## 快捷键

下表对应已发布的 `v1.0.0` 浏览器；开发分支新增操作见上节。

| 按键 | 操作 |
| --- | --- |
| `↑` / `↓` | 选择会话，遵循 Pi 配置的列表方向键。 |
| `PageUp` / `PageDown` | 翻页选择。 |
| `Enter` / `→` | 进入恢复确认页、返回当前会话，或展开 `Show more`。 |
| `Tab` / `Shift+Tab` | 切换全部项目 / 当前项目；兼容 `Ctrl+O`。 |
| `F3` | 显示或隐藏搜索。 |
| `g` | 循环切换 Project → Recent → Model → Status。 |
| `r` | 编辑选中标题；`Enter` 保存，`Esc` 取消。 |
| `Shift+↑` / `Shift+↓` | 滚动末次回复，保留提问与元数据。 |
| `d` / `←` | 窄屏打开详情 / 返回列表。 |
| `Ctrl+R` | 重新扫描会话。 |
| `?` | 打开快捷键帮助。 |
| `Esc` | 退出帮助或搜索；普通模式下关闭浏览器。 |
| `Ctrl+C` | 关闭浏览器，不切换会话。 |

搜索与重命名模式保留普通文本输入及光标移动，不触发字母快捷操作。

恢复页使用 `↑` / `↓` 或 `1` / `2` 选择，`Enter` / `→` 确认，`Esc` / `Ctrl+C` 返回；`PageUp` / `PageDown` 滚动长路径或错误。只读预检可以取消；切换提交给 Pi 后，公开 API 无法撤销，页面会等待完成。

## 隐私与安全

### 本地历史

浏览和预览读取本地文件，不上传会话历史，也不连接作者运营的服务。历史重命名仅写入扩展专用别名；当前会话重命名使用 Pi 原生名称元数据。恢复历史会话后，别名才转为原生名称。

预览中的每条提问和回复各限制为 6,000 字符。超过 16 MiB 的文件跳过预览及模型元数据读取，但仍可恢复。Pi 发现 API 为建立搜索索引仍会扫描历史；会话较多时可限定当前项目。

### 自动标题

符合条件的未命名会话在首次成功交互后先保存本地回退标题，再向当前配置的模型额外请求至多一次。请求使用首问最多 4,000 字符和对应最终文本回复最多 2,000 字符，尊重已提交的上下文编辑并去除包装内容；不包含思考、工具结果或图片。

请求输出上限为 256 token，超时为 15 秒。它可能产生模型费用，用量不会自动计入 Pi 主对话统计。失败时保留回退标题，不自动重试；不覆盖已有名称或用户手动命名，也不批量重命名历史。开发分支还会清理新模型结果中的通用标题标签前缀。

### 会话切换与破坏性操作

恢复会替换当前会话及项目运行时。Pi 1.4 公开 API 不支持在保留当前项目目录的同时恢复其他项目的会话。预检会核对目标身份、文件修订和项目目录可访问性，不修复路径，也不创建缺失项目。

本扩展没有跨进程锁。恢复或删除前，请确认其他 Pi 实例没有写入该会话。修订检查可以降低风险，但无法消除文件系统竞态。Pi 原生恢复可能迁移旧格式；浏览与预检不会。

本扩展不提供后台执行、远程连接、跨进程停止、归档、回收站或 worktree 管理。

## 兼容性

| 环境 | 验证范围 |
| --- | --- |
| Windows、Ubuntu；Node 22.19 与 24 | 已发布 v1.0 通过四组 CI、97 项测试、发布包加载及 Git 安装 smoke。 |
| Windows 管理增强；Node 24 / Pi 1.4.0 | 164 项测试通过；1 项符号链接测试因 Windows 权限跳过。类型检查与隔离打包加载通过。 |
| 真实交互终端、SSH、tmux | 完整端到端人工验收尚未完成。 |
| macOS、Pi 1.4.x 以外版本 | 未验证。 |

旧发布结果不代表未发布增强已获得同等平台覆盖。Linux 使用原生 POSIX 路径，不会自动将 Windows 项目路径转换为 Linux 或 WSL 路径。旧版 `@mariozechner/*` 和其他 Pi 分支不属于兼容性承诺。

## 开发

```sh
git clone https://github.com/De0ta/PiSessionViewer.git
cd PiSessionViewer
npm ci
npm run check
npm test
npm run smoke:package
npm run smoke:install
```

在可丢弃项目中交互试用源码，可使用 `pi -e /absolute/path/to/PiSessionViewer`；不要同时启用已安装副本。

测试使用临时目录、合成会话和模型替身。`smoke:package` 在隔离环境中通过真实 Pi 扩展加载器检查当前工作树。默认 Git 安装 smoke 使用本地传输重定向检查已提交的 `HEAD`，不验证未提交改动或 GitHub 公网可达性。检查公开版本的匿名安装可使用：

```sh
npm run smoke:install -- --public --ref v1.0.0
```

这些检查不附着真实终端、不请求付费模型、不修改真实历史，也不安装到个人 Pi 配置。加载器检查和受控宿主替身不能替代完整运行时验收。

## 文档与支持

- [安装、更新、卸载与故障排查](https://github.com/De0ta/PiSessionViewer/blob/main/docs/install.md)
- [会话管理：实现边界与人工验收](https://github.com/De0ta/PiSessionViewer/blob/main/docs/management.md)
- [版本记录](CHANGELOG.md)
- [v1.0 发布验证](https://github.com/De0ta/PiSessionViewer/blob/main/docs/release-v1.0.md)
- [技术文档与设计记录](https://github.com/De0ta/PiSessionViewer/tree/main/docs)
- [提交问题](https://github.com/De0ta/PiSessionViewer/issues)

报告问题时，请提供操作系统、终端、Node/Pi 版本与复现步骤。截图和日志应先脱敏，不要附上凭据或完整私人会话。

## 许可证

采用 [MIT](LICENSE) 许可证。分发内容不包含会话历史、凭据、个人 Pi 配置或参考截图。
