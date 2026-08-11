# ChatGPT Discussion Map v0.1 — PRD

## 1. 版本定位

版本：v0.1  
名称：Manual Discussion Map

v0.1 是纯手动版本，不调用任何 AI。

目标不是自动化，而是验证：

> “当前分支 + 待讨论问题 + 返回主线 + 问题图”是否能够真实改善复杂 ChatGPT 讨论体验。

---

## 2. 用户场景

用户在 ChatGPT 中提出一个复杂问题，GPT 一次给出多个方案。

用户选择其中一个深入讨论，但过程中又产生新的问题。

最终用户常出现：

- 忘记最初问题
- 忘记其他分支
- 不知道当前讨论属于哪个父问题
- 不知道完成当前分支后该返回哪里

v0.1 通过手动结构管理解决这些问题。

---

## 3. 核心用户故事

### US-01 创建讨论项目

作为用户，我希望创建一个 Project，并填写核心目标，从而始终知道整个讨论最终要解决什么。

### US-02 创建分支

作为用户，我希望把 GPT 提到的某个问题创建成 Branch。

### US-03 创建子分支

作为用户，我希望把某个问题继续拆分成子问题。

### US-04 设置当前分支

作为用户，我希望明确标记“我现在正在讨论哪个问题”。

### US-05 完成并返回

作为用户，我希望完成当前分支后，系统告诉我父问题和其他待讨论分支。

### US-06 查看问题图

作为用户，我希望用图看到当前项目中的问题关系。

### US-07 关联 ChatGPT 对话

作为用户，我希望把当前 ChatGPT Conversation 关联到某个 Branch，之后可从 Branch 返回聊天。

---

## 4. 核心交互

### 4.1 Current Branch Badge

ChatGPT 页面右上角展示：

```text
┌────────────────────────┐
│ ◉ C2 分数校准      ③   │
└────────────────────────┘
```

显示：

- 当前 Branch 编号
- Branch 标题
- 未完成 Branch 数量

点击打开 Side Panel。

---

### 4.2 Side Panel

必须显示：

- 当前 Project
- Project Goal
- Current Breadcrumb
- Active Branch
- Child Branches
- Pending Branches
- 常用操作

操作：

- 新建子问题
- 切换当前分支
- 完成当前分支
- 暂时搁置
- 返回父问题
- 查看完整地图

---

### 4.3 Graph View

图中节点至少显示：

- Branch Title
- Status
- 是否为 Active

状态：

```text
active
pending
resolved
parked
rejected
```

关系：

```text
parent → child
```

v0.1 暂不实现复杂语义边。

---

## 5. 功能需求

### FR-01 Project CRUD

支持：

- 创建
- 修改标题
- 修改 Goal
- 删除

### FR-02 Branch CRUD

支持：

- 创建
- 修改
- 删除
- 设置 parentId
- 修改状态

### FR-03 Active Branch

一个 Project 同一时间最多一个 Active Branch。

切换 Active 时：

- 原 Active 自动回到 pending，除非已 resolved / parked
- 新 Branch 设置 active

### FR-04 Resolve Branch

完成 Branch 后：

- status = resolved
- 如果存在 parent，展示“返回父问题”
- 展示同级 pending Branch

### FR-05 Park Branch

允许用户暂时搁置问题。

### FR-06 Chat Link

记录当前：

- conversation URL
- conversation title（能读到则保存）
- branchId

### FR-07 Local Persistence

浏览器关闭和重启后数据必须存在。

---

## 6. 数据模型

### Project

```ts
type Project = {
  id: string
  title: string
  goal: string
  createdAt: number
  updatedAt: number
}
```

### Branch

```ts
type BranchStatus =
  | "active"
  | "pending"
  | "resolved"
  | "parked"
  | "rejected"

type Branch = {
  id: string
  projectId: string
  parentId?: string
  title: string
  description?: string
  status: BranchStatus
  order: number
  createdAt: number
  updatedAt: number
}
```

### Chat

```ts
type Chat = {
  id: string
  conversationUrl: string
  conversationTitle?: string
  createdAt: number
  lastVisitedAt: number
}
```

### BranchChat

```ts
type BranchChat = {
  id: string
  branchId: string
  chatId: string
}
```

---

## 7. 技术方案

### Extension

- WXT
- Manifest V3
- React
- TypeScript

### UI

- Tailwind CSS
- Chrome Side Panel API

### Graph

- React Flow

### State

- Zustand（可选）

### Storage

- IndexedDB
- Dexie.js

### ChatGPT Integration

v0.1 只需要：

- 判断当前是否在 ChatGPT
- 获取当前 URL
- 尽可能获取 Conversation Title
- 注入 Current Branch Badge

不读取 GPT 正文。

---

## 8. 非功能需求

### NFR-01

插件初始化不明显影响 ChatGPT 页面加载。

### NFR-02

ChatGPT DOM 变化时，核心 Project / Branch 数据管理仍可工作。

### NFR-03

所有数据默认保存在本地。

### NFR-04

删除 Branch 前需要确认。

### NFR-05

Graph 中 100 个节点时仍可流畅浏览。

---

## 9. 非目标

v0.1 不做：

- AI 分析
- 自动读取当前问答
- 自动创建 Branch
- 云同步
- 登录
- 多用户
- ChatGPT 完整消息索引
- 多种 edge relation
- 自动布局高级优化

---

## 10. 验收标准

v0.1 完成时：

1. 用户可创建 Project。
2. 用户可设置 Goal。
3. 用户可创建 5 层以上 Branch。
4. 一个 Project 只有一个 Active Branch。
5. 用户可完成 Branch。
6. 完成后可返回 Parent。
7. 用户可查看 Graph。
8. 当前 Chat 可关联 Branch。
9. 点击关联可回到对应 Chat URL。
10. Chrome 重启后数据不丢失。
