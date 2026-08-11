# ChatGPT Discussion Map v0.3 — PRD

## 1. 版本定位

版本：v0.3  
名称：Cross-Chat Project Workflow

v0.3 是产品的核心版本。

它解决：

> 用户为了讨论不同分支而新开多个 ChatGPT 对话后，这些 Chat 彼此孤立的问题。

---

## 2. 核心模型升级

v0.2：

```text
Project
  └── Branch
       └── Chat Link
```

v0.3：

```text
Project
├── Branch
│    ├── Child Branch
│    ├── Decisions
│    └── OpenQuestions
│
└── Chats

Branch ←→ BranchChat ←→ Chat
```

Branch 与 Chat 是多对多关系。

---

## 3. 核心用户故事

### US-01 多 Chat 项目

作为用户，我希望一个 Project 能关联很多 ChatGPT Conversation。

### US-02 Chat 归属

打开一个 Chat 后，我希望知道它属于哪个 Project / Branch。

### US-03 AI 推荐归属

新 Chat 发送第一条问题后，AI 可以推荐最可能的 Branch。

### US-04 Branch Inbox

AI 发现暂时不准备讨论的新问题时，我希望先放到 Inbox，不立即打断当前分支。

### US-05 返回主线

完成当前 Branch 后，我希望系统告诉我父问题及下一批未完成分支。

### US-06 Context Packet

开始或继续一个 Branch 时，我希望快速生成结构化上下文，并插入 ChatGPT 输入框。

### US-07 Search

我希望搜索 Branch / Decision / OpenQuestion / Chat。

---

## 4. Conversation Registry

Chat 数据结构升级：

```ts
type Chat = {
  id: string
  projectId: string

  conversationId?: string
  conversationUrl: string
  conversationTitle?: string

  createdAt: number
  lastVisitedAt: number
}
```

Conversation ID 如果可稳定解析则记录；否则 URL 作为稳定退路。

---

## 5. BranchChat

```ts
type BranchChatRelation =
  | "primary"
  | "supporting"
  | "related"

type BranchChat = {
  id: string
  branchId: string
  chatId: string
  relation: BranchChatRelation
  createdAt: number
}
```

一个 Chat 可服务多个 Branch。

一个 Branch 可有多个 Chat。

---

## 6. Discussion Breadcrumb

插件始终能够显示：

```text
Project
>
Parent Branch
>
Child Branch
>
Current Branch
```

例如：

```text
面试评分
>
评分方法
>
分数校准
>
保持层次差异
```

Breadcrumb 每一级可点击。

---

## 7. 新 Chat 关联流程

打开新的 ChatGPT Conversation 时：

```text
这个聊天属于哪个讨论？

Project:
[面试评分 ▼]

Branch:
[分数校准 ▼]

[创建新分支]
```

如果用户已经发送首条问题：

提供：

```text
AI 推荐

面试评分
>
分数校准
>
方差保持

Confidence: 94%

[确认]
[选择其他]
[创建新 Branch]
```

---

## 8. Branch Inbox

AI 在当前回答中发现的问题默认可以进入 Inbox。

Inbox Item：

```ts
type OpenQuestion = {
  ...
  status: "inbox" | "active" | "resolved" | "ignored"
}
```

操作：

- Start Discussion
- Create Branch
- Merge with Existing
- Ignore
- Set Priority

Inbox 解决：

> GPT 一次给了很多方向，但用户当前只讨论其中一个。

---

## 9. Return to Main Thread

当用户 Resolve 当前 Branch：

系统显示：

```text
✓ C2.1 已完成

父问题：
C2 分数校准

仍未完成：
○ 分位数映射
○ 场次分别校准
○ 排名保持

建议下一步：
→ 分位数映射
```

建议下一步可以根据：

1. 同级 pending
2. Inbox priority
3. dependency
4. 创建顺序

v0.3 初版可只使用简单规则，不需要 AI 排序。

---

## 10. Context Packet

用户点击：

```text
[生成当前分支上下文]
```

生成：

```text
【讨论上下文】

核心目标：
...

当前路径：
...

当前分支目标：
...

已经确定：
1. ...
2. ...

仍未解决：
1. ...
2. ...

相关讨论：
...

当前问题：
```

操作：

- Copy
- Insert into ChatGPT textbox

禁止：

- 自动点击 Send
- 自动替用户提交

---

## 11. Context Packet 数据来源

只使用 Discussion Map 中的结构化信息：

- Project Goal
- Breadcrumb
- Branch description
- Decisions
- OpenQuestions
- Branch Summary
- Related Chat Titles

默认不重新抓取完整历史 Chat 内容。

---

## 12. Search

搜索范围：

### Branch

- title
- description
- summary

### Decision

- content

### OpenQuestion

- content

### Chat

- title
- URL

v0.3 可先使用 IndexedDB 本地搜索。

不需要向量数据库。

---

## 13. Graph View 升级

Graph 中允许：

- 以 Project 为根
- Branch 节点
- Chat 作为次级附属信息
- 点击 Branch 打开 Detail
- 查看关联 Chat 数量
- 查看 Decision 数量
- 查看 OpenQuestion 数量

不建议把每个 Chat 都作为主图大节点，否则图会快速膨胀。

---

## 14. AI 分支匹配

输入新增：

- Project Goal
- 当前 Branch
- 最近 Branch
- 候选 Branch 标题 + Summary
- 当前 User Message

输出：

```json
{
  "recommended_branch_id": "C2.1",
  "confidence": 0.94,
  "reason": "问题继续讨论线性校准后的方差保持。"
}
```

低置信度时：

```text
请选择 Branch
```

不自动绑定。

---

## 15. 非目标

v0.3 不做：

- 云同步
- 团队协作
- 自动批量分析全部历史 Chat
- 自动从 ChatGPT 搜索旧聊天
- 自动发送消息
- 向量数据库
- 知识图谱数据库
- 全自动 Branch 重构

---

## 16. 验收标准

1. 一个 Project 可关联至少 20 个 Chat。
2. 一个 Branch 可关联多个 Chat。
3. 一个 Chat 可关联多个 Branch。
4. 打开 Chat 能看到归属。
5. AI 可推荐 Chat 所属 Branch。
6. Inbox 能保存未来问题。
7. Inbox 可启动为 Branch。
8. Resolve 后可返回父问题。
9. Context Packet 可生成。
10. Context Packet 可插入输入框。
11. 用户仍需手动发送。
12. 可搜索 Branch / Decision / OpenQuestion / Chat。
13. 可从 Branch 打开相关 Chat。
