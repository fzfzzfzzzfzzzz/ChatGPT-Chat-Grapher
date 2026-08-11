# Chat Graph v0.5 PRD

> 目标读者：实现该版本的 Coding Agent / 产品 Agent  
> 版本：v0.5  
> 产品形态：运行在 ChatGPT 网页版上的浏览器插件浮窗  
> 核心定位：**讨论结构导航器，而不是第二个聊天器，也不是知识库。**

---

## 0. Agent 执行要求

在开始编码前，先阅读本 PRD、v0.5 Checklist，以及项目现有 Roadmap / PRD / Checklist。

完成 v0.5 时，**必须同步更新项目 Roadmap**：

1. 将 v0.5 加入 Roadmap。
2. 将产品定位统一为“问题图 + 当前路径 + 分支导航 + 状态管理”。
3. 删除或降级旧 Roadmap 中与以下内容相关的规划：
   - Node 内保存 Reason
   - Node 内保存 Resource
   - Node 内保存 Decision
   - Node 内保存 Routes
   - Node 内保存 Open Questions 文本集合
   - 自动建立复杂知识图谱关系
   - 把 GPT 回答拆成大量独立业务节点
4. Roadmap 后续版本不得默认扩张成知识管理系统。
5. 任何新增能力，都需要回答：**它是否直接帮助用户找回主线、管理分支、定位原始聊天？**
6. 如果不满足上面的问题，则不进入近期 Roadmap。

不要在未更新 Roadmap 的情况下将 v0.5 标记为完成。

---

# 1. 产品背景

用户在 ChatGPT 中讨论复杂产品、科研思路或技术实现时，经常会出现：

- 一个主问题下面连续产生多个子问题；
- 为了解决一个问题，尝试多条技术路线；
- 讨论某个细节后不断深入，忘记原本主线；
- GPT 一次给出多个方向，用户只深入了其中一条，之后忘记其他方向；
- 后续想回顾时，只能在线性聊天记录里向上翻找；
- 很难快速知道“我现在讨论到哪里”“这个问题是从哪里分出来的”“哪些分支还没有回来”。

Chat Graph 不负责替代 ChatGPT，也不复制 ChatGPT 已经保存的信息。

它只负责维护：

> **用户问题之间的逻辑结构。**

---

# 2. 产品定义

Chat Graph 是运行在 ChatGPT 网页旁边的讨论状态管理器。

当用户在 ChatGPT 中发送一个问题后：

1. 插件自动捕获该用户问题；
2. 创建一个 Question Node；
3. AI 判断该问题最可能属于哪个已有父节点；
4. 允许该问题没有父节点；
5. 将节点加入问题图；
6. 更新当前讨论路径；
7. 用户可以通过浮窗查看当前路径、未完成分支和完整 Graph；
8. 用户点击节点可以定位回原始 ChatGPT 对话位置。

核心原则：

> **时间顺序不等于逻辑父子关系。**

后一条消息不能默认连接到上一条问题。

---

# 3. v0.5 核心目标

v0.5 必须解决以下 6 个问题：

1. 自动收集用户提出的问题；
2. 智能推荐问题的父节点；
3. 允许问题没有父节点；
4. 持续显示 Current Path；
5. 帮助用户发现和返回尚未处理完的分支；
6. 点击 Node 能回到 ChatGPT 原始消息。

---

# 4. v0.5 明确不做什么

以下内容不是 v0.5 的目标。

## 4.1 不做第二套聊天系统

插件不负责：

- 调用 GPT 完成主要对话；
- 替代 ChatGPT 输入框；
- 保存完整聊天正文作为自己的聊天数据库；
- 重新实现 ChatGPT 历史聊天界面。

ChatGPT 仍然是唯一主聊天界面。

---

## 4.2 Node 不做知识卡片

Node 的业务信息只允许保存：

- `question`
- `summary`
- `status`

不要在 Node 中继续添加：

- reason
- resource
- decision
- routes
- alternatives
- evidence
- conclusion
- answer
- references
- openQuestions 文本集合

原因：

这些信息本来就在 ChatGPT 的原始聊天上下文里。

Chat Graph 的目标不是重复保存聊天内容，而是让用户能够定位回原始聊天。

---

## 4.3 不自动把 GPT 回答拆成大量 Node

v0.5 的主 Node 来源是：

> **用户实际发送的问题。**

GPT 回答中的“方案 A / 方案 B / 方案 C”不能默认直接变成正式 Question Node。

如果后续为了“未完成分支提醒”需要从回答中提取候选方向，应当保存为轻量 Candidate / Suggestion，而不是正式 Node。

正式 Node 的创建仍以用户实际提出的问题为准。

---

## 4.4 不做复杂知识图谱

v0.5 不实现：

- 多类型语义边；
- Related Edge；
- Reference Edge；
- 图数据库式推理；
- 自动主题聚类网络；
- 多父节点复杂 DAG；
- 知识图谱自动重构。

v0.5 主结构保持简单：

> **Question Tree / Forest**

每个 Node：

- 最多一个 parent；
- 可以没有 parent；
- 可以有多个 children。

---

# 5. Node 定义

## 5.1 用户可理解的 Node 信息

每个 Node 的内容只包括：

```text
question
summary
status
```

示例：

```text
Question:
浏览器插件如何读取 ChatGPT 页面中的新消息？

Summary:
讨论插件如何监听 ChatGPT DOM 变化并识别新的用户消息。

Status:
active
```

---

## 5.2 必须存在的内部结构字段

虽然 Node 的“业务信息”只保留 question / summary / status，
但为了实现图结构、跳转和本地持久化，允许存在必要的技术字段。

推荐最小结构：

```ts
type GraphNode = {
  id: string

  question: string
  summary: string
  status: NodeStatus

  parentId: string | null
  childIds?: string[]

  chatId: string
  messageId?: string
  messageAnchor?: string

  createdAt: number
  updatedAt: number
}
```

说明：

- `parentId`：图结构必须字段；
- `chatId`：定位原始 Chat；
- `messageId/messageAnchor`：定位原始问题；
- `createdAt/updatedAt`：本地维护需要；
- 这些字段属于系统 metadata，不属于 Node 的用户内容。

不要把内部 metadata 展示成复杂 Node 卡片。

---

# 6. Node Status

v0.5 保留状态系统。

建议状态：

```text
active
pending
resolved
parked
rejected
```

含义：

| Status | 含义 |
|---|---|
| active | 当前正在讨论 |
| pending | 已提出，但尚未继续深入 |
| resolved | 当前问题已经得到足够答案 |
| parked | 暂时放下，以后再讨论 |
| rejected | 该讨论方向已经明确不继续 |

说明：

`rejected` 表示“这个问题 / 方向不再继续”，
不是要求 Node 保存失败原因。

失败原因仍然存在于原始聊天记录中。

---

# 7. 问题捕获

## 7.1 基本行为

当用户在 ChatGPT 网页版发送新消息时：

1. 插件监听 ChatGPT 页面；
2. 判断该消息是否是用户消息；
3. 判断是否应创建 Question Node；
4. 捕获完整问题文本；
5. 创建 Candidate Node；
6. 进入 Parent Recommendation 流程。

---

## 7.2 什么算一个 Node

默认规则：

- 一次用户提交 = 一个候选 Node；
- 即使一条消息里包含多个问句，v0.5 默认仍先视为一个 Node；
- 不在 v0.5 中自动把一条用户消息拆成多个正式节点。

例如：

```text
Chrome 和 Firefox 哪个更适合？MV3 有什么区别？
```

v0.5 可以生成：

```text
Chrome、Firefox 与 MV3 的插件方案选择
```

而不是自动生成三个独立 Node。

未来如果需要“多问题拆分”，单独进入后续版本。

---

# 8. Summary

每个正式 Node 有一个简短 summary。

要求：

- 1–2 句；
- 描述“这个问题正在解决什么”；
- 不重复整段 question；
- 不总结完整 GPT 答案；
- 不保存原因、资源、结论；
- 主要用于父节点匹配和 Graph 快速浏览。

示例：

```text
Question:
Firefox 插件是不是每次启动都要重新加载？

Summary:
确认 Firefox 自定义扩展在临时加载和正式安装情况下的持久化行为。
```

---

# 9. Parent Recommendation

这是 v0.5 的核心 AI 功能。

## 9.1 输入

推荐父节点时，可使用：

- 新问题 question；
- 新问题 summary；
- 当前路径；
- 最近若干 Node；
- 当前 Project / 当前 Chat 中已有 Node 的 question + summary；
- 必要时少量最近聊天上下文。

不要把完整历史聊天无限发送给模型。

---

## 9.2 输出

AI 应返回：

```ts
{
  suggestedParentId: string | null
  confidence: number
}
```

可选增加最多 2–3 个候选：

```ts
{
  candidates: [
    { nodeId: "...", confidence: 0.91 },
    { nodeId: "...", confidence: 0.64 }
  ],
  noParentConfidence: 0.08
}
```

---

## 9.3 判断原则

模型应回答：

> “这个新问题，是为了进一步解决哪个已有问题？”

而不是：

> “哪个节点和它文本最相似？”

需要综合：

1. 语义关系；
2. 当前讨论路径；
3. 新问题是不是对某节点的继续追问；
4. 是否从更高层问题切换到了另一条 sibling branch；
5. 是否已经偏离当前主题。

---

# 10. No Parent / New Root

必须允许：

```text
parentId = null
```

典型场景：

当前正在讨论 Chat Graph，
用户突然问：

> IBKR 港股手续费是多少？

不能因为上一条问题是“MutationObserver 是什么”就自动连接。

此时应：

- 创建 Root Node；
- 或进入 Inbox 等待确认；
- 不污染现有讨论树。

原则：

> **宁可漏连，不要错连。**

---

# 11. Parent Confidence

建议默认逻辑：

### High Confidence

例如：

```text
>= 0.85
```

行为：

- 自动挂载；
- 浮窗轻量显示“Linked to XXX”；
- 提供 Undo / Change。

### Medium Confidence

例如：

```text
0.60–0.85
```

行为：

- 显示 2–3 个候选；
- 用户一键选择；
- 允许 No Parent。

### Low Confidence

例如：

```text
< 0.60
```

行为：

- 不强行挂载；
- 默认 Root 或 Inbox；
- 等待用户后续整理。

阈值允许实现时配置，不要求写死。

---

# 12. Manual Correction

用户必须始终拥有最终控制权。

支持：

- Change Parent；
- Remove Parent；
- Set as Root；
- Move to another Parent；
- Undo 最近一次自动连接。

AI 的角色：

> Proposal。

用户的角色：

> Final authority。

---

# 13. Current Path

浮窗默认状态下，不应该首先展示完整 Graph。

默认重点显示：

```text
CURRENT PATH

产品设计
  ↓
图结构
  ↓
父节点智能识别
```

Current Path = 从当前 Active Node 反向沿 parentId 到 Root 的路径。

用途：

- 用户随时知道“我现在讨论到哪里”；
- 防止深挖细节后忘记主线；
- 可以点击路径中的任意祖先 Node。

---

# 14. Main Thread / Return to Parent

浮窗提供两个快速导航动作：

```text
← Parent
↑ Main Thread
```

### Parent

将当前焦点回到直接父节点。

### Main Thread

将当前焦点切换到用户指定或系统识别的较高层主线节点。

重要：

“切换焦点”不等于修改现有节点关系。

它表示：

> 下一条新问题优先基于该 Node 作为上下文进行 Parent Recommendation。

---

# 15. Open Branches

这是 v0.5 的核心体验之一。

目标：

> 用户深入某个分支后，仍然能看到之前尚未继续处理的 sibling / pending branch。

最简单可实现版本：

- 同一个 parent 下；
- `status = pending` 的 sibling nodes；
- 或用户曾手动标记为 parked 的 sibling nodes。

浮窗展示：

```text
OPEN BRANCHES

○ 原生 App
○ PWA
○ Firefox 方案
```

v0.5 不要求通过复杂 LLM 自动从每次 GPT 回答中永久创建这些正式节点。

如要从 GPT 回答中识别“可能尚未讨论的方向”，只能作为：

```text
Branch Suggestion
```

用户点击后，才可转化为正式 Question Node / discussion target。

---

# 16. Branch Inbox

对于无法可靠判断父节点的问题，可进入 Inbox。

Inbox 中允许：

- Attach to Parent；
- Set as Root；
- Delete；
- Ignore。

Inbox 的目标是保护主图不被错误连接污染。

不要让 Inbox 发展成第二套任务管理器。

---

# 17. Graph View

完整 Graph 是辅助视图，不是默认主界面。

要求：

- Question Tree / Forest；
- 节点只展示简短 question；
- 状态用简单视觉标识；
- 当前 Node 高亮；
- 当前路径高亮；
- 支持折叠子树；
- 支持点击 Node；
- 不显示复杂的 reason/resource/decision 卡片。

Node Hover / Detail 可显示：

```text
question
summary
status
```

以及必要的操作按钮。

---

# 18. Node → Original Chat

每个 Node 都必须尽量能够回到原始 ChatGPT 消息。

点击 Node：

1. 如果当前已在对应 Chat：
   - 滚动并高亮原始用户消息；
2. 如果不在对应 Chat：
   - 打开 / 跳转到对应 Chat URL；
   - 尽量定位到原消息；
3. 如果 ChatGPT DOM 或 URL 机制无法可靠定位：
   - 至少跳到对应 Chat；
   - 明确降级行为。

这是 v0.5 必须保留的核心价值：

> Graph 负责导航，内容仍然以 ChatGPT 原聊天为准。

---

# 19. 浮窗设计

默认折叠：

```text
◉ Graph
```

展开：

```text
┌────────────────────────────┐
│ CHAT GRAPH             [⤢] │
│                            │
│ CURRENT PATH               │
│ 产品设计                   │
│  > 图结构                  │
│    > 父节点智能识别        │
│                            │
│ OPEN BRANCHES              │
│ ○ No Parent 行为           │
│ ○ Graph View               │
│                            │
│ [← Parent] [↑ Main]        │
│ [Open Graph]               │
└────────────────────────────┘
```

原则：

- 不遮挡主要聊天区；
- 默认轻量；
- 主要操作最多 1–2 次点击；
- 不要求每次发问题都弹大型确认窗口。

---

# 20. 自动分析流程

建议流程：

```text
用户发送消息
    ↓
DOM Observer 捕获 User Message
    ↓
创建 Candidate
    ↓
生成 / 更新 Summary
    ↓
Parent Recommendation
    ↓
High Confidence
  → 自动连接 + 可撤销

Medium Confidence
  → 用户选择 Parent

Low Confidence
  → Root / Inbox
    ↓
创建正式 Node
    ↓
设为当前 Active Node
    ↓
更新 Current Path
    ↓
刷新 Open Branches / Graph
```

---

# 21. GPT 回答完成后的处理

v0.5 不需要把 GPT 回答本身写进 Node。

回答完成后只允许做轻量操作，例如：

- 根据最新上下文优化 summary；
- 允许用户将 status 改为 resolved / parked / rejected；
- 可选：分析是否出现 Branch Suggestions。

禁止自动把答案中的所有方案变成正式节点。

---

# 22. 数据存储

v0.5 优先本地存储。

可选择：

- IndexedDB；
- 或项目当前已经稳定使用的浏览器本地持久化方案。

不要为了 v0.5 引入云端账户系统。

必须保存：

```text
Projects / Graphs
Nodes
Parent relations
Status
Chat identifiers
Message anchors
Current focus
User corrections
```

---

# 23. Project 与 Chat 的关系

v0.5 应兼容：

```text
Project
  ├── Chat A
  ├── Chat B
  └── Chat C
```

但不要因此扩张成复杂 Workspace。

最小要求：

- Node 知道来自哪个 Chat；
- Graph 可以按 Project 聚合；
- 如果现有版本尚未支持跨 Chat，可先保证当前 Chat 可用，并在数据结构中预留 `projectId/chatId`。

---

# 24. AI API

当前插件可以继续调用已有的云端小模型 / 阿里云 API 进行结构分析。

AI 主要承担：

1. question summary；
2. parent recommendation；
3. 可选 branch suggestion。

不要调用 AI 保存大量知识内容。

Prompt 应尽量结构化、输出 JSON、限制 token。

---

# 25. Parent Recommendation Prompt 的核心语义

Agent 实现 Prompt 时应体现：

```text
You are not building a chronological tree.

Given a new user question and existing question nodes,
identify which previous question this new question is trying to further solve.

A parent should represent the problem that logically caused the user to ask the new question.

The immediately previous question is NOT automatically the parent.

If the new question belongs to another branch, choose that branch's parent.

If it is unrelated, return no parent.

Prefer no parent over an incorrect parent.
```

---

# 26. 状态更新策略

v0.5 不要求 AI 完全自动决定状态。

优先：

- 新 Node → `active`
- 之前 active Node 可转为 `pending`
- 用户手动设：
  - resolved
  - parked
  - rejected

后续可以再增加智能推荐状态。

不要让 AI 在没有明确依据时自动把问题标成 resolved。

---

# 27. 典型使用案例

用户讨论：

```text
怎么做 Chat Graph 插件？
```

Root：

```text
怎么做 Chat Graph 插件？
```

接着：

```text
浏览器插件还是本地网页？
```

图：

```text
怎么做 Chat Graph 插件？
└── 浏览器插件还是本地网页？
```

接着：

```text
Firefox 和 Chrome 有什么区别？
```

图：

```text
怎么做 Chat Graph 插件？
└── 浏览器插件还是本地网页？
    └── Firefox 和 Chrome 有什么区别？
```

接着：

```text
Node 应该保存哪些字段？
```

AI 不应连到 Firefox：

```text
怎么做 Chat Graph 插件？
├── 浏览器插件还是本地网页？
│   └── Firefox 和 Chrome 有什么区别？
└── Node 应该保存哪些字段？
```

接着突然：

```text
IBKR 港股手续费是多少？
```

应：

```text
ROOT 1: 怎么做 Chat Graph 插件？
...
ROOT 2: IBKR 港股手续费是多少？
```

或进入 Inbox。

---

# 28. 成功标准

v0.5 成功不是“Graph 看起来很复杂”。

成功标准是：

### 用户在讨论 20–50 个问题之后：

仍然可以在 3 秒内回答：

1. 我现在在哪条讨论路径？
2. 当前问题的父问题是什么？
3. 我之前还有哪些 branch 没有继续？
4. 我能不能快速回到其中一个旧问题？
5. 我能不能点 Node 找到当时的原始 Chat？
6. AI 有没有把明显无关的问题错误挂到主线上？

---

# 29. v0.5 DoD

必须全部满足：

- [ ] 自动捕获 ChatGPT 用户消息
- [ ] 一条用户提交创建一个 Question Candidate
- [ ] 正式 Node 业务字段只有 question / summary / status
- [ ] Parent Recommendation 可用
- [ ] 支持 No Parent
- [ ] 支持修改 Parent
- [ ] 支持 Undo
- [ ] Current Path 可用
- [ ] Parent / Main Thread 导航可用
- [ ] Open Branches 有基础实现
- [ ] Branch Inbox 有基础实现
- [ ] Graph View 可用
- [ ] Node 可跳转原 Chat
- [ ] 状态可手动修改
- [ ] 本地数据可恢复
- [ ] 刷新 ChatGPT 页面不丢失已有 Graph
- [ ] 不把 GPT Answer 自动拆成大量正式 Node
- [ ] 不把 reason/resource/decision/routes 写入 Node
- [ ] 更新项目 Roadmap
- [ ] Roadmap 明确记录 v0.5 的范围和 Non-goals

---

# 30. Roadmap 更新要求

完成 v0.5 时，请直接修改现有 Roadmap，而不是另写一个互相冲突的新 Roadmap。

Roadmap 至少应体现：

## 已完成 / 当前

### v0.1–v0.4
保留已有历史，但如果旧描述与当前产品方向冲突，应标记为：

```text
Deprecated / Superseded by v0.5
```

不要让 Agent 以后继续按照已废弃设计扩张。

## v0.5 — Discussion Navigation Core

必须写入：

- 自动捕获 Question
- Question Node
- question / summary / status
- Parent Recommendation
- No Parent
- Manual Parent Correction
- Current Path
- Open Branches
- Main Thread
- Inbox
- Graph View
- Node → Original Chat
- Local Persistence

## v0.6 以后

优先考虑：

- Parent recommendation 准确率提升
- Branch Suggestion
- 多 Chat / Project 聚合
- 搜索
- Context Packet
- 数据导入导出

暂不优先：

- 云同步
- 账号系统
- 知识图谱
- 多类型 Edge
- Decision/Reason/Resource 数据库
- 自动知识整理系统

---

# 31. 最终产品原则

Agent 在实现时始终遵循：

> ChatGPT 保存内容，Chat Graph 保存结构。

> Question 是核心 Node，Answer 不是核心 Node。

> Graph 的价值不是“记录更多”，而是“让用户找得回来”。

> 宁可 No Parent，也不要错误连接。

> 默认界面优先显示 Current Path 和 Open Branches，而不是完整大图。

> 任何功能如果不能帮助用户找主线、管分支、回原聊天，就不属于 v0.5 核心范围。
