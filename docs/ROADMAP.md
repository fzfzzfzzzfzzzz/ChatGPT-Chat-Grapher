# Chat Graph — Roadmap

> 文档版本：2026-08 · 当前产品版本：v1.0.0

## 产品定位

Chat Graph 是运行在 ChatGPT 网页旁边的讨论结构导航器。它只维护：

- 问题图（Question Tree / Forest）
- Current Path 与当前焦点
- 分支导航与状态
- Node 到原始 ChatGPT 消息的定位
- 用户主动生成的结构化对话总结及其本地版本

核心约束：

> ChatGPT stores conversation content; Chat Graph stores discussion structure and review artifacts.

> Question Node 的主要讨论内容保持为 question / summary / status；v0.13 允许附加受限的引用 metadata、缩略图与短摘录。v1.0 的 Review Document 是独立 artifact，只保存结构化结果、定位与最长 240 字的证据摘录，不持久化完整 user / assistant 原文。

任何新增能力必须直接帮助用户找回主线、管理分支、复盘对话或定位原始聊天；否则不进入近期 Roadmap。产品不默认扩张为通用知识管理系统。

## 历史版本

### v0.1 — Manual Discussion Map

完成本地 Project、父子分支、状态、侧栏、Graph 和 Chat 链接的早期验证。

### v0.2 — AI-assisted Discussion Management

验证百炼结构化输出与 Undo。旧的 Decision、OpenQuestion 文本抽取、Answer 分析和 Graph Operations 设计已被 v0.5 取代（Deprecated / Superseded by v0.5）。

### v0.3 — Cross-Chat Project Workflow

验证多 Chat、Inbox、搜索和 Context Packet。多 Chat / Project 聚合、搜索、Context Packet 可作为以后增强；Decision/OpenQuestion 知识库和复杂 BranchChat 关系不再属于核心模型（Partially superseded by v0.5）。

### v0.4 — Sync & Productization

云同步、账号和快照产品化方向已从当前实现移除并降级为远期评估项，不阻塞讨论导航核心（Deprecated / Superseded by v0.5）。

### v0.5 — Discussion Navigation Core

- 自动捕获每次 ChatGPT User Question，一次提交对应一个 Candidate
- Question Node 的用户内容严格为 `question / summary / status`
- AI 生成 1–2 句 summary，并推荐少量逻辑父节点
- 时间顺序不等于父子关系；支持 No Parent 与多 Root Forest
- 高置信度自动连接且可 Undo / Change Parent
- 中低置信度或 API 失败进入轻量 Branch Inbox
- Manual Parent Correction、Remove Parent、Set as Root 与循环保护
- 持久化 Current Focus；默认展示 Current Path
- Parent / Main Thread 只切换焦点，不改历史父子关系
- Open Branches 展示附近仍为“待讨论”的 sibling 与 child
- Graph View 高亮焦点和 Current Path，支持折叠子树
- Node 保存 Chat/message anchor，并可回到原 ChatGPT 消息
- Dexie / IndexedDB 本地持久化与旧 v0.4 数据迁移

明确不做：第二套聊天输入、完整聊天数据库、Answer → Node、Decision/Reason/Resource/Routes 数据库、复杂多类型边、多父 DAG、知识图谱、账号与云同步。

## 已发布版本主线

### v0.6 — Persistent Floating Navigation Panel

- ChatGPT 页面内常驻 Overlay Floating Panel，使用 Shadow DOM 隔离样式
- 收起态只展示 Project + 当前问题的直接 Parent；支持 Root、判断中与未判断状态
- 工作态固定展示 Parent → Current → Summary，并提供 `← Parent` 与 `Change Parent`
- Enter 捕获 Candidate 后立即刷新 Current，不等待 GPT Answer、Summary 或 Parent API
- Parent / Summary 异步更新；中置信度在浮窗内轻量确认，低置信度保留 Root，API 失败可人工修正
- 支持搜索候选、No Parent / Root、循环保护及人工修正持久化
- `↗` 打开完整 Graph 详情页；浮窗不复制项目级管理功能
- 支持 Header 拖动、viewport 边界约束，以及 mode / x / y 刷新恢复
- Header 项目名可直接切换或快速新建项目；`Change Parent` 与 Parent 信息就近放置
- Parent 问题点击用于展开摘要；“查看父节点”只切换浮窗详情，不修改 discussion focus
- ChatGPT SPA 路由切换后按 chatId 重载 Current / Parent，空 Chat 不残留上一段会话状态
- 支持浅色 / 深色、长文本截断、键盘焦点和减弱动画偏好
- Graph 与浮窗图谱首次单击设为 Current，再次单击确认定位当前页面中的原问题；右键只更新节点状态
- 侧栏提供当前项目 Question Node 搜索，仅索引 question / summary；跨页面定位留待后续版本

默认工作态明确不包含：Open Branches、Status、完整 Current Path、Full Graph、Inbox 或 Search。

第三层 Local Graph 本版本未实现；仍作为后续验证项，只有在能承担 Current 周围 1–2 层节点的高频导航且不复制详情页时才考虑保留。

### v0.7 — Graph Interaction

- 在常驻浮窗中加入紧凑图视角。
- 节点右键支持查看总结与详情、标记状态以及删除节点。
- 删除节点后安全重挂直接子节点。

### v0.8 — One-click Page Graph

- 一键将当前会话的用户问题按时间批量导入线性图。
- 项目级消息去重、Inbox 转节点、批量状态和焦点更新。
- 支持扫描 ChatGPT 虚拟化历史并定位未挂载的旧问题。

### v0.8.1 — Virtualized History Navigation

- 修复长会话只捕获最近问题的问题。
- 修复图视角删除后切回当前视角，以及当前视角底部留白丢失的问题。

### v0.9.0 — Multi-provider AI API

- 百炼、OpenAI、Gemini、DeepSeek、OpenRouter 与自定义服务统一使用 OpenAI Chat Completions 兼容层。
- Anthropic 使用原生 Messages API，所有厂商共享同一父节点推荐 schema 和错误处理。
- 每个厂商独立保存 Key 与模型，旧百炼配置自动迁移。
- 设置页支持精确域名授权、建议模型和完整推荐连接测试；失败时不自动切换厂商。
- 浮窗以 Current 为第一视觉层级，父节点压缩为单行上下文，常用与危险操作统一进入节点菜单。
- 浮窗“图视角”展示项目全部节点，支持按钮/滚轮缩放、拖动画布和适应全部节点；侧栏继续提供完整管理视图。
- 捕获暂停状态压缩为单行提示，当前交互操作统一使用中文文案。
- 浮窗数据操作统一经过后台命令层，并在成功响应中直接携带最新状态；候选问题也可定位原消息。

### v0.12.0 — Local JSON Backup

- 将全部项目、问题节点、待讨论候选和撤销事件导出为带 schema 版本的 JSON。
- 导入时校验文件与图关系，重映射内部 ID，并以新项目副本写入单个 IndexedDB 事务。
- 备份不包含 AI 设置或 API Key，重复导入不会覆盖现有项目。
- 增加 GitHub Bug Report 和 Feature Request Issue 表单。

### v0.13.0 — Reference-aware Nodes

- 捕获附件、图片和 Assistant 回答引用，并附着在对应问题节点上。
- 图节点显示引用计数，节点详情展示文件信息、受限缩略图和回答短摘录。
- 引用来源支持用户/Assistant 双角色定位与虚拟化历史扫描。
- 项目搜索扩展到附件名称与回答摘录。
- 备份 schema v2 保存并校验引用信息，同时兼容 schema v1。
- 不引入 Resource/Answer 独立节点、多类型边、附件正文或完整回答存储。

### v1.0.0 — Conversation Review

- 从页内浮窗、Side Panel 工具栏和图节点菜单使用同一套总结配置与结果界面。
- 支持当前逻辑分支、整个当前对话、当前节点及上下文三种范围；“分支”仅表示 Chat Graph 祖先路径，不建模 ChatGPT 原生编辑/重新生成分支。
- 提供 33 个模块与 5 个预设，按固定目录展示结构化条目、结论状态、推断标记、用户编辑标记和证据。
- 支持来源完整性预览；无法读取的来源必须显式列出，只有用户确认后才允许带缺失标记的部分生成。
- 完整来源原文仅在任务内存中存在并直发当前 AI Provider；本地保存总结、版本、任务 metadata、定位和最长 240 字证据摘录。
- 长对话先提取一次事实，再分批生成模块；可保留部分成功结果并针对失败范围或模块重试。
- 总结是独立紫色文档 artifact，不参与问题图的 Current、status 或父节点推荐；建议分支使用可升级的 `planned` Question Node。
- 支持编辑与撤销、复制、Markdown、上下文包、保存到图、历史版本、过期提示和本地反馈。
- Dexie schema v9 与 JSON 备份 schema v3 覆盖总结关系和版本，并保留 v1/v2 备份导入兼容。
- Chrome 116+、Firefox 115+ 为最低支持版本；Node.js 22 CI 执行完整检查与双浏览器构建。

## 后续优先级

### v1.x 候选

1. Parent Recommendation 准确率、候选召回与评测集
2. 总结质量评测、模块预设迭代与无原文泄露的诊断工具
3. 多 Chat / Project 聚合与导航可靠性
4. 对 planned 分支的采用率与去重体验优化

### 暂不优先

- 云同步与账号系统
- 知识图谱、Related Edge、多类型 Edge 或多父 DAG
- Decision / Reason / Resource / Routes 数据库
- 从 Assistant Answer 自动生成大量正式 Node
- 自动知识整理与完整对话备份
- ChatGPT 原生编辑/重新生成分支建模
- 联网事实核验、自动 PRD/代码生成或外部任务系统
