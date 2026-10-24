# 会话管理参考（v1.0.1）

Pi Session Viewer 为本机会话提供新建、分叉、置顶、永久删除和操作菜单。支持 Pi 1.4.x 与 Node.js >=22.19.0；安装方式见[安装指南](install.md)。

## 新建与未落盘会话

- `n` 在当前 cwd 原生新建会话，不带 prompt。
- 当前会话尚未落盘时显示为 `Unsaved`；保存并重新扫描后可置顶、分叉。当前会话不能删除。
- 新建、分叉和恢复均检查任务、队列和编辑器草稿，确认可以切换后再进入目标会话。

## 分叉

`f` 从已保存会话创建独立 Fork，标题追加 ` · Fork`，不继承置顶。

- **当前会话**：调用 `ctx.fork(leaf, { position: 'at' })`，保留当前叶节点和末次回复。名称在新 runtime 的 `session_start`（reason 为 fork）中追加后缀。
- **历史会话**：只读捕获 v1/2/3 快照，在私有副本转换旧格式，保留有效分支、原生引用的传递闭包及 latest reply；写入新的 v3 文件后调用 `ctx.switchSession`，源文件保持不变。
- **内容与名称**：保留 system 消息、sections、工具定义增删及压缩中的 systemMessage。全局最新 session_info 在分支裁剪前读取，插件手动别名优先。
- **格式与大小**：历史快照上限为 16 MiB。损坏 JSONL、无有效对话、重复 ID、断链或循环、缺失引用及未知版本/记录/消息格式均拒绝处理。缺少 cwd 的历史会话不能分叉。
- **打开失败**：创建与打开是两个步骤。文件创建后会保留；在原确认页重试会复用该文件，返回后也可刷新列表找到并打开。

## 置顶

`p` 切换 Pin / Unpin。Project、Recent、Model、Status 四种分组均有独立 `Pinned` 区。

- 先应用搜索和当前项目过滤，再分组；置顶项不在普通组重复。
- 按置顶时间倒序排列，默认显示 5 条，每次再展开 5 条。
- 记录位于 `getAgentDir()/pi-session-viewer/pins`，与源会话分开保存。按规范化会话路径和 ID 计算 SHA-256，分别存储记录，通过临时文件与原子 rename 提交。

## 永久删除

`Delete` 删除单个非当前会话文件，没有回收站。项目目录和关联 Fork 保留。

- 确认弹层默认选中 `Cancel`。数字仅改变选择，`Enter` 才提交；返回取消操作。
- 确认前后复核路径、会话 ID/cwd 和 revision，删除头部读取上限为 1 MiB。未知格式、身份不符、修订变化或非普通文件会拒绝删除，列表缓存不作为删除依据。
- 缺少 cwd 的旧会话可在空 cwd 身份匹配时捕获与删除。
- 文件访问不使用跨进程锁，操作前请关闭其他写入该会话的 Pi 实例。`Saved` 表示已保存的历史记录。

## 菜单、输入与标题

- `a` 打开 New / Fork / Pin（或 Unpin）/ Rename / Delete 菜单；`r` 改名和 `d` 窄屏详情保留。
- 搜索、重命名等输入模式中，字母用于文本输入。
- 自动命名使用用户配置的模型提供方，可能产生费用；手动标题优先，失败或超时保留本地标题。
- 自动标题指令与 `cleanModelTitle` 清理“短会话标题-”“会话标题:”“Short session title”等前缀，仅处理新结果，已有标题保持不变，清理不增加模型请求。

## 检查结果

- Windows / Node 24：`npm run check` 通过；165 项测试，164 通过、0 失败、1 项因符号链接权限跳过。
- `npm run smoke:package` 通过，包内共 20 个文件，扩展加载器成功注册 `/session-browser`。
- Git 安装检查通过，加载版本为 1.0.1。
- Windows/Ubuntu × Node 22.19/24 四组 CI 检查通过。版本对应的执行记录见 [GitHub Release](https://github.com/De0ta/PiSessionViewer/releases/tag/v1.0.1)。
