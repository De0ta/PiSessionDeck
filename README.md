# PiSessionViewer

面向 Pi 的轻量终端历史会话浏览器，参考 Codex CLI command center 的项目列表与详情交互。**不是后台多 Agent 管理器。**

A lightweight terminal session browser for Pi 1.4.x. Browse, search, preview and resume your local sessions. MIT licensed; distributed through GitHub, not npm.

[![CI](https://github.com/De0ta/PiSessionViewer/actions/workflows/ci.yml/badge.svg)](https://github.com/De0ta/PiSessionViewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 当前功能

- 主编辑器完全为空时按 `←` 打开；有文字、空格、换行或自动补全时保留原生行为。
- `/session-browser` 命令入口；已有其他自定义编辑器时不覆盖它，改用命令。
- 真正覆盖终端可视区的深色页面；退出恢复聊天与草稿，不把浏览器插入聊天流。
- 默认全部项目，支持当前项目过滤；`g`循环切换项目 / 最近活动 / 模型 / 状态分组。Recent按5小时、1天、1周、1个月、3个月划为六档；Model按供应商与模型ID聚合，Status按状态聚合。各组间留空行，默认5条，`Show more`每次展开5条；会话身份色稳定，选中行蓝底。
- 搜索标题、项目路径、会话 ID 和消息文本；多个关键词采用 AND 匹配。
- 搜索条默认隐藏，`F3` 搜索时显示灰底蓝字输入栏；宽屏 Tasks + Task details，详情标题最多3行，模型/供应商/推理分色；末次回复及其对应提问使用 Pi 原生 Markdown 渲染，Prompt 中链接和本地路径呈蓝色，超长灰色省略，Prompt 至少保留2行。
- 首次成功交互后，后台通过当前模型理解首轮问答拟写标题；先保存本地提炼标题，模型失败/超时则保留它，不覆盖已有名称或生成期间的手动命名。`r` 编辑选中标题。历史会话使用独立别名，恢复为当前会话后才写入原生名称。
- `Status`列标题灰色，各会话状态文字为柔和灰白色，所有按键名纯白；右栏标题前留空行、状态前加圈，Reasoning与Project隔行、路径另起一行。
- `?` 打开 Navigate / Tasks / View 帮助页；`F3` 显式开启搜索，搜索中输入快捷键字母不会触发动作。
- 选择历史后进入独立转换页：同目录显示`Resume session`，跨目录显示`Working directory · resume`与Session/Current路径。仅顶部内容块深灰，下面保持终端底色且不露出聊天；Esc返回原列表，保留搜索/分组/展开/选中/详情滚动。确认后由Pi恢复；有任务、队列或草稿时拒绝切换，错误留在页内。

## 会话管理增强（Unreleased）

已实现并通过类型检查、165项自动化中的164项（Windows符号链接权限导致1项跳过）、工作树打包加载验证和独立审查修复复核；真实终端与完整宿主切换待人工验收。下列能力尚未发布，不属于已发布的 v1.0.0。详见[管理边界与隔离验收表](docs/management.md)。

- `n`：在当前 cwd 新建会话，不自动发送 prompt；未落盘当前行显示 `Unsaved`，不能删除当前会话，也不能 pin / fork。
- `f`：当前会话走原生 `ctx.fork(leaf, { position: 'at' })`；历史会话只读严格快照 v1/2/3，复制有效分支、引用闭包及 latest reply 到新文件，再切换，不先恢复源。新标题追加 ` · Fork`，不继承 pins；已创建但未打开的 Fork 保留，可刷新发现或重试打开，避免重复创建。
- `p`：四种分组模式共用独立 `Pinned` 区；先应用搜索/项目过滤，再分组，不在普通组重复，按置顶时间倒序，每组默认5条。
- `Delete`：仅永久删除非当前的单个会话文件。居中深灰确认层默认 `Cancel` 蓝条，数字仅选择，`Enter` 才确认；复核身份与 revision，无跨进程锁，不停止其他进程、不级联删除 Fork、不删除项目。
- `a`：操作菜单；输入模式保留字母输入，保留 `r` 命名和 `d` 窄屏详情旧按键。
- 自动标题加强 system prompt 并由 `cleanModelTitle` 清理“短会话标题-”“会话标题:”“Short session title”等前缀；不改旧标题、不重新请求模型。

## 安装 / Install

要求 Node `>=22.19.0`、Git，以及`@earendil-works/pi-coding-agent`的Pi `>=1.4.0 <1.5.0`。不承诺旧版`@mariozechner/*`或其他Pi分支兼容。

```sh
pi install git:github.com/De0ta/PiSessionViewer@v1.0.0
```

重启Pi后使用`/session-browser`，或在完全空白的输入框按`←`。Pi负责克隆和加载TypeScript，不需要手动编译或复制文件，也不需要额外配置本插件的API密钥。

默认安装到个人配置，跨项目恢复后仍能加载。不建议使用`--local`进行项目级安装，否则切换项目后插件可能不再启用。已有本地开发版时，请先用`pi list`检查并移除旧来源，避免同时加载两份。

固定版本不会随`pi update --extensions`自动跳到下一个标签；升级时移除旧来源再安装新标签。安装、升级、卸载和源码试用见[安装指南](docs/install.md)。本项目未发布npm包，不要使用`npm install -g pi-session-viewer`。

### 平台与验证边界

以下通过记录属于已发布 v1.0，不代表 Unreleased 管理增强已验证。

| 环境 | 验证情况 |
| --- | --- |
| Windows / Node 24 / Pi 1.4.0 | 本地自动化与独立加载验证通过；真实终端端到端未纳入自动化 |
| Windows + Ubuntu / Node 22.19、24 | 四组CI、97测试、发布包加载与Git安装smoke全部通过 |
| Linux真实终端 / SSH / tmux | 未人工验收；自动化通过也不等于这些交互环境全部验证 |
| macOS、其他Pi版本 | 未验证 |

Linux按原生POSIX路径处理，无Windows专用运行依赖；请使用Linux自身的Node/Pi与会话目录，不要直接恢复包含Windows项目路径的会话。

## 快捷键

| 按键 | 操作 |
| --- | --- |
| `↑` / `↓` | 选择会话（遵循 Pi 的列表方向键配置） |
| `PageUp` / `PageDown` | 翻页选择 |
| `Enter` / `→` | 进入恢复转换页；当前会话直接返回；选中 `Show more` 则展开5条（搜索中`→`保留光标移动） |
| `Tab` / `Shift+Tab` | 全部项目 / 当前项目（`Ctrl+O` 仍兼容） |
| `F3` | 打开 / 关闭搜索 |
| `r` | 编辑选中标题；Enter保存，Esc取消；搜索中仍是普通字母 |
| `g` | 循环切换 Project → Recent → Model → Status 分组 |
| `?` | 快捷键帮助 |
| `Ctrl+R` | 重新扫描 |
| `Shift+↑` / `Shift+↓` | 只滚动最后回复，保留Prompt与元数据 |
| `d` / `←` | 窄屏详情 / 列表（搜索模式保留光标移动） |
| `Esc` | 从帮助 / 搜索返回；普通模式关闭 |
| `Ctrl+C` | 直接关闭浏览器，不切换 |

### 恢复转换页

同目录只显示目标会话与共用目录，跨目录显示目标/当前目录并提示运行时切换。Pi 1.4公开API不支持保持当前目录恢复其他项目，因此只提供真实可用的`Resume this session`或`Use session directory and resume`，不伪造四个目录选项或“始终”偏好。

`↑/↓`或`1/2`选项，`Enter/→`确认，`Esc/Ctrl+C`返回列表，`PgUp/PgDn`滚动长路径/错误。只读预检过程中可返回并取消检查；一旦提交给Pi，公开API无法撤销，页面会显示等待并暂停按键，不能承诺此时Esc取消。

## 安全与范围

- 浏览、搜索、预览不调用模型，不改写历史文件。自动命名会额外请求当前模型一次，使用现有配置/认证，可能产生费用；不会把命名指令或结果作为消息加入主对话。只对未命名、无手动命名记录及自动命名标记的会话启动，不批量重算既有标题。
- 命名请求只发送尊重已提交上下文编辑的首问文本（最多4000字符）及首轮最终文本回复（最多2000字符），不含思考、工具结果、图片和资源包装块；输出上限256 token，15秒超时，关闭/切换/reload取消。模型失败后不自动重试，保留本地标题。
- 自动命名和当前会话`r`命名使用 Pi 原生名称元数据；其他历史`r`只写扩展专用别名，恢复后才转成原生名称。别名存放在 Pi agent 目录的 `pi-session-viewer/titles/`，不保存在项目仓库。
- 详情字段跟随当前分支；最后回复及对应提问各限制6000字符；尚无回复时显示最新提问。尊重完整分支的上下文编辑，包括删除与空替换；不展示思考和工具结果。超过16 MiB的文件跳过详情读取，仍可恢复。
- 16 MiB限制约束详情和Model分组的额外文件读取；损坏、缺失、过大或无模型的历史归入`Unknown model`，不影响恢复。模型元数据使用只读内存投影、限4并发及文件修订缓存；只有切到Model时才加载。Pi发现API为建立搜索索引仍扫描完整历史，历史很多时可用`Tab`限定当前项目。
- Recent根据最后活动时间分为：小于5小时、5小时至1天、1天至7天、7天至30天、30天至90天、90天及以上；1个月按30天计。只显示非空组，不重叠计数。
- 只有当前进程会话显示真实 `Ready` / `Working` / `Queued` 及本扩展观察到的 `Completed` / `Stopped` / `Error`；状态圈为默认灰、进行中蓝、已完成绿。其他历史统一标记 `Saved`，**不代表它已停止运行**。轻量版不能判断其他进程是否正在写同一会话，恢复前务必确认。
- 恢复会替换当前会话与项目运行时。Pi可能迁移编辑器文字，因此有任何草稿（含空格/换行）时阻止恢复，需先返回聊天保存或清空；退出而不恢复则保留原编辑器。异步预检前后都检查任务、队列和草稿。
- v1.0 没有置顶/删除；Unreleased 管理增强边界见上文。仍不提供后台驻留、远程连接、实时多会话状态、跨进程停止、归档/回收站或 worktree。模型标题仅用于命名，不承担任务执行。不替代 Pi 原生 `/resume` 的全部管理功能。
- 提交前只读核查文件存在/非空、64 KiB内的会话头、ID/目录/版本与文件修订、目标目录存在且可访问；缺失或异常留在转换页，不创建文件，也不通过`process.chdir()`或原地迁移修复。预检不完整解析全文件、不能杜绝随后发生的文件系统竞态或宿主内部错误；Pi原生恢复可能迁移旧格式，这是实际恢复而非浏览/预检的行为。

## 发布验证

仓库现已公开，采用MIT；[四组CI](https://github.com/De0ta/PiSessionViewer/actions/runs/39999387318)通过。禁用Git凭据后的匿名固定提交安装和真实Pi加载也已通过。详见[发布验证记录](docs/release-v1.0.md)。Linux真实终端交互仍待人工验收，不保证所有终端组合。

## 开发与验证

```sh
npm ci
npm run check
npm test
npm run smoke:package
npm run smoke:install
pi -e .
```

最后一条命令仅在本次启动试用源码；安装后不要再同时用`-e .`加载第二份。`smoke:package`会在临时目录打包/解包，通过真实Pi加载器验证发布源码，在包内无依赖目录的情况下注册命令；不附着终端、不请求模型、不恢复真实历史、不改变全局安装。

公开标签可单独检查匿名安装：`npm run smoke:install -- --public --ref v1.0.0`。默认Git smoke重定向到本地已提交HEAD；只有公开模式实际访问GitHub。

测试使用临时目录和合成会话，无真实模型请求；包含 Pi 真实扩展加载器与受控宿主替身。**尚未在真实交互终端中验收，也未自动安装到用户 Pi。**

- [安装、更新与卸载](docs/install.md)
- [版本记录](CHANGELOG.md)
- [会话管理增强：实现边界与隔离人工验收](docs/management.md)
- [工作流与当前进度](https://github.com/De0ta/PiSessionViewer/blob/main/workflow/README.md)
- [v0.6 独立恢复转换页](docs/resume-v0.6.md)
- [v0.5 四种会话分组](docs/groups-v0.5.md)
- [v0.4 模型标题与交互](docs/model-titles-v0.4.md)
- [v0.3 细节、命名与验证](docs/refinements-v0.3.md)
- [全屏改版设计与验证](docs/fullscreen-v0.2.md)
- [初版设计记录](docs/lightweight-v0.1.md)
- [开源方案调研](docs/open-source-survey.md)
- [空输入左键分析](docs/empty-left-entry.md)

MIT许可证见[LICENSE](LICENSE)。截图、真实会话、凭据、用户配置和依赖目录不纳入版本控制或发布包。仅在GitHub发布；包元数据保留`private: true`以防误发npm，不影响Git来源安装。
