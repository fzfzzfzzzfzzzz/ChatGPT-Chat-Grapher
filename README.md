# Chat Graph

Chat Graph 是运行在 ChatGPT 网页上的 Chrome / Firefox 扩展。它不保存第二份聊天内容，而是自动捕获用户实际发送的问题，维护 Question Tree / Forest，并帮助用户随时看见当前路径、未完成分支和原始消息位置。

当前代码对应 **v0.8.1 — Virtualized History Navigation**。

## 当前能力

- 监听 ChatGPT 用户提交；一次提交只创建一个 Question Candidate
- Enter 后浮窗立即显示新的 Current，Parent 与 Summary 在后台异步更新
- 页面内常驻 V0.6 浮窗，工作态默认只显示 Parent / Current 问题，两者的 Summary 可分别展开或收起
- 浮窗支持 Parent 导航、候选确认、搜索并人工 Change Parent、Root / No Parent
- 支持 Header 拖动、位置/模式记忆、浅色/深色与 ChatGPT SPA 会话切换
- 浮窗支持“当前”和“图视角”切换，一键建图按钮在两个视角中常驻
- 一键读取当前 ChatGPT 会话的全部用户问题，按顺序建立独立的线性问题图
- 浮窗图和完整图的节点右键菜单支持查看详情、标记状态和删除节点
- Node 用户内容严格为 `question / summary / status`
- 百炼生成简短 summary，并根据逻辑关系推荐父节点
- 高置信度自动连接；中低置信度或 API 失败进入 Inbox
- 支持 No Parent、多 Root、Change/Remove Parent、Set as Root 和循环保护
- 自动连接支持 Undo
- 默认展示 Current Path、当前焦点与 Open Branches
- Parent / Main Thread 只切换焦点，不破坏父子关系或既有状态
- Question Forest Graph，高亮 Current Path，双击可折叠子树
- Node 可跳回对应 Chat，并尽量滚动/高亮原始用户消息
- 跨会话跳转会优先复用已打开的 ChatGPT 标签页；未打开时由用户选择新标签页或当前页
- Graph 节点首次单击设为 Current，再次单击可确认定位原问题；右键可查看详情、标记状态或删除。侧栏搜索可检索当前项目内的 question / summary 并跨会话定位
- 对 ChatGPT 虚拟化历史进行滚动扫描，可捕获和定位当前未挂载在 DOM 中的旧问题
- Dexie + IndexedDB 本地持久化；刷新和重启后恢复 Graph、status 与 focus
- 旧 v0.4 Branch 数据在首次打开时迁移为 v0.5 Question Node

当前明确没有 Decision/Reason/Resource/Routes 知识库、Answer 自动拆 Node、Assistant Answer 全文搜索、Context Packet、Supabase、账号或云同步。

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

打开 ChatGPT 后，页面右上区域显示收起态 Chat Graph 导航条；点击后展开工作态浮窗，`↗` 打开完整 Graph 侧栏。未配置 AI 时，新问题仍会立即显示为 Current，并进入 Inbox 等待人工选择 Parent 或设为 Root。

常用命令：

```bash
npm run compile   # TypeScript 严格检查
npm run test      # 领域、Parent 输出解析与图布局测试
npm run build     # Chrome + Firefox 生产构建
npm run zip       # 生成两个浏览器发布包
npm run check     # compile + test + 双浏览器 build
```

## 手动安装生产构建

运行 `npm run build` 后：

- Chrome：在 `chrome://extensions/` 开启开发者模式，加载 `.output/chrome-mv3/`
- Firefox：在 `about:debugging#/runtime/this-firefox` 临时载入 `.output/firefox-mv3/manifest.json`

Firefox 临时扩展在浏览器重启后需要重新载入；永久安装需要 Mozilla Add-ons 签名。

## 数据与隐私

- Project、Question Node、Candidate、Parent relation、status、current focus 与消息定位 metadata 保存在扩展 IndexedDB
- 不保存 Assistant Answer，不建立自己的完整聊天数据库
- AI 仅接收新 question、fallback summary、Current Path 和最多 30 个候选 Node 的 `id/question/summary/status`
- API Key 仅保存在扩展 `storage.local`，不写入日志或 IndexedDB
- 不存在云同步和账号系统

删除扩展或清除扩展数据会删除本地 Graph。

## 目录

```text
entrypoints/   background、ChatGPT content script、side panel
adapters/      Chat URL、提交捕获、message identity 与原消息定位
ai/            Parent Recommendation prompt、schema parser、百炼客户端
graph/         Question service、Current Path/Open Branches、Graph 布局
db/            v0.5–v0.7 schema、旧数据 migration 与 repositories
components/    Current Path、Inbox、Graph、Node Detail UI
settings/      本地 AI 配置
tests/         领域、解析、URL 与 100 Node Graph 回归测试
docs/          Roadmap 与版本 PRD / Checklist
```

## 文档

- [v0.5 PRD](docs/v0.5/chat_graph_v0.5_PRD.md)
- [v0.5 Checklist](docs/v0.5/chat_graph_v0.5_CHECKLIST.md)
- [v0.6 PRD](docs/v0.6/chat_graph_v0.6_PRD_REVISED.md)
- [v0.6 Checklist](docs/v0.6/chat_graph_v0.6_CHECKLIST_REVISED.md)
- [Roadmap](docs/ROADMAP.md)
- [Browser Support](docs/BROWSER_SUPPORT.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
