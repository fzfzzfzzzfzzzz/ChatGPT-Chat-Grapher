# ChatGPT Discussion Map v0.2 — PRD

## 1. 版本定位

版本：v0.2  
名称：AI-assisted Discussion Management

v0.2 在 v0.1 手动分支管理基础上加入阿里云百炼 API。

核心原则：

> AI 只提出结构修改建议，不直接修改最终 Graph 状态。

---

## 2. 版本目标

把：

```text
用户阅读 GPT 回答
→ 手动创建 Branch
→ 手动写 Summary
→ 手动记录问题
```

变成：

```text
用户点击“分析本轮”
→ AI 生成建议
→ 用户确认 / 编辑
→ 更新 Discussion Map
```

---

## 3. AI 负责什么

- 判断当前一问一答属于哪个 Branch
- 提取本轮主题
- 生成短 Summary
- 提取 Decision
- 提取 Open Question
- 推荐新增子 Branch
- 推荐 Branch 状态变化
- 输出 Graph Operations

AI 不负责：

- 回答原问题
- 替代 ChatGPT
- 自动修改最终数据库
- 自动批量抓取历史 Chat

---

## 4. 核心用户故事

### US-01 分析本轮

用户点击“分析本轮”后，系统分析最近一组 User + Assistant 消息。

### US-02 AI 推荐分支

AI 判断当前讨论属于现有哪个 Branch。

### US-03 自动发现新问题

AI 从回答中提取“以后还需要讨论”的问题。

### US-04 提取结论

AI 提取已经明确形成的结论。

### US-05 用户确认

AI 结果必须经过用户确认后才能修改 Graph。

### US-06 撤销

用户能够撤销最近一次 Graph 修改。

---

## 5. Current Turn Analyzer

输入：

```json
{
  "project_goal": "...",
  "current_branch": {...},
  "candidate_branches": [...],
  "user_message": "...",
  "assistant_message": "..."
}
```

输出必须是结构化 JSON。

建议结构：

```json
{
  "branch_match": {
    "branch_id": "C2",
    "confidence": 0.94
  },
  "topic": "线性校准导致评分方差压缩",
  "summary": "讨论线性回归校准对评分分布的影响。",
  "decisions": [
    "校准质量不能只通过 MAE 衡量。"
  ],
  "open_questions": [
    "如何保持校准后的层次差异？"
  ],
  "operations": [
    {
      "type": "CREATE_BRANCH",
      "parent_id": "C2",
      "title": "方差保持"
    }
  ]
}
```

---

## 6. Graph Operation 类型

v0.2 支持：

```text
CREATE_BRANCH
UPDATE_BRANCH
SET_ACTIVE_BRANCH
RESOLVE_BRANCH
PARK_BRANCH
ADD_DECISION
ADD_OPEN_QUESTION
```

暂不自动支持：

```text
MERGE_BRANCH
MOVE_BRANCH
DELETE_BRANCH
```

这三类高风险操作保留手动执行。

---

## 7. AI Review Card

分析完成后显示：

### 当前分支

- 推荐 Branch
- Confidence
- 允许修改

### Summary

- 可编辑

### Decisions

- 每条单独 Accept / Reject / Edit

### Open Questions

- 每条单独 Accept / Reject / Edit
- 可选择：
  - 加入 Inbox
  - 立即创建子 Branch

### Operations

- 显示将发生的结构变化

底部：

- Accept All
- Apply Selected
- Cancel

---

## 8. ChatGPT Adapter

v0.2 首次开始读取当前消息正文。

适配层集中在：

```text
/adapters/chatgpt/
```

至少提供：

```ts
getConversationMeta()
getLatestUserMessage()
getLatestAssistantMessage()
getLatestTurn()
isAssistantStreaming()
```

所有 DOM selector 集中管理。

任何 UI 组件不得直接查询 ChatGPT DOM。

---

## 9. 百炼 API

调用位置：

```text
Content Script
    ↓ message
Extension Service Worker
    ↓ HTTPS
Alibaba Bailian API
```

Content Script 不直接持有 API Key。

### 设置项

- API Key
- Base URL
- Model ID
- Timeout
- AI enabled

### 默认策略

- 默认使用低成本 Flash 级模型
- Model ID 不写死
- 用户可更改
- 失败后不影响 v0.1 手动功能

---

## 10. API Key 策略

v0.2 采用 BYOK。

用户自己填写阿里云百炼 API Key。

保存：

```text
chrome.storage.local
```

约束：

- Content Script 无权直接读取 Key
- API 请求统一由 Service Worker 发出
- 日志不得输出 Key
- 导出数据时不包含 Key
- UI 默认遮罩显示

---

## 11. GraphEvent

所有确认后的修改写入 GraphEvent。

```ts
type GraphEvent = {
  id: string
  projectId: string
  branchId?: string

  type: string

  before?: unknown
  after?: unknown

  source: "user" | "ai"
  model?: string
  confidence?: number

  createdAt: number
}
```

用途：

- Undo
- Debug
- AI 准确率评估
- v0.4 云同步基础

---

## 12. Decision

```ts
type Decision = {
  id: string
  projectId: string
  branchId: string

  content: string
  sourceChatId?: string

  createdAt: number
  updatedAt: number
}
```

---

## 13. OpenQuestion

```ts
type OpenQuestion = {
  id: string
  projectId: string
  branchId: string

  content: string

  status: "inbox" | "active" | "resolved" | "ignored"
  priority?: number

  createdAt: number
  updatedAt: number
}
```

---

## 14. 失败处理

### API 失败

显示：

```text
AI 分析失败。
你的 Discussion Map 数据没有受到影响。
```

允许：

- Retry
- 手动维护

### JSON 解析失败

- 不执行任何 Operation
- 保留原始响应用于开发调试
- UI 显示可重试

### DOM 解析失败

- 提示用户当前页面暂时无法分析
- 手动功能仍正常

---

## 15. 非目标

v0.2 不做：

- 自动分析每一轮
- 持续监听页面并自动调用 API
- 全历史批量抓取
- 自动发送 ChatGPT 消息
- 跨设备同步
- 用户账号系统
- 自动重构整张 Graph

---

## 16. 验收标准

1. 用户可配置百炼 API。
2. 能读取当前最近一问一答。
3. 能生成合法结构化分析。
4. AI 可推荐 Branch。
5. AI 可提取 Summary。
6. AI 可提取 Decision。
7. AI 可提取 OpenQuestion。
8. AI 可提议新增 Branch。
9. 用户确认前不修改数据库。
10. 用户可编辑 AI 结果。
11. 用户可撤销已应用操作。
12. API 失败时 v0.1 功能仍完全可用。
