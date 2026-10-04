# Chat Graph

[English](README.md) | [隐私政策](PRIVACY.zh-CN.md) | [更新日志](CHANGELOG.md)

Chat Graph 是运行在 ChatGPT 网页上的 Chrome / Firefox 本地优先扩展。它不保存第二份完整聊天内容，而是捕获用户实际发送的问题，维护 Question Tree / Forest，并将长对话整理为可编辑、可追溯的结构化总结。

当前代码对应 **v1.0.0 - 对话总结**。

## 产品预览

<p align="center">
  <img src="release-assets/v0.12.0/icons/chat-graph-icon-128.png" width="96" alt="Chat Graph 图标">
</p>

### 对话总结（v1.0）

![Chat Graph v1.0 对话总结结果、证据抽屉、计划节点与图总结 artifact](release-assets/v1.0.0/conversation-review.png)

### ChatGPT 页面内浮窗

![Chat Graph 在 ChatGPT 页面内的浮窗图视角](release-assets/v0.12.0/screenshots/04-floating-panel-in-chatgpt.png)

### Current / Parent 与问题图谱

| Current / Parent 工作区 | Question Graph |
| --- | --- |
| ![Current 与 Parent 工作区](release-assets/v0.12.0/screenshots/01-current-parent.png) | ![问题图谱](release-assets/v0.12.0/screenshots/02-question-graph.png) |

### 本地 JSON 数据备份

![本地 JSON 数据备份设置](release-assets/v0.12.0/screenshots/03-local-backup-settings.png)

## 当前能力

- 监听 ChatGPT 用户提交；一次提交只创建一个 Question Candidate
- Enter 后浮窗立即显示新的 Current，父节点与摘要在后台异步更新
- 页面内常驻浮窗以 Current 主卡片为核心，父节点缩为单行辅助上下文；节点更新时提供轻量反馈
- Current 与父节点的摘要、原消息、更换父节点和忽略/删除等操作统一收进 `···` 菜单；成功后由后台直接返回最新浮窗状态
- 支持 Header 拖动、位置/模式记忆、浅色/深色与 ChatGPT SPA 会话切换
- 浮窗支持“当前”和“图视角”切换；图视角展示项目全部节点，支持按钮/滚轮缩放、拖动画布、适应全部节点和在侧栏打开
- 浮窗可进入页面点选模式，滚动并选择任意一条用户问题单独补录，无需导入整个会话
- 点选补录会临时读取紧随问题之后的 Assistant 回答，用于摘要和父节点推荐，但不保存回答正文
- 自动识别问题引用的附件、图片和 Assistant 回答；图节点显示引用计数，详情展示文件信息、受限缩略图与回答短摘录
- 引用可定位当前页面中的用户或 Assistant 原消息；项目搜索支持文件名、图片说明和回答摘录
- 一键读取当前 ChatGPT 会话的全部用户问题，按顺序建立独立的线性问题图
- 浮窗图和完整图的节点右键菜单支持查看详情、标记状态和删除节点
- 新节点统一默认为“待讨论”；新增子节点、修改父节点或批量建图不会自动完结节点，状态仅由用户手动修改
- Node 主要内容保持为 `question / summary / status`，可附带受限引用 metadata、缩略图与短摘录
- 支持百炼、OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter 和自定义 OpenAI 兼容服务生成简短 summary、推荐逻辑父节点
- 每个 AI 厂商独立保存 API Key 与模型；Anthropic 使用原生 Messages API，其余服务走 OpenAI Chat Completions 兼容协议
- 高置信度自动连接；中低置信度或 API 失败进入待讨论列表
- 支持无父节点、多根节点、更换/移除父节点、设为根节点和循环保护
- 自动连接支持 Undo
- 默认展示 Current Path、当前焦点与 Open Branches
- 浮窗“查看父节点”只切换到父节点详情，不修改项目焦点；侧栏的返回主线操作仍只改变焦点，不破坏父子关系
- Question Forest Graph，高亮 Current Path，双击可折叠子树
- 当前会话打开在本页时，Node 可滚动并高亮对应的原始用户消息
- Graph 节点首次单击设为 Current，再次单击可确认定位当前页面中的原问题；右键可查看详情、标记状态或删除。侧栏搜索可检索 question、summary 与引用信息
- 对 ChatGPT 虚拟化历史进行滚动扫描，可捕获和定位当前未挂载在 DOM 中的旧问题
- Dexie + IndexedDB 本地持久化；刷新和重启后恢复 Graph、status 与 focus
- 支持将全部项目图导出为带版本信息的 JSON，并以不覆盖现有数据的项目副本方式导入
- 旧 v0.4 Branch 数据在首次打开时迁移为 v0.5 Question Node
- 从 ChatGPT 页内浮窗、Side Panel 项目工具栏，以及完整图/浮窗图的节点菜单统一发起对话总结
- 支持“当前分支”“整个当前对话”“当前节点及上下文”三种范围；范围预览会显示消息数、节点数、估算长度、处理策略和缺失来源
- 提供 33 个总结模块与 5 个预设；结果支持模块折叠、结论状态、证据定位、编辑与撤销、单模块复制/重试、完整复制、Markdown、上下文包和保存到图
- 总结保存为紫色文档 artifact 和虚线关系边，不参与 Current、问题状态、父节点推荐或原问题定位
- 总结建议的新分支先创建 `planned` 问题节点；只有用户实际发送相同的规范化问题后才绑定真实消息并升级为已捕获节点
- 关闭总结界面后活动任务继续；浏览器或 MV3 Worker 中断时将任务标记为“已中断”，重新采集来源后才能重试

Chat Graph 只持久化结构化总结、消息定位信息和最长 240 字的证据摘录。生成期间读取的 user / assistant 原文仅存在于任务内存，并在完成、取消或失败后释放。当前明确没有联网事实核验、Answer 自动拆 Node、附件全文索引、自动 PRD/代码生成、外部任务系统、Supabase、账号或云同步。

## 安装发布版本

### Chrome

1. 从 [最新 Release](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest) 下载 `chatgpt-discussion-map-1.0.0-chrome.zip`
2. 将 ZIP 解压到一个准备长期保留的目录
3. 打开 `chrome://extensions/`，启用“开发者模式”
4. 点击“加载已解压的扩展程序”，选择刚才解压的目录
5. 打开 [ChatGPT](https://chatgpt.com/)；若页面早已打开，可直接从侧栏点击“打开页面浮窗”，无需刷新

手动加载的 Chrome 扩展不会自动更新。后续版本需要替换解压目录中的文件，在扩展管理页点击“重新加载”，然后刷新 ChatGPT 页面。

### Firefox 测试安装

解压 Firefox ZIP 后，在 `about:debugging#/runtime/this-firefox` 点击“临时载入附加组件”，选择其中的 `manifest.json`。Firefox 临时扩展在浏览器重启后需要重新载入；永久安装需要 Mozilla Add-ons 签名。

## 环境要求

- Node.js 22.22.2+
- npm 10+
- Chrome 116+ 或 Firefox 115+

## 本地开发

```bash
npm install
npm run dev:chrome
# 或
npm run dev:firefox
```

打开 ChatGPT 后，页面右上区域显示 Chat Graph 工作态浮窗；Chrome 可从浮窗按钮直接打开 Side Panel，Firefox 使用工具栏 Chat Graph 图标或 `Alt+Shift+G` 打开 Sidebar。侧栏顶部可重新打开已关闭或收起的页面浮窗。未配置 AI 时，新问题仍会立即显示为 Current，并进入待讨论列表等待人工选择父节点或设为根节点。

首次打开总结默认使用“当前分支 + 通用复盘”。浮窗与侧栏会恢复上次的范围和模块，节点菜单优先使用“当前节点及上下文”。当来源缺失时，默认不能生成完整总结；只有用户明确确认后，才能生成带醒目缺失标记的部分结果。v1.0 中的“分支”仅指 Chat Graph 的逻辑祖先路径，不表示 ChatGPT 编辑或重新生成产生的原生替代分支。

常用命令：

```bash
npm run compile        # TypeScript 严格检查
npm run test           # 自动化测试
npm run test:provider  # 使用 .env 对当前 AI 厂商执行一次真实结构化推荐测试
npm run build          # Chrome + Firefox 生产构建
npm run zip            # 生成两个浏览器发布包
npm run check          # compile + test + 双浏览器 build
```

## 手动安装生产构建

运行 `npm run build` 后：

- Chrome：在 `chrome://extensions/` 开启开发者模式，加载 `.output/chrome-mv3/`
- Firefox：在 `about:debugging#/runtime/this-firefox` 临时载入 `.output/firefox-mv3/manifest.json`

## 数据与隐私

- Project、Question Node、Candidate、Parent relation、status、current focus、消息定位、轻量引用信息，以及总结文档、版本、编辑记录、任务 metadata、本地反馈和最长 240 字的证据摘录保存在扩展 IndexedDB
- 不保存附件正文、原始图片或完整 Assistant Answer；图片只保存受限缩略图，回答只保存被引用的短摘录
- 父节点推荐仅发送新 question、fallback summary、Current Path 和最多 30 个候选 Node 的 `id/question/summary/status`；对话总结会在用户主动生成时，将所选范围内的 user / assistant 原文直接发送给当前 AI 厂商，长对话会分段处理
- 总结来源原文只保留在生成任务内存，完成、取消或失败后立即释放；任务表只持久化状态、进度、错误与范围 metadata
- API Key 仅保存在扩展 `storage.local`，不写入日志或 IndexedDB
- JSON 备份 schema v3 包含问题图、总结 artifact、不可变版本、消息定位、引用 metadata、缩略图与短证据摘录，不包含完整总结来源、AI 设置或 API Key；导入会创建新的项目副本并重映射内部 ID
- 非百炼厂商仅在用户保存启用设置或测试连接时申请对应 HTTPS 域名权限；失败时不会自动切换到其他厂商
- 不存在云同步、分析统计和账号系统

“AI 父节点推荐”开关只控制自动推荐。即使关闭该开关，用户仍可主动生成总结；生成前会校验当前厂商、模型、Key 和域名权限。

删除扩展或清除扩展数据会删除本地 Graph。启用 AI 前请阅读完整的[隐私政策](PRIVACY.zh-CN.md)。

## 目录

```text
entrypoints/   background、ChatGPT content script、side panel
adapters/      Chat URL、提交捕获、message identity 与原消息定位
ai/            Parent Recommendation prompt、schema parser、多厂商协议客户端与 provider registry
graph/         Question service、Current Path/Open Branches、Graph 布局
review/        总结模块目录、范围规划、解析、长对话策略与导出
db/            IndexedDB schema、旧数据 migration 与 repositories
components/    Current / Parent、待讨论、Graph、Node Detail UI
settings/      本地 AI 配置
tests/         领域、解析、URL、交互与 Graph 回归测试
docs/          Roadmap、浏览器说明、版本 PRD 与 Release Notes
```

## 文档

- [Roadmap](docs/ROADMAP.md)
- [Browser Support](docs/BROWSER_SUPPORT.md)
- [Changelog](CHANGELOG.md)
- [Privacy Policy](PRIVACY.zh-CN.md)

## 参与贡献

欢迎通过 [GitHub Issues](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/issues) 提交 Bug 或聚焦的功能建议。请说明浏览器版本、扩展版本、复现步骤和相关控制台错误，并移除私人对话内容。

## License

[MIT](LICENSE)
