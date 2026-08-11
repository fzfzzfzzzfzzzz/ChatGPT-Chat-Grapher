# Chat Graph v0.5 Implementation Checklist

> 本 Checklist 与 `chat_graph_v0.5_PRD.md` 配套使用。  
> Agent 必须先阅读 PRD，再按本清单实施。  
> v0.5 完成条件不仅是代码实现，还包括 **更新现有 Roadmap**。

---

# A. 开始前

- [ ] 阅读现有项目目录
- [ ] 阅读现有 Roadmap
- [ ] 阅读 v0.1–v0.4 PRD / Checklist
- [ ] 阅读 `chat_graph_v0.5_PRD.md`
- [ ] 找出现有实现中与 v0.5 方向冲突的部分
- [ ] 不删除仍有价值的已有功能，先判断是否需要兼容 / 降级 / 标记 deprecated
- [ ] 在动手前确认本版本定位：**Question Graph，而不是 Knowledge Graph**

---

# B. Scope Lock

Agent 必须确保 v0.5 不继续扩张。

## Node 用户内容只保留

- [ ] `question`
- [ ] `summary`
- [ ] `status`

## 允许的系统 metadata

- [ ] `id`
- [ ] `parentId`
- [ ] `projectId`（如项目已有）
- [ ] `chatId`
- [ ] `messageId/messageAnchor`
- [ ] `createdAt`
- [ ] `updatedAt`

## 禁止重新加入 Node 的业务字段

- [ ] 不加入 `reason`
- [ ] 不加入 `resource`
- [ ] 不加入 `decision`
- [ ] 不加入 `routes`
- [ ] 不加入 `alternatives`
- [ ] 不加入 `evidence`
- [ ] 不加入 `answer`
- [ ] 不加入复杂 `openQuestions`
- [ ] 不复制完整 GPT Answer

---

# C. ChatGPT 页面消息捕获

- [ ] 找到现有 ChatGPT DOM 监听实现
- [ ] 如果已有 MutationObserver，复用并加固
- [ ] 能区分 User Message / Assistant Message
- [ ] 用户发送新消息后只触发一次
- [ ] 页面重新渲染不会重复创建 Node
- [ ] 刷新页面后不会把已有历史重复导入
- [ ] 对 ChatGPT DOM class 变化尽量减少硬编码依赖
- [ ] 设计稳定的 message identity / dedup key
- [ ] 记录来源 `chatId`
- [ ] 尽量记录 `messageId` 或可靠 anchor

---

# D. Question Candidate

- [ ] 每次用户提交产生一个 Question Candidate
- [ ] 默认不把一条消息自动拆成多个正式 Node
- [ ] 清理明显 UI 文本 / 非问题噪音
- [ ] 保留原始 question 文本
- [ ] Candidate 在 AI 分析失败时也不能丢失
- [ ] API 失败时允许降级为 Root / Inbox

---

# E. Summary

- [ ] 新 Node 自动生成简短 summary
- [ ] summary 控制在 1–2 句
- [ ] summary 描述问题本身
- [ ] summary 不总结完整 GPT Answer
- [ ] summary 不写 reason/resource/decision/routes
- [ ] API 失败时可以使用 question 截断/规则摘要作为 fallback
- [ ] summary 后续可更新，但不得破坏用户 question

---

# F. Parent Recommendation

- [ ] 新问题创建时触发 Parent Recommendation
- [ ] 输入至少包含 new question
- [ ] 输入包含 new summary
- [ ] 输入包含 Current Path
- [ ] 输入包含合理数量的候选已有 Nodes
- [ ] 候选 Node 只需要 question + summary + id
- [ ] 不无脑把“上一条问题”作为 Parent
- [ ] Prompt 明确时间顺序 != 父子关系
- [ ] Prompt 明确“这个问题是在进一步解决哪个问题”
- [ ] Prompt 明确允许 No Parent
- [ ] Prompt 明确宁可 No Parent 也不要错连
- [ ] API 输出使用结构化 JSON
- [ ] 解析失败有 fallback
- [ ] 最多返回少量候选，避免 UI 过载

---

# G. Confidence 行为

建议阈值允许配置。

## High confidence

- [ ] 可自动连接
- [ ] 显示轻量 `Linked to ...`
- [ ] 提供 Undo
- [ ] 提供 Change Parent

## Medium confidence

- [ ] 显示 2–3 个候选
- [ ] 用户可以选择 Parent
- [ ] 用户可以选择 No Parent

## Low confidence

- [ ] 不强行连接
- [ ] 进入 Inbox 或 Root
- [ ] 后续可人工整理

---

# H. No Parent / Root

- [ ] `parentId = null` 被视为合法状态
- [ ] 无关问题不会强行挂到当前分支
- [ ] Root Nodes 可以同时存在
- [ ] Graph View 能展示 Forest
- [ ] Root Node 后续可重新挂 Parent
- [ ] 已有 Parent 可以被 Remove

---

# I. Manual Parent Correction

- [ ] Change Parent
- [ ] Remove Parent
- [ ] Set as Root
- [ ] Move to another Parent
- [ ] Undo 最近一次自动连接
- [ ] 修改 Parent 后 Current Path 正确更新
- [ ] 修改 Parent 后 Graph 正确更新
- [ ] 防止产生循环引用
- [ ] Node 不能成为自己的祖先

---

# J. Status

实现：

- [ ] `active`
- [ ] `pending`
- [ ] `resolved`
- [ ] `parked`
- [ ] `rejected`

行为：

- [ ] 新问题默认 active
- [ ] 之前 active Node 可以转 pending
- [ ] 用户可以手动改状态
- [ ] 不要求 AI 自动判定 resolved
- [ ] rejected 不要求保存失败原因
- [ ] 状态改变后 Open Branches 同步更新

---

# K. Current Path

- [ ] 浮窗默认展示 Current Path
- [ ] 路径通过 parent chain 计算
- [ ] 当前 Active Node 明确高亮
- [ ] 可以点击祖先 Node
- [ ] 路径过长时有合理折叠
- [ ] Parent 修改后路径实时更新
- [ ] Root Node 的 Current Path 正确处理

---

# L. Parent / Main Thread

- [ ] 提供 `← Parent`
- [ ] 提供 `↑ Main Thread`
- [ ] Parent 点击后切换当前 focus
- [ ] Main Thread 点击后切换当前 focus
- [ ] focus 改变不修改历史 Node parent
- [ ] 下一条问题推荐 Parent 时考虑当前 focus
- [ ] 用户可清楚看到当前 focus 是哪个 Node

---

# M. Open Branches

v0.5 至少实现基础版本。

- [ ] 能显示当前路径附近尚未继续的 sibling / child
- [ ] pending Node 优先进入 Open Branches
- [ ] parked Node 可单独显示或弱化显示
- [ ] resolved 不进入默认 Open Branches
- [ ] rejected 不进入默认 Open Branches
- [ ] 点击 Open Branch 可以切换 focus
- [ ] 不需要复制当时的完整 GPT Answer
- [ ] 不需要保存路线原因

如实现 Assistant Answer branch suggestion：

- [ ] 只能作为 Candidate / Suggestion
- [ ] 不能自动变成正式 Node
- [ ] 用户点击/采用后才能转为正式讨论目标
- [ ] 不应导致 Graph 自动膨胀

---

# N. Branch Inbox

- [ ] Low confidence 问题可进入 Inbox
- [ ] Inbox 不影响主图结构
- [ ] 可以 Attach to Parent
- [ ] 可以 Set as Root
- [ ] 可以 Ignore / Delete
- [ ] Inbox 数量在浮窗有轻量提示
- [ ] Inbox 不扩展成复杂任务系统

---

# O. Graph View

- [ ] 支持 Tree / Forest
- [ ] Node 显示简短 question
- [ ] 当前 Node 高亮
- [ ] Current Path 高亮
- [ ] status 有轻量视觉区别
- [ ] 支持折叠/展开子树
- [ ] 点击 Node 可选择 / 定位
- [ ] Node Detail 只展示 question / summary / status
- [ ] 不展示 reason/resource/decision/routes
- [ ] 不做 Related Edge
- [ ] 不做多父节点 DAG
- [ ] 不做蜘蛛网式 Knowledge Graph

---

# P. Node → Original Chat

- [ ] Node 保存 `chatId`
- [ ] 尽可能保存 message identifier / anchor
- [ ] 当前 Chat 中点击 Node 可滚动到原用户消息
- [ ] 能高亮原消息更好
- [ ] 不同 Chat 时能跳到对应 Chat
- [ ] 无法精确定位 message 时至少跳到正确 Chat
- [ ] 对定位失败有明确 fallback
- [ ] Graph 不复制聊天正文作为替代方案

---

# Q. 浮窗 UI

默认折叠：

- [ ] 只有小型 Graph 按钮 / icon
- [ ] 不影响 ChatGPT 主界面

展开后优先级：

1. [ ] Current Path
2. [ ] Open Branches
3. [ ] Parent / Main Thread
4. [ ] Inbox 状态
5. [ ] Open Graph

交互：

- [ ] 不每次发问都强制大弹窗
- [ ] High confidence 自动连接只轻提示
- [ ] Medium confidence 才要求快速选择
- [ ] Low confidence 默认无侵入处理
- [ ] 操作尽量 1–2 次点击完成

---

# R. Persistence

- [ ] 复用现有稳定本地存储方案，或使用 IndexedDB
- [ ] 刷新 ChatGPT 页面后 Graph 不丢失
- [ ] 浏览器重新打开后 Graph 可恢复
- [ ] parent relation 可恢复
- [ ] status 可恢复
- [ ] current focus 可恢复
- [ ] chat mapping 可恢复
- [ ] 用户手动修正结果可恢复
- [ ] schema 有版本字段
- [ ] 为旧数据 migration 留入口

---

# S. API / AI

- [ ] 复用当前已选云端模型/API
- [ ] 不新增本地 AI 分支
- [ ] Parent Recommendation 使用结构化 JSON 输出
- [ ] Summary 使用结构化输出或稳定 parser
- [ ] 设置 timeout
- [ ] 设置 retry 上限
- [ ] API 失败不阻止用户继续聊天
- [ ] API 失败不丢 Candidate
- [ ] 不把完整历史对话无限发送给 API
- [ ] token 输入规模可控
- [ ] 日志不要记录敏感完整聊天正文，除非当前项目已有明确调试模式

---

# T. Answer Analysis 边界

- [ ] Assistant Message 可以被观察
- [ ] 但不创建普通正式 Node
- [ ] 不把 Answer 保存成 Node 内容
- [ ] 可用于辅助更新 summary
- [ ] 可选用于 Branch Suggestion
- [ ] 禁止自动提取并永久保存 reason/resource/decision/routes

---

# U. 数据模型检查

最终 GraphNode 类似：

```ts
type NodeStatus =
  | "active"
  | "pending"
  | "resolved"
  | "parked"
  | "rejected"

type GraphNode = {
  id: string
  question: string
  summary: string
  status: NodeStatus

  parentId: string | null

  projectId?: string
  chatId: string
  messageId?: string
  messageAnchor?: string

  createdAt: number
  updatedAt: number
}
```

检查：

- [ ] 不存在无必要业务字段
- [ ] relation 数据没有和文本内容混在一起
- [ ] parentId 可空
- [ ] schema 可扩展但当前保持最小化

---

# V. 测试案例

至少覆盖以下案例。

## Case 1：连续追问

```text
A: 浏览器插件如何读取 ChatGPT？
B: MutationObserver 是什么？
```

- [ ] B 推荐 A 为 Parent

---

## Case 2：切 sibling branch

```text
A: 怎么做 Chat Graph？
B: 浏览器插件如何读取消息？
C: MutationObserver 是什么？
D: Node 应该保存哪些字段？
```

期望：

```text
A
├── B
│   └── C
└── D
```

- [ ] D 不连接到 C

---

## Case 3：完全无关问题

当前 Graph：

```text
Chat Graph
└── Parent Recommendation
```

新问题：

```text
IBKR 港股手续费是多少？
```

- [ ] No Parent / Inbox
- [ ] 不挂到 Parent Recommendation

---

## Case 4：人工修正

- [ ] AI 错连后用户 Change Parent
- [ ] 修改持久化
- [ ] Current Path 更新
- [ ] 下次刷新仍保持修正

---

## Case 5：返回主线

深层：

```text
A → B → C → D → E
```

- [ ] 点击 Main Thread 后 focus 返回 A/B 指定主线
- [ ] 历史 parent 不改变
- [ ] 下一问题优先基于新 focus 推荐

---

## Case 6：Open Branches

```text
A
├── B [active]
├── C [pending]
└── D [pending]
```

- [ ] C/D 显示为 Open Branches

---

## Case 7：刷新

- [ ] 刷新 ChatGPT
- [ ] Node 不重复
- [ ] Graph 恢复
- [ ] focus 恢复
- [ ] status 恢复

---

## Case 8：跨 Chat

如果 v0.5 已支持：

- [ ] Node 记录正确 chatId
- [ ] 点击可回到正确 Chat

如果暂未完整支持：

- [ ] 数据结构预留
- [ ] 当前 Chat 内行为稳定
- [ ] Roadmap 明确后续实现

---

# W. 不做清单

Agent 完成前逐项检查：

- [ ] 没有实现第二个聊天输入框
- [ ] 没有实现自己的完整聊天数据库
- [ ] 没有把每条 Assistant Answer 建 Node
- [ ] 没有把每个 GPT 提议自动建 Node
- [ ] 没有复杂 Related Edge
- [ ] 没有多父节点 DAG
- [ ] 没有 reason 数据库
- [ ] 没有 resource 数据库
- [ ] 没有 decision 数据库
- [ ] 没有 routes 数据库
- [ ] 没有为了 v0.5 引入账号系统
- [ ] 没有为了 v0.5 引入 Supabase 云同步
- [ ] 没有把产品改成 Knowledge Graph

---

# X. Roadmap 更新（必须完成）

Agent 必须修改项目现有 Roadmap。

## 必须新增

```text
v0.5 — Discussion Navigation Core
```

包含：

- [ ] Question capture
- [ ] Question Node
- [ ] question / summary / status
- [ ] Parent Recommendation
- [ ] No Parent
- [ ] Manual correction
- [ ] Current Path
- [ ] Open Branches
- [ ] Main Thread
- [ ] Inbox
- [ ] Graph View
- [ ] Node → Original Chat
- [ ] Local persistence

## 必须调整旧规划

- [ ] Reason/Resource/Decision/Routes 从核心 Node 设计删除
- [ ] Knowledge Graph 方向标记为非当前目标
- [ ] 多类型边降级到远期或取消
- [ ] 自动 Answer → Node 降级/取消
- [ ] 云同步放到后续，不阻塞 v0.5
- [ ] 多 Chat / Project 保留为后续增强
- [ ] Search / Context Packet 保留为后续增强

## 必须给后续 Agent 留一句约束

Roadmap 中加入类似：

```text
Product constraint:
ChatGPT stores conversation content; Chat Graph stores discussion structure.
Do not expand node content beyond question / summary / status
unless a later PRD explicitly changes this decision.
```

---

# Y. v0.5 Definition of Done

以下全部通过，才能标记 v0.5 完成：

- [ ] 新 User Message 可以稳定捕获
- [ ] Question Node 正确创建
- [ ] Node 业务字段严格保持最小化
- [ ] AI Parent Recommendation 可用
- [ ] No Parent 可用
- [ ] Manual correction 可用
- [ ] Undo 可用
- [ ] Current Path 可用
- [ ] Main Thread 可用
- [ ] Open Branches 可用
- [ ] Inbox 可用
- [ ] Graph View 可用
- [ ] Node → Original Chat 基础导航可用
- [ ] Status 可修改
- [ ] Refresh 后数据不丢
- [ ] API 失败有 fallback
- [ ] 关键流程有测试
- [ ] 没有引入 PRD 明确禁止的功能
- [ ] Roadmap 已更新
- [ ] Roadmap 与 v0.5 PRD 不冲突
- [ ] README / 启动说明如有必要已更新

---

# Z. Agent 最终汇报格式

实现完成后请输出：

```text
1. v0.5 实现了什么
2. 修改了哪些文件
3. 数据结构最终是什么
4. Parent Recommendation 如何工作
5. No Parent / Inbox 如何工作
6. Current Path / Open Branches 如何工作
7. Node 如何跳回原 Chat
8. 有哪些 fallback
9. 哪些内容明确没有实现
10. Roadmap 做了哪些更新
11. 测试结果
12. 仍存在的已知限制
```

不要只回答“已完成”。
