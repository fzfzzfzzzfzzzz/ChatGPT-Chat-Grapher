# Chat Graph v0.6 Implementation Checklist

> 配套文件：`chat_graph_v0.6_PRD.md`  
> 核心目标：实现稳定、轻量、常驻的 ChatGPT 页面内悬浮导航面板。

---

# A. 开始前

- [ ] 阅读 v0.5 PRD
- [ ] 阅读 v0.5 Checklist
- [ ] 阅读 v0.6 PRD
- [ ] 阅读当前 Roadmap
- [ ] 找到现有 floating panel / content script 实现
- [ ] 找到当前 Graph detail page
- [ ] 找到 User Message 捕获逻辑
- [ ] 找到 Parent Recommendation 逻辑
- [ ] 找到本地 persistence 实现
- [ ] 明确本版本不重做完整 Graph

---

# B. Scope Lock

确保 v0.6 不实现：

- [ ] Open Branches in floating panel
- [ ] Status in floating panel
- [ ] Full Current Path in floating panel
- [ ] Full Graph in floating panel
- [ ] 不把第三层大展开态直接做成 Detail Page 的复制品
- [ ] Reason
- [ ] Resource
- [ ] Decision
- [ ] Routes
- [ ] Assistant Answer Nodes
- [ ] Related Edge
- [ ] Complex DAG

---

# C. UI State Model

实现：

```ts
mode: "collapsed" | "working"
```

- [ ] 默认 mode 合理
- [ ] Collapsed → Working
- [ ] Working → Collapsed
- [ ] 刷新后恢复 mode
- [ ] 第三层 Local Graph 如实现，作为探索状态；不默认等同 Full Graph

---

# D. Collapsed State

UI：

```text
┌───────────────────────────────────────────────┐
│ Chat Graph   ·   Parent: 悬浮窗 UI 设计    ▾ │
└───────────────────────────────────────────────┘
```

检查：

- [ ] 显示 Project Name
- [ ] 显示 Parent Question
- [ ] Root 时显示 `Root`
- [ ] Parent 分析中显示 `判断中…`
- [ ] 保持单行
- [ ] 长文本正确 ellipsis
- [ ] 不显示 Current
- [ ] 不显示 Summary
- [ ] 不显示 Status
- [ ] 不显示 Open Branches
- [ ] 不显示完整 Graph
- [ ] 点击可展开

---

# E. Working State

UI：

```text
┌────────────────────────────────────────┐
│ Chat Graph                         — ↗ │
├────────────────────────────────────────┤
│ PARENT                                 │
│ 插件悬浮窗应该采用什么形式？          │
│                                        │
│                  ↓                     │
│                                        │
│ CURRENT                                │
│ 悬浮窗应该放什么内容？                 │
│                                        │
│ SUMMARY                                │
│ 确定常驻悬浮面板中需要展示的信息。     │
│                                        │
├────────────────────────────────────────┤
│ ← Parent               Change Parent   │
└────────────────────────────────────────┘
```

检查：

- [ ] Header
- [ ] Project Name
- [ ] collapse button
- [ ] detail-page button
- [ ] Parent section
- [ ] Current section
- [ ] Summary section
- [ ] Parent action
- [ ] Change Parent action
- [ ] 不出现额外管理模块

---

# F. Enter → Current Node

这是 v0.6 核心测试。

- [ ] 用户按 Enter
- [ ] User Message 被捕获
- [ ] Candidate 立即创建
- [ ] Current Node 立即变成新问题
- [ ] Working State 立即更新
- [ ] Collapsed State 的 Parent 状态随后更新
- [ ] 不等待 GPT 回答结束
- [ ] 不等待 Summary
- [ ] 不等待 Parent API
- [ ] API 慢时 UI 仍响应

---

# G. Current UI Loading

Enter 后允许：

```text
PARENT
判断中…

CURRENT
新问题

SUMMARY
生成中…
```

检查：

- [ ] Parent loading 可显示
- [ ] Summary loading 可显示
- [ ] Current 不出现 loading
- [ ] Current 必须是真实 question

---

# H. Summary

- [ ] 1–2 句
- [ ] 异步生成
- [ ] 不阻塞 Current
- [ ] 不复制完整 GPT Answer
- [ ] API 失败有 fallback
- [ ] 长文本截断
- [ ] hover/click 可看完整内容（如实现）

---

# I. Parent Recommendation High Confidence

- [ ] 自动更新 Parent
- [ ] 不弹大型 modal
- [ ] 可显示轻量 toast
- [ ] toast 有 Undo（如现有架构支持）
- [ ] Working UI 自动更新
- [ ] Collapsed UI 自动更新
- [ ] parent relation 持久化

---

# J. Parent Recommendation Medium Confidence

UI：

```text
SELECT PARENT

○ 悬浮窗 UI 设计       78%
○ 插件整体 UI          66%
○ No Parent
```

检查：

- [ ] 最多少量候选
- [ ] 可选择
- [ ] 可 No Parent
- [ ] Confirm 后更新
- [ ] 不阻止 ChatGPT 输入
- [ ] 完成后恢复标准 Working UI

---

# K. Low Confidence / No Parent

- [ ] 不强制错误挂载
- [ ] 支持 Root
- [ ] UI 显示 `Root`
- [ ] 用户后续可以 Change Parent

---

# L. Change Parent

UI：

```text
Search nodes…

○ A
● B
○ C
○ No Parent / Root

Cancel   Confirm
```

检查：

- [ ] 当前 Parent 默认选中
- [ ] 可选择其他 Node
- [ ] 可 Root
- [ ] 可搜索 / 过滤
- [ ] Confirm 更新 parentId
- [ ] persistence 更新
- [ ] UI 立即更新
- [ ] 防止 self-parent
- [ ] 防止 cycle
- [ ] Cancel 不修改

---

# M. `← Parent`

- [ ] 点击后 focus 移到直接 Parent
- [ ] 不修改 currentNode.parentId
- [ ] 不修改历史 Graph
- [ ] 下一轮 recommendation 考虑 focus
- [ ] Root 时按钮合理 disabled / hidden

---

# N. Current vs Focus

实现或确认：

```ts
currentNodeId
focusedNodeId
```

检查：

- [ ] Enter 后 current = new Node
- [ ] Enter 后 focus = new Node
- [ ] `← Parent` 只改变 focus
- [ ] PARENT UI 仍来自 current.parentId
- [ ] 不把 focus 错显示为 Parent

---

# O. Header

- [ ] Project Name 正确
- [ ] `—` 收起
- [ ] `↗` 打开详情页
- [ ] detail page 尽量定位当前 Project
- [ ] detail page 打开失败有 fallback

---

# P. Detail Page 职责

确认详情页仍承担：

- [ ] Full Graph
- [ ] Current Path
- [ ] Open Branches
- [ ] Inbox
- [ ] Status
- [ ] Search
- [ ] Node management

若某些尚未实现：

- [ ] 不硬塞进默认 Working State；第三层如需要某项，先判断是否属于局部高频导航
- [ ] Roadmap 记录后续实现

---

# Q. Panel Position

- [ ] `position: fixed`
- [ ] 默认右上区域
- [ ] 页面滚动不移动
- [ ] 不覆盖输入框
- [ ] 不超出 viewport

---

# R. Drag

- [ ] Header 可拖动
- [ ] 拖动过程平滑
- [ ] 不误触按钮
- [ ] 位置保存
- [ ] 刷新恢复
- [ ] 窗口 resize 后位置仍合理
- [ ] 不允许完全拖出屏幕

---

# S. Resize（可选）

如果实现：

- [ ] min width
- [ ] max width
- [ ] max height
- [ ] 内部 overflow
- [ ] resize 后保存尺寸

若未实现：

- [ ] 不阻塞 v0.6 DoD

---

# T. Shadow DOM

如当前适合迁移：

- [ ] 建立 shadow host
- [ ] UI CSS 与 ChatGPT 隔离
- [ ] event bridge 正常
- [ ] content script message 正常

若风险过高：

- [ ] 保留现状
- [ ] 至少使用 namespace class 防 CSS 冲突

---

# U. Light / Dark Theme

- [ ] Light 可读
- [ ] Dark 可读
- [ ] 对比度合理
- [ ] Theme 切换后 UI 更新
- [ ] 不使用状态大色块

---

# V. Long Text

- [ ] Parent 过长截断
- [ ] Current 过长截断
- [ ] Summary 过长截断
- [ ] Collapsed 永远单行
- [ ] Working 不无限增高
- [ ] 内部 overflow 正确

---

# W. ChatGPT SPA Lifecycle

- [ ] 切换 Chat 不丢 Panel
- [ ] 路由变化正确检测
- [ ] 新 Chat 正确初始化
- [ ] 刷新恢复
- [ ] ChatGPT React 重绘后 Panel 仍存在
- [ ] MutationObserver 不重复注入
- [ ] 一个页面只有一个 Panel instance

---

# X. Chat Context Switch

- [ ] chatId 更新
- [ ] project context 更新
- [ ] currentNode 更新
- [ ] parent 更新
- [ ] 上一个 Chat 的 UI 不残留
- [ ] 无 Node Chat 有空状态

推荐空状态：

```text
PARENT
—

CURRENT
—
```

---

# Y. Project Name

- [ ] 优先使用 Graph Project Name
- [ ] 有 fallback
- [ ] 长名称截断
- [ ] Collapsed 显示 Project Name
- [ ] Working Header 显示 Project Name

---

# Z. Persistence

保存：

- [ ] mode
- [ ] x/y
- [ ] width（如实现）
- [ ] currentNodeId
- [ ] focusedNodeId
- [ ] user-corrected parent relation
- [ ] current project/chat mapping

测试：

- [ ] refresh
- [ ] browser reopen
- [ ] chat switch

---

# AA. API Failure

Parent API failure：

- [ ] Current 仍已创建
- [ ] UI 可显示 `未判断`
- [ ] Change Parent 仍可用

Summary failure：

- [ ] Current 正常
- [ ] Parent 正常
- [ ] UI 有 fallback

核心：

- [ ] AI 失败永远不影响 ChatGPT 正常发送消息

---

# AB. Performance

- [ ] DOM Mutation debounce
- [ ] 不重复 API
- [ ] Message dedup
- [ ] Panel render 不全量重建 Graph
- [ ] scroll 不触发高成本逻辑
- [ ] 输入无明显卡顿

---

# AC. Accessibility

- [ ] buttons aria-label
- [ ] keyboard focus
- [ ] contrast
- [ ] Change Parent 可键盘操作
- [ ] collapse/detail button 有 title

---

# AD. UI Visual Acceptance

## Collapsed

```text
╭──────────────────────────────────────────────╮
│ Chat Graph · Parent: 悬浮窗 UI 设计       ▾ │
╰──────────────────────────────────────────────╯
```

必须：

- [ ] 一行
- [ ] 紧凑
- [ ] 圆角
- [ ] 不挡输入区

## Working

```text
╭──────────────────────────────────────╮
│ Chat Graph                       — ↗ │
├──────────────────────────────────────┤
│ PARENT                               │
│ 悬浮窗应该采用什么形式？             │
│                                      │
│                 ↓                    │
│                                      │
│ CURRENT                              │
│ 悬浮窗应该放什么内容？               │
│                                      │
│ SUMMARY                              │
│ 确定常驻悬浮面板中的核心信息。       │
├──────────────────────────────────────┤
│ ← Parent              Change Parent  │
╰──────────────────────────────────────╯
```

必须：

- [ ] 信息层级与稿一致
- [ ] 不增加额外默认模块
- [ ] Parent / Current 区分明显
- [ ] Summary 次一级
- [ ] 底部只保留关键动作

---

# AE. Manual Test Scenario 1

初始：

```text
Current = A
Parent = Root
```

发送 B：

- [ ] Enter 后 Current=B
- [ ] Parent=判断中
- [ ] AI 后 Parent=A

发送 C：

- [ ] Current=C
- [ ] Parent=B 或 AI 推荐节点

---

# AF. Manual Test Scenario 2 — Sibling

Graph：

```text
A
├── B
└── C
```

Current=B。

新问题属于 C 方向：

- [ ] Enter 后 Current=new
- [ ] AI 可以推荐 C / A
- [ ] 不默认 B
- [ ] UI 正确显示新的 Parent

---

# AG. Manual Test Scenario 3 — Unrelated

Current：

```text
Chat Graph UI
```

用户：

```text
IBKR 港股手续费是多少？
```

- [ ] Current 立即更新
- [ ] Parent 最终 Root / No Parent
- [ ] 不强连 Chat Graph UI

---

# AH. Manual Test Scenario 4 — Change Parent

- [ ] 打开 Change Parent
- [ ] 选择另一个 Node
- [ ] Confirm
- [ ] Working UI 更新
- [ ] Collapsed UI 更新
- [ ] Refresh 后保持

---

# AI. Manual Test Scenario 5 — Collapse

Working：

```text
Parent=A
Current=B
```

点击 `—`

- [ ] 收起
- [ ] 显示 Project + A
- [ ] 不显示 B
- [ ] 刷新后 mode 可恢复

---

# AJ. Manual Test Scenario 6 — Detail

点击 `↗`

- [ ] 打开插件详情页
- [ ] Graph 数据一致
- [ ] 当前 Project 一致
- [ ] floating panel 本身不复制 Full Graph

---

# AK. Third-stage Local Graph Exploration（允许探索）

第三层不是强制项，但 v0.6 **允许实现并验证**。

推荐定位：

```text
Local Graph
= Current 周围 1–2 层节点的临时放大视图
```

建议尝试：

- [ ] Parent
- [ ] Current
- [ ] Siblings
- [ ] Children
- [ ] 当前 focus
- [ ] 点击 Node 切换 focus
- [ ] 快速 Change Parent（如合适）

默认不要直接复制：

- [ ] Full Project Graph
- [ ] Project Search
- [ ] Inbox 全量管理
- [ ] Open Branches 项目级面板
- [ ] Project Settings
- [ ] 批量 Node 管理

如果实现，完成后必须评估：

- [ ] 与 Working State 的功能差异
- [ ] 与 Detail Page 的功能差异
- [ ] 是否减少进入 Detail Page 的次数
- [ ] 是否明显遮挡 ChatGPT
- [ ] 是否存在独立高频使用场景
- [ ] 给出 `Keep / Reduce / Remove` 结论
- [ ] 把结论写入 Agent 最终汇报
- [ ] 把结论同步到 Roadmap

---

# AL. Roadmap Update

必须新增：

```text
v0.6 — Persistent Floating Navigation Panel
```

包含：

- [ ] Collapsed State
- [ ] Working State
- [ ] Project + Parent collapsed UI
- [ ] Immediate Current update on Enter
- [ ] Parent async update
- [ ] Summary async update
- [ ] Change Parent
- [ ] Parent focus
- [ ] Detail page entry
- [ ] Drag/persistence

明确默认 Working State 不包含：

- [ ] Open Branches
- [ ] Status
- [ ] Full Current Path
- [ ] Full Graph

第三层探索：

- [ ] Local Graph / large expanded panel 可以实现
- [ ] Roadmap 标记为验证项
- [ ] 实现后给出 Keep / Reduce / Remove 结论

---

# AM. v0.6 Definition of Done

全部满足：

- [ ] Persistent Floating Panel 稳定
- [ ] Collapsed State 稳定
- [ ] Working State 稳定
- [ ] Collapsed 只 Project + Parent
- [ ] Enter 后 Current 立即更新
- [ ] Parent 异步判断
- [ ] Summary 异步生成
- [ ] Change Parent
- [ ] Root / No Parent
- [ ] Parent focus navigation
- [ ] Detail entry
- [ ] Drag / position persistence
- [ ] Chat switch 正确
- [ ] Refresh 正确
- [ ] API failure fallback
- [ ] 不显示 Status
- [ ] 不显示 Open Branches
- [ ] 不显示完整 Current Path
- [ ] 不显示 Full Graph
- [ ] 未实现第三层时不影响 v0.6 核心 DoD
- [ ] 若实现第三层，已完成与详情页的重复度评估
- [ ] Roadmap 已更新
- [ ] 测试通过

---

# AN. Agent 最终汇报格式

完成后输出：

```text
1. v0.6 实现概览
2. 修改文件列表
3. Floating Panel state model
4. Enter → Current 更新链路
5. Parent Recommendation UI
6. Change Parent 实现
7. Collapsed / Working UI
8. Panel persistence
9. Chat 切换处理
10. Detail page 跳转
11. 未实现项
12. Roadmap 更新
13. Third-stage Local Graph（如实现）的重复度评估与 Keep / Reduce / Remove 结论
14. Test results
15. Known limitations
```

不得只输出“完成”。
