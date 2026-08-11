# ChatGPT Discussion Map v0.4 — PRD

## 1. 版本定位

版本：v0.4  
名称：Sync & Productization

v0.4 将 v0.3 的单机工具升级为可跨设备长期使用的产品。

---

## 2. 版本目标

解决：

- 换电脑后 Discussion Map 不存在
- 多设备状态不同步
- 本地数据无法备份
- 产品缺少账号、导出、删除能力
- API Key 使用模式需要产品化

同时坚持：

> 默认不上传完整 ChatGPT 对话正文。

---

## 3. 总体架构

```text
ChatGPT Web
    │
Browser Extension
    │
    ├── IndexedDB / Dexie
    │       │
    │       └── Sync Queue
    │
    ├── Alibaba Bailian API
    │
    └── Supabase
            ├── Auth
            ├── PostgreSQL
            └── RLS
```

---

## 4. Local-first

任何用户操作先写本地。

```text
User Action
   ↓
IndexedDB Transaction
   ↓
UI Update
   ↓
Sync Event
   ↓
Cloud Sync
```

网络中断时：

- 可继续创建 Branch
- 可继续修改 Branch
- 可 Resolve
- 可浏览 Graph
- 可继续使用已有本地数据

恢复网络后自动同步。

---

## 5. 云同步范围

默认同步：

### Project

- title
- goal

### Branch

- title
- description
- summary
- status
- parentId
- order

### Chat Metadata

- URL
- title
- conversationId（如果存在）

### Decision

- content

### OpenQuestion

- content
- status
- priority

### GraphEvent

- event metadata

### Settings

- 非敏感偏好

---

## 6. 默认不同步

- 完整 User Message 正文
- 完整 Assistant Message 正文
- ChatGPT Cookie
- ChatGPT Session
- Alibaba API Key

---

## 7. Auth

支持：

- Sign Up
- Login
- Logout
- Session restore
- Delete Account

v0.4 初版不需要：

- Team
- Organization
- Role hierarchy

---

## 8. Cloud Database

推荐：

- Supabase
- PostgreSQL
- Row Level Security

所有业务表必须有：

```text
user_id
created_at
updated_at
```

并通过 RLS 保证：

```text
auth.uid() = user_id
```

---

## 9. Sync Model

建议使用增量事件同步，而不是每次上传完整 Project。

核心字段：

```ts
type SyncRecord = {
  id: string
  entityType: string
  entityId: string

  operation: "upsert" | "delete"

  localUpdatedAt: number
  syncStatus: "pending" | "synced" | "error"

  retryCount: number
}
```

---

## 10. 冲突策略

v0.4 初版采用：

### 普通字段

Last-write-wins。

### 删除

Tombstone，避免另一台设备把已删除节点重新同步回来。

### GraphEvent

Append-only。

### parentId 冲突

优先最新写入，同时记录冲突日志。

复杂 CRDT 不进入 v0.4。

---

## 11. Sync Status UI

显示：

```text
● 已同步
◐ 正在同步
○ 离线
! 同步失败
```

用户可以：

- Retry
- 查看失败条目

---

## 12. AI 调用模式

### Mode A — BYOK

用户提供自己的阿里云百炼 API Key。

适合：

- 自用
- 开源
- 技术用户

### Mode B — Managed API

插件调用产品后端，由后端调用百炼。

适合：

- 商业化
- 普通用户
- 订阅制

v0.4 需要把 AI client 抽象为：

```ts
interface AIProvider {
  analyzeTurn(...)
  recommendBranch(...)
  summarizeBranch(...)
}
```

从而支持两种模式切换。

---

## 13. API Key 安全

BYOK：

- 仅本地保存
- 不上传 Supabase
- 导出时默认不包含
- UI 遮罩
- 日志不打印

Managed：

- Key 只存在服务端 secret
- 浏览器永远看不到开发者 Key

---

## 14. 数据导出

支持导出：

```text
discussion-map-export.json
```

可选 Markdown：

```text
Project Summary
├── Branches
├── Decisions
└── Open Questions
```

默认不导出 API Key。

---

## 15. 数据导入

允许：

- 导入同版本 JSON
- 版本检查
- Schema migration
- 冲突提示

---

## 16. 删除能力

用户必须能够：

- 删除 Project
- 删除全部本地数据
- 删除全部云端数据
- 删除账号

删除账号前明确提示影响范围。

---

## 17. Onboarding

首次安装：

1. 产品用途
2. 数据默认保存位置
3. 创建第一个 Project
4. 填写 Goal
5. 创建第一个 Branch
6. 可选配置百炼 API
7. 展示 Current Branch Badge

---

## 18. 非目标

v0.4 不做：

- Team Collaboration
- 实时多人编辑
- CRDT
- 完整 ChatGPT 历史备份
- 自动控制 ChatGPT
- 自动发送消息
- 知识图谱数据库
- 商业支付系统（可后续单独版本）

---

## 19. 验收标准

1. 用户可注册并登录。
2. 两台设备看到同一 Project。
3. 两台设备看到相同 Branch Tree。
4. 离线可继续编辑。
5. 恢复网络自动同步。
6. 删除不会被旧设备复活。
7. 同步失败有可见状态。
8. API Key 不上传云端。
9. 用户可导出结构数据。
10. 用户可删除全部云端数据。
11. 升级 v0.3 → v0.4 不丢数据。
