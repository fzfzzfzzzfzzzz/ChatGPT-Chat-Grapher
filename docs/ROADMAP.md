# Chat Graph — Roadmap

> 文档版本：2026-08 · 当前产品版本：v0.7.0

## 产品定位

Chat Graph 是运行在 ChatGPT 网页旁边的讨论结构导航器。它只维护：

- 问题图（Question Tree / Forest）
- Current Path 与当前焦点
- 分支导航与状态
- Node 到原始 ChatGPT 消息的定位

核心约束：

> ChatGPT stores conversation content; Chat Graph stores discussion structure.

> 除非后续 PRD 明确改变此决定，否则 Node 用户内容不得扩张到 question / summary / status 之外。

任何新增能力必须直接帮助用户找回主线、管理分支或定位原始聊天；否则不进入近期 Roadmap。产品不默认扩张为知识管理系统。

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
- Open Branches 展示附近 pending / parked sibling 与 child
- Graph View 高亮焦点和 Current Path，支持折叠子树
- Node 保存 Chat/message anchor，并可回到原 ChatGPT 消息
- Dexie / IndexedDB 本地持久化与旧 v0.4 数据迁移

明确不做：第二套聊天输入、完整聊天数据库、Answer → Node、Decision/Reason/Resource/Routes 数据库、复杂多类型边、多父 DAG、知识图谱、账号与云同步。

## 当前版本

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
- Parent 问题点击用于切换 discussion focus，并在浮窗内显示“已聚焦”反馈；不再保留容易误解的底部 Parent 动作栏
- ChatGPT SPA 路由切换后按 chatId 重载 Current / Parent，空 Chat 不残留上一段会话状态
- 支持浅色 / 深色、长文本截断、键盘焦点和减弱动画偏好
- Graph 与浮窗图谱首次单击设为 Current，再次单击确认定位原问题；右键只更新节点状态。跨会话时优先复用已有标签页，未打开时由用户选择打开方式
- 侧栏提供当前项目 Question Node 搜索，仅索引 question / summary 并复用跨会话定位流程

默认工作态明确不包含：Open Branches、Status、完整 Current Path、Full Graph、Inbox 或 Search。

第三层 Local Graph 本版本未实现；仍作为后续验证项，只有在能承担 Current 周围 1–2 层节点的高频导航且不复制详情页时才考虑保留。

### v0.7 — Graph Interaction

- 在常驻浮窗中加入紧凑图视角。
- 节点右键支持查看总结与详情、标记状态以及删除节点。
- 删除节点后安全重挂直接子节点。

## 后续优先级

### v0.7 候选

1. Parent Recommendation 准确率、候选召回与评测集
2. 只作为 Candidate 的 Branch Suggestion（用户采用后才建正式 Node）
3. 多 Chat / Project 聚合与导航可靠性
4. 轻量 Context Packet
5. v0.5 结构数据导入 / 导出

### 暂不优先

- 云同步与账号系统
- 知识图谱、Related Edge、多类型 Edge 或多父 DAG
- Decision / Reason / Resource / Routes 数据库
- 从 Assistant Answer 自动生成大量正式 Node
- 自动知识整理与完整对话备份
