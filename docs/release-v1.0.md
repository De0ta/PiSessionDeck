# v1.0.0 发布验证记录

## 最终结果

[GitHub v1.0.0正式Release](https://github.com/De0ta/PiSessionDeck/releases/tag/v1.0.0)已公开发布，非草稿、非预发布。注释标签指向`a75c1ac30f1f0c7ba8d605481d1d9b25a1e77892`，该提交[四组CI](https://github.com/De0ta/PiSessionDeck/actions/runs/39999968949)全部通过。标签已通过匿名真实Pi安装与加载验证，发布包和SHA256文件均已匿名下载回验。本记录的后续文档提交不移动已发布标签。

附件`pi-session-viewer-1.0.0.tgz`为33,602字节、16文件；SHA256：`2918449f93a86552bd6e7fc4903664be3183e29c941848446ce354f020066e6a`。未执行npm发布或修改用户全局Pi安装。

## 范围与分发

用户已授权修复两处发布审查问题、选择MIT许可证、补Windows/Linux CI和安装文档、公开现有GitHub仓库并创建首个正式Release。仅GitHub分发；保留包元数据`private: true`防止误发npm。

安装入口：`pi install git:github.com/De0ta/PiSessionDeck@v1.0.0`。条件是Node >=22.19.0、Git、Pi 1.4.x。源码无需编译，Pi通过manifest和自己的模块映射加载。

## 本次修复

1. 终端输出：历史model/provider/reasoning在切分、着色前使用`safeText()`过滤，回归覆盖OSC52剪贴板、OSC终端标题、CSI清屏与定位；保留正常的provider/模型/推理分色。
2. 路径：POSIX只剥离末尾`/`，保留合法反斜杠；Windows仍按两种分隔符、大小写规则处理，根目录不折叠。

## 自动化证据

| 项目 | 结果 |
| --- | --- |
| Windows本机 Node24.13.0 / Pi1.4.0 | 严格类型检查、97/97测试通过 |
| 发布包smoke | 16个白名单文件，含LICENSE/CHANGELOG/安装指南；临时解包无包内依赖目录，真实Pi加载器按manifest注册命令与生命周期事件 |
| Git安装smoke | 实际Pi CLI、临时agent/project目录、固定提交、settings持久化、资源解析及扩展加载通过；Git远程传输重定向本地提交 |
| Windows/Ubuntu × Node22.19/24 CI | [四组全部通过](https://github.com/De0ta/PiSessionDeck/actions/runs/39999387318)，包括97测试及两种smoke |
| 公开前历史审查 | 独立审查无发布阻塞；7提交/112唯一文件对象启发式核查未发现凭据、真实历史或截图。文档F3快捷键和lock许可证两处P3已修复 |
| 匿名GitHub安装 | 仓库已核查PUBLIC，禁用全局/system Git配置与凭据helper，固定提交aeb46d1与固定标签v1.0.0均通过匿名实际Pi安装和加载 |
| Release附件 | tgz和SHA256SUMS均已上传；匿名下载后的摘要与本地及GitHub服务器摘要一致 |

CI以最小`contents: read`权限执行，使用合成会话和临时配置。发布包smoke测试工作区，Git安装smoke测试已提交HEAD；提交前首次Git安装是0.6.0，提交87deb54后已重跑并确认1.0.0；四组CI再次验证提交aeb46d1的1.0.0。首次CI配置因job级env使用不可用runner上下文而无任务，已改为step初始化；之后矩阵全绿。仓库刚公开时一次匿名Git检查返回需要身份，随后HTTP与Smart Git均为200且匿名实际安装重试通过。

## 验证范围与使用限制

- 自动化和smoke采用非交互宿主、模型替身、合成历史和临时配置。
- 本次记录涵盖Windows本机自动化、Windows/Ubuntu CI及安装加载验证；Linux交互终端、SSH/tmux、macOS、其他扩展组合及交互式跨项目恢复属于独立的操作检查场景。
- 模型命名额外费用、手动标题优先、草稿拦截、跨进程并发与只支持会话目录恢复的限制不变。
- Git历史采用启发式敏感信息检查；标准作者Git身份和项目文档中的普通开发路径按常规元数据处理。发现凭据等敏感材料时，应暂停公开并确认清理方案；历史重写需另行授权。

## 发布流程与复核

1. 所有本地检查与四组CI通过。
2. 独立审查无未处理发布阻塞问题，Git历史不含发现的凭据或真实历史/截图。
3. 公开仓库，核查PUBLIC；创建带注释v1.0.0标签并推送。
4. 在隔离目录、禁用凭据回退的环境中验证固定标签真实安装和加载；验证匿名Git引用可读。
5. 创建GitHub正式Release，上传白名单tgz及SHA256校验文件。该tgz为源码归档，不是npm发布；推荐用户仍使用Pi Git安装。
6. 核对Release非草稿/非预发布、标签目标、远端主分支与工作树，记录复核结果。
