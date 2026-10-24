# 安装、更新与卸载 / Installation

## 前置条件

- Node.js **22.19.0 或更高**。
- 若使用 Git 来源，命令行需有可用的 **Git**；npm 来源不需要 Git。
- 已安装 `@earendil-works/pi-coding-agent` **1.4.x**，且 `pi --version` 能正常运行。
- Windows 或 Linux；自动化检查覆盖 Windows/Ubuntu × Node 22.19/24。

PiSessionDeck 是 Pi 扩展，可通过 npm 或 GitHub 安装，无需构建或在插件目录手动执行 `npm install`。

## 安装

推荐通过 npm 安装：

```sh
pi install npm:@link17528/pi-session-deck
```

固定 npm 版本使用 `pi install npm:@link17528/pi-session-deck@1.0.1`。也可安装 GitHub 标签：

```sh
pi install git:github.com/De0ta/PiSessionDeck@v1.0.1
```

默认安装到个人代理配置，跨项目可用；仅需当前项目使用时可加 `--local`。重启 Pi 后输入 `/session-browser`，或在完全空白的输入框按 `←`。

## 基本操作

| 按键 | 功能 |
| --- | --- |
| `F3` | 搜索 |
| `Tab` | 切换当前项目 / 全部项目范围 |
| `g` | 切换分组 |
| `↑/↓` | 选择会话 |
| `Enter/→` | 进入恢复确认页 |
| `r` / `d` | 手动改名 / 窄屏详情 |
| `n` / `f` | 当前 cwd 新建 / 分叉已保存会话 |
| `p` | 置顶或取消置顶 |
| `Delete` | 永久删除单个非当前会话 |
| `a` / `Esc` | 打开操作菜单 / 返回或退出 |

搜索和改名输入模式中，字母按键用于输入文本。未落盘会话显示 `Unsaved`，保存后可置顶和分叉；当前会话不能删除。置顶信息独立保存，四种分组均显示 `Pinned` 区，并遵循搜索和项目过滤。

恢复经确认后由 Pi 切换到目标项目。新建、分叉和恢复均检查任务、队列和编辑器草稿；切换前请保存或清空草稿。

分叉保留有效分支和末次回复，不改写源会话、不继承置顶。历史快照上限为 16 MiB；创建后打开失败时文件保留，可重试或刷新列表后打开。

删除没有回收站，默认选中 `Cancel`；数字只选择，`Enter` 才确认。操作会复核路径、会话 ID/cwd 和 revision，头部读取上限为 1 MiB。删除仅作用于所选会话文件，保留项目和关联 Fork。请先关闭其他写入该会话的实例：插件不停止其他进程，也不提供跨进程锁。详见[会话管理参考](https://github.com/De0ta/PiSessionDeck/blob/main/docs/management.md)。

## 更新

未指定版本的 npm 来源可直接更新，然后重启 Pi：

```sh
pi update --extensions
```

指定的 npm 版本、Git 标签与提交不会自动追踪新版本。用 `pi list` 查看当前来源，移除旧来源后安装目标版本。例如，切换到 npm 来源：

```sh
pi remove git:github.com/De0ta/PiSessionDeck@v1.0.1
pi install npm:@link17528/pi-session-deck
```

Git 来源从 v1.0.0 升级到 v1.0.1：

```sh
pi remove git:github.com/De0ta/PiSessionDeck@v1.0.0
pi install git:github.com/De0ta/PiSessionDeck@v1.0.1
```

移除命令应使用 `pi list` 中记录的实际来源，包括提交版本和使用旧仓库名 PiSessionViewer 的安装；GitHub 的地址重定向不会自动修改本地来源声明。保持单一安装来源，避免同时加载安装版和 `pi -e .`。无标签的 `main` 来源会跟随开发分支。

## 卸载

按 `pi list` 中的实际来源移除，例如：

```sh
pi remove npm:@link17528/pi-session-deck
```

固定 npm 版本或 Git 来源应使用对应的完整声明，例如 `npm:@link17528/pi-session-deck@1.0.1` 或 `git:github.com/De0ta/PiSessionDeck@v1.0.1`。

重启 Pi。会话历史保留；手动标题缓存和置顶元数据位于代理配置下的 `pi-session-viewer` 目录，不再需要时可单独清理。

## 本地数据与模型费用

浏览、搜索和预览读取本机会话历史。手动标题和置顶使用独立的插件元数据，置顶不会改写会话文件。

首轮成功交互后，自动命名可能向**你配置的模型提供方**额外请求一次，使用经上下文编辑解析、剥除技能包装并限制长度的首轮提问与最终回复片段，因此可能产生费用。该独立请求的用量不自动计入 Pi 主对话统计；失败或超时保留本地标题，手动标题优先。

新建、分叉、置顶、删除和菜单操作本身不请求模型。新标题会清理“会话标题:”等标签前缀，已有标题保持不变。

## 检查结果

- Windows / Node 24：`npm run check` 通过；165 项测试，164 通过，1 项因符号链接权限跳过。
- 打包检查通过，共 20 个文件；Git 安装检查成功加载 1.0.1。
- Windows/Ubuntu × Node 22.19/24 四组 CI 检查通过。版本对应的执行记录与安装包见 [GitHub Release](https://github.com/De0ta/PiSessionDeck/releases/tag/v1.0.1)。

## 故障排查

- 找不到命令：确认 Pi 1.4.x，检查 `pi list` 并重启 Pi；移除已失效的本地安装来源。
- 克隆失败：检查 Git、网络和目标提交或标签是否存在；代理与镜像使用本机 Git 配置。
- 恢复失败：检查原项目目录、会话文件、编辑器草稿及任务/队列状态。Linux 使用本机 Node/Pi 和 Linux 项目路径；Windows 路径不会自动映射为 WSL/Linux 路径。缺失目录会在预检时提示，源历史头部保持不变。
- 中文、颜色或按键异常：提供操作系统、终端、Node/Pi 版本、终端宽高及脱敏截图，避免附带完整会话或凭据。

## 源码试用

```sh
npm ci
npm run check
npm test
npm run smoke:package
npm run smoke:install
pi -e .
```

打包检查验证当前工作树的发布包和扩展加载；Git 安装检查验证已提交 HEAD，默认使用本地仓库和临时 Pi 配置。`pi -e .` 在本次启动加载源码版，使用前请关闭重复加载的安装版。
