# Chat Graph

[English](README.md) | [隐私政策](PRIVACY.zh-CN.md) | [更新日志](CHANGELOG.md)

Chat Graph 是运行在 ChatGPT 网页上的 Chrome / Firefox 扩展。它不保存第二份聊天内容，而是自动捕获用户实际发送的问题，维护 Question Tree / Forest，并帮助用户随时看见当前路径、未完成分支和原始消息位置。

当前代码对应 **v0.12.0 - 本地 JSON 数据备份**。

## 浮窗效果

![Chat Graph 在 ChatGPT 页面内的浮窗图视角](release-assets/v0.12.0/screenshots/04-floating-panel-in-chatgpt.png)

## 当前能力

- 监听 ChatGPT 用户提交；一次提交只创建一个 Question Candidate
- Enter 后浮窗立即显示新的 Current，父节点与摘要在后台异步更新
- 页面内常驻浮窗以 Current 主卡片为核心，父节点缩为单行辅助上下文；节点更新时提供轻量反馈
- Current 与父节点的摘要、原消息、更换父节点和忽略/删除等操作统一收进 `···` 菜单；成功后由后台直接返回最新浮窗状态
- 支持 Header 拖动、位置/模式记忆、浅色/深色与 ChatGPT SPA 会话切换
- 浮窗支持“当前”和“图视角”切换；图视角展示项目全部节点，支持按钮/滚轮缩放、拖动画布、适应全部节点和在侧栏打开
- 浮窗可进入页面点选模式，滚动并选择任意一条用户问题单独补录，无需导入整个会话
- 点选补录会临时读取紧随问题之后的 Assistant 回答，用于摘要和父节点推荐，但不保存回答正文
- 一键读取当前 ChatGPT 会话的全部用户问题，按顺序建立独立的线性问题图
- 浮窗图和完整图的节点右键菜单支持查看详情、标记状态和删除节点
- 新节点统一默认为“待讨论”；新增子节点、修改父节点或批量建图不会自动完结节点，状态仅由用户手动修改
- Node 用户内容严格为 `question / summary / status`
- 支持百炼、OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter 和自定义 OpenAI 兼容服务生成简短 summary、推荐逻辑父节点
- 每个 AI 厂商独立保存 API Key 与模型；Anthropic 使用原生 Messages API，其余服务走 OpenAI Chat Completions 兼容协议
- 高置信度自动连接；中低置信度或 API 失败进入待讨论列表
- 支持无父节点、多根节点、更换/移除父节点、设为根节点和循环保护
- 自动连接支持 Undo
- 默认展示 Current Path、当前焦点与 Open Branches
- 浮窗“查看父节点”只切换到父节点详情，不修改项目焦点；侧栏的返回主线操作仍只改变焦点，不破坏父子关系
- Question Forest Graph，高亮 Current Path，双击可折叠子树
- 当前会话打开在本页时，Node 可滚动并高亮对应的原始用户消息
- Graph 节点首次单击设为 Current，再次单击可确认定位当前页面中的原问题；右键可查看详情、标记状态或删除。侧栏搜索可检索当前项目内的 question / summary
- 对 ChatGPT 虚拟化历史进行滚动扫描，可捕获和定位当前未挂载在 DOM 中的旧问题
- Dexie + IndexedDB 本地持久化；刷新和重启后恢复 Graph、status 与 focus
- 支持将全部项目图导出为带版本信息的 JSON，并以不覆盖现有数据的项目副本方式导入
- 旧 v0.4 Branch 数据在首次打开时迁移为 v0.5 Question Node

当前明确没有 Decision/Reason/Resource/Routes 知识库、Answer 自动拆 Node、Assistant Answer 全文搜索、Context Packet、Supabase、账号或云同步。

## 安装发布版本

### Chrome

1. 从 [最新 Release](https://github.com/fzfzzfzzzfzzzz/ChatGPT-Chat-Grapher/releases/latest) 下载 `chatgpt-discussion-map-0.12.0-chrome.zip`
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

- Project、Question Node、Candidate、Parent relation、status、current focus 与消息定位 metadata 保存在扩展 IndexedDB
- 不保存 Assistant Answer，不建立自己的完整聊天数据库
- AI 仅接收新 question、fallback summary、Current Path 和最多 30 个候选 Node 的 `id/question/summary/status`；页面点选补录时会额外发送截断后的对应 Assistant 回答作为单次分析上下文
- API Key 仅保存在扩展 `storage.local`，不写入日志或 IndexedDB
- JSON 备份包含问题图与消息定位信息，不包含 AI 设置或 API Key；导入会创建新的项目副本
- 非百炼厂商仅在用户保存启用设置或测试连接时申请对应 HTTPS 域名权限；失败时不会自动切换到其他厂商
- 不存在云同步、分析统计和账号系统

删除扩展或清除扩展数据会删除本地 Graph。启用 AI 前请阅读完整的[隐私政策](PRIVACY.zh-CN.md)。

## 目录

```text
entrypoints/   background、ChatGPT content script、side panel
adapters/      Chat URL、提交捕获、message identity 与原消息定位
ai/            Parent Recommendation prompt、schema parser、多厂商协议客户端与 provider registry
graph/         Question service、Current Path/Open Branches、Graph 布局
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
