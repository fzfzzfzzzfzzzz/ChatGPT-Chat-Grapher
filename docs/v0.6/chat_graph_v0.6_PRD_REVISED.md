# Chat Graph v0.6 PRD

> 版本：v0.6  
> 目标读者：Coding Agent / Product Agent  
> 产品形态：ChatGPT 网页版浏览器插件 + 页面内常驻悬浮窗  
> 本版本核心：**让用户在聊天时持续知道“当前项目、当前问题、父问题”，并能快速修正 Parent；完整 Graph 管理继续留在插件详情页。**

---

# 0. Agent 执行要求

开始实现前，必须先阅读：

1. 当前项目 Roadmap
2. v0.5 PRD / Checklist
3. 当前悬浮窗相关代码
4. 当前插件详情页 Graph 实现
5. 本 v0.6 PRD / Checklist

完成 v0.6 时必须：

- 更新现有 Roadmap；
- 明确 v0.6 已完成的悬浮窗能力；
- 不重新引入 v0.5 已删除的复杂 Node 字段；
- 不把悬浮窗做成插件详情页的缩小复制品；
- 不新增 Open Branches 到默认悬浮窗；
- 不在悬浮窗默认展示 status；
- 允许探索第三层“大展开态 / Local Graph”，但实现后必须评估它与插件详情页的功能重复度，并给出 Keep / Reduce / Remove 结论。

---

# 1. v0.6 产品目标

v0.5 已经把 Chat Graph 的核心数据模型收敛为：

```text
question
summary
status
```

并围绕 Parent Recommendation、Current Node、Graph、原始聊天定位等能力建立结构。

v0.6 的目标不是继续扩张 Graph 数据能力，而是解决：

> 用户在 ChatGPT 中持续聊天时，如何以最小干扰方式知道自己当前正在讨论什么，以及这个问题从哪个父问题延伸而来。

因此 v0.6 聚焦：

1. 页面内 Persistent Floating Panel；
2. 收起态；
3. 工作态；
4. Enter 后 Current Node 即时更新；
5. Parent Recommendation 的 UI；
6. Manual Parent Correction；
7. 悬浮窗 ↔ 插件详情页分工；
8. UI 稳定性、拖动、位置记忆。

---

# 2. 产品界面分层

v0.6 的基础界面层级为：

```text
ChatGPT 页面
   │
   ├── 悬浮窗收起态
   │
   └── 悬浮窗工作态
            │
            ├── 可选：第三层大展开态 / Local Graph
            │
            └── ↗ 打开插件详情页
```

第三层不是必须长期保留的固定结构，而是 **v0.6 可以实现并验证的探索项**。

它要验证的核心问题是：

> 用户是否需要在不离开 ChatGPT 的情况下，临时获得比工作态更大的局部 Graph 视野？

如果第三层只是把插件详情页缩小后塞进悬浮窗，则应收缩或删除；如果它能承担“Current 周围局部节点快速浏览 / focus 切换”等独立高频任务，则可以保留。

---

# 3. 悬浮窗定位

悬浮窗的产品定义：

> **当前讨论导航器。**

它不负责管理整个项目。

悬浮窗主要回答：

1. 我现在在哪个项目？
2. 我当前讨论的问题是什么？
3. 当前问题的 Parent 是什么？
4. Parent 如果判断错了，我能否立即改？
5. 我是否要回上一层？
6. 我是否要打开完整 Graph？

---

# 4. v0.6 明确不做

## 4.1 不在悬浮窗展示 Open Branches

Open Branches 继续属于插件详情页。

原因：

- 它是项目级回顾信息；
- 不属于每轮聊天必须常驻的信息；
- 容易让悬浮窗变得拥挤。

## 4.2 不默认展示 Status

Node 数据结构继续保留：

```text
active
pending
resolved
parked
rejected
```

但悬浮窗不显示：

```text
● Active
```

Status 属于 Graph 管理信息，在详情页使用。

## 4.3 不在悬浮窗显示完整 Current Path

v0.6 默认只展示：

```text
Parent → Current
```

而不是：

```text
Root → A → B → C → Current
```

完整路径属于 Graph 浏览行为，应放在详情页。

## 4.4 不在悬浮窗显示完整 Graph

悬浮窗不承担：

- Tree / Forest 全局浏览；
- 节点大规模拖动；
- Inbox 整理；
- Search；
- Open Branches；
- Status 管理；
- 批量节点操作。

这些留在插件详情页。

---

# 5. Node 数据边界

v0.6 不修改 v0.5 的 Node 业务字段规则。

Node 用户内容：

```ts
question: string
summary: string
status: NodeStatus
```

允许必要 metadata：

```ts
id
parentId
projectId
chatId
messageId / messageAnchor
createdAt
updatedAt
```

禁止重新加入：

```text
reason
resource
decision
routes
alternatives
answer
evidence
```

---

# 6. 核心交互：Enter 后立即更新 Current Node

这是 v0.6 的核心交互规则之一。

当用户在 ChatGPT 输入框输入新问题，并按下 Enter 发送：

```text
用户按 Enter
    ↓
插件捕获新 User Message
    ↓
立即创建 Candidate Node
    ↓
立即：
Current Node = 新问题
    ↓
悬浮窗立即更新 Current
    ↓
后台生成 summary
    ↓
后台进行 Parent Recommendation
    ↓
Parent 更新
```

关键要求：

> **不能等待 GPT Answer 完成以后才更新 Current Node。**

Current Node 表示：

> 用户现在正在探索的问题。

而不是：

> GPT 已经回答完成的问题。

---

# 7. Current 更新期间的 UI 状态

刚按 Enter：

```text
CURRENT
悬浮窗应该放什么内容？

PARENT
判断中…
```

AI Parent Recommendation 完成后：

```text
PARENT
插件悬浮窗应该怎么设计？

CURRENT
悬浮窗应该放什么内容？
```

如果 summary 尚未返回：

```text
SUMMARY
生成中…
```

但不得阻塞 Current 更新。

---

# 8. 悬浮窗两态设计

v0.6 只有：

1. Collapsed
2. Working

---

# 9. UI Design — Collapsed State

## 9.1 设计目标

收起状态必须做到：

- 极低遮挡；
- 用户能知道当前 Project；
- 用户能知道 Current Node 是从哪个 Parent 延伸来的；
- 点击即可恢复 Working State。

## 9.2 UI 线框稿

### 有 Parent

```text
┌───────────────────────────────────────────────┐
│ Chat Graph   ·   Parent: 悬浮窗 UI 设计    ▾ │
└───────────────────────────────────────────────┘
```

说明：

```text
Chat Graph
↑
Project Name

Parent: 悬浮窗 UI 设计
↑
Current Node 的直接父节点
```

右侧 `▾` 点击展开 Working State。

### Root / No Parent

```text
┌──────────────────────────────────┐
│ Chat Graph   ·   Root         ▾ │
└──────────────────────────────────┘
```

### Parent Recommendation 仍在处理

```text
┌──────────────────────────────────────┐
│ Chat Graph   ·   Parent: 判断中…  ▾ │
└──────────────────────────────────────┘
```

## 9.3 收起态不显示

禁止：

```text
Current Node
Summary
Status
Open Branches
完整 Path
Graph
Inbox
Search
```

---

# 10. UI Design — Working State

## 10.1 推荐尺寸

默认建议：

```text
Width: 320–380px
Height: auto / 约 250–360px
```

实际尺寸可根据现有 UI 调整。

要求：

- 不需要一次占据 500×600；
- 保持轻量；
- 内容多时内部滚动，而不是无限增长。

## 10.2 主 UI 线框稿

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

---

# 11. Working State 信息结构

优先级固定：

```text
Header
↓
Parent
↓
Current
↓
Summary
↓
Navigation / Correction Actions
```

---

# 12. Header

```text
┌────────────────────────────────────────┐
│ Chat Graph                         — ↗ │
└────────────────────────────────────────┘
```

### 左侧：Project Name

例如：

```text
Chat Graph
金融工作台
面试评分
```

### `—`

收起到 Collapsed State。

### `↗`

打开当前 Project 对应的插件 Graph 详情页。

如果项目详情定位暂时无法实现，则至少打开 Graph 主页面。

---

# 13. Parent Section

固定区域：

```text
PARENT

插件悬浮窗应该采用什么形式？
```

要求：

- 显示 question；
- 不显示 parent summary；
- 可点击；
- 点击可以将其设为 Focus / Current Navigation Target；
- 可配合底部 `← Parent`。

如果无 Parent：

```text
PARENT

Root
```

---

# 14. Current Section

固定区域：

```text
CURRENT

悬浮窗应该放什么内容？
```

要求：

- Enter 后立即更新；
- 始终显示完整或合理截断的当前问题；
- 允许 hover / click 查看完整文本；
- Current Question 不应被 summary 替换。

---

# 15. Summary Section

```text
SUMMARY

确定常驻悬浮面板中需要展示的信息。
```

要求：

- 1–2 句；
- 允许异步生成；
- 未生成时显示 `生成中…`；
- API 失败时使用 fallback；
- 不显示 answer；
- 不显示 reason/resource/decision。

---

# 16. Bottom Actions

默认只放：

```text
← Parent               Change Parent
```

不放：

```text
Delete
Export
Search
Inbox
Open Branches
Root
Merge
Edit Summary
Settings
```

这些属于详情页或二级菜单。

---

# 17. `← Parent` 行为

点击 `← Parent` 含义：

> 将当前讨论 focus 切换到直接 Parent。

注意：这不是修改 Graph 结构。

例如：

```text
A
└── B
    └── C  ← current
```

点击后 focus 变成 B。

下一条新问题 Parent Recommendation 应更重视 B。

已有 `C.parentId = B` 保持不变。

---

# 18. Change Parent

点击：

```text
Change Parent
```

打开轻量浮层。

UI：

```text
┌──────────────────────────────────────┐
│ Change Parent                        │
├──────────────────────────────────────┤
│ Search nodes…                        │
│                                      │
│ ○ 插件 UI 设计                       │
│ ● 悬浮窗设计                         │
│ ○ Firefox / Chrome 方案              │
│ ○ No Parent / Root                   │
│                                      │
│                    Cancel   Confirm  │
└──────────────────────────────────────┘
```

要求：

- 当前 Parent 默认选中；
- 提供 No Parent / Root；
- 支持搜索或候选 Node；
- Confirm 后立即更新 Graph；
- 防止 cycle；
- 持久化用户修正。

---

# 19. Parent Recommendation — High Confidence

High confidence 时：

- 自动连接；
- 不弹大型窗口；
- Working State Parent 自动更新。

可轻量显示：

```text
✓ Parent 已更新：悬浮窗 UI 设计    Undo
```

2–4 秒后消失。

---

# 20. Parent Recommendation — Medium Confidence

如果 AI 无法高置信度判断：

```text
┌────────────────────────────────────────┐
│ Chat Graph                         — ↗ │
├────────────────────────────────────────┤
│ SELECT PARENT                          │
│                                        │
│ ○ 悬浮窗 UI 设计              78%      │
│ ○ 插件整体 UI                 66%      │
│ ○ No Parent                            │
│                                        │
│                             Confirm    │
├────────────────────────────────────────┤
│ CURRENT                                │
│ 悬浮窗应该放什么内容？                 │
└────────────────────────────────────────┘
```

用户选择后恢复标准 Working State。

---

# 21. Parent Recommendation — Low Confidence

Low confidence：

- 不强行连；
- 默认 Root / No Parent；
- 可留待详情页整理；
- 不弹大确认窗阻断聊天。

---

# 22. 悬浮窗位置

v0.6 使用页面内 Overlay Floating Panel。

推荐默认：

```text
top-right
```

例如：

```css
position: fixed;
top: 80px;
right: 24px;
```

具体数值按当前页面适配。

要求：

- 不覆盖 ChatGPT 输入框；
- 尽量不盖右侧关键操作；
- 页面滚动时保持固定；
- ChatGPT DOM 更新时不丢失。

---

# 23. 拖动

v0.6 建议支持拖动。

行为：

- 拖 Header 移动；
- 记录最终位置；
- 刷新后恢复；
- 限制窗口不允许完全拖出 viewport。

不要求多窗口。

---

# 24. Resize

v0.6 可选支持轻量 resize。

如果实现：

```text
min-width: 280px
max-width: 520px
max-height: 70vh
```

但 Resize 不是 v0.6 的硬性核心。

优先级：

```text
稳定悬浮 > Current 即时更新 > Parent > UI 完整 > Resize
```

---

# 25. Shadow DOM

如果当前实现尚未使用 Shadow DOM，v0.6 推荐考虑：

```text
chat-graph-host
   ↓
shadowRoot
   ↓
floating panel
```

目的：

- 避免 ChatGPT CSS 影响插件；
- 避免插件 CSS 污染 ChatGPT；
- 提高 UI 稳定性。

如果迁移风险过高，不要求为了 v0.6 强制重写。

---

# 26. 悬浮窗与详情页职责边界

## Floating Panel 负责

```text
Project
Parent
Current
Summary
Parent Navigation
Change Parent
Parent Recommendation
Open Detail Page
```

## Detail Page 负责

```text
Full Graph
Current Path
Open Branches
Inbox
Status
Search
Node Details
Node Reorganization
Set Root
Delete Node
Project-level Management
```

---

# 27. 第三层“大展开态 / Local Graph”探索

v0.6 **允许实现第三层大展开态**。它是探索项，不预设最终一定保留，也不预设一定删除。

可能结构：

```text
收起态
  ↓
工作态
  ↓
大展开态 / Local Graph
  ↓
插件详情页
```

第三层优先探索的定位是 **Local Graph**，而不是 Full Graph：

```text
             Parent
               │
     ┌─────────┼─────────┐
  Sibling    Current    Sibling
               │
        ┌──────┴──────┐
      Child          Child
```

它可以尝试解决：

- 不离开 ChatGPT 就查看 Current 周围 1–2 层关系；
- 快速查看 Parent / Siblings / Children；
- 点击 Node 快速切换 discussion focus；
- 快速确认或修正 Parent；
- 在进入详情页之前获得局部结构感。

第三层默认不要直接复制这些项目级能力：

- Full Project Graph；
- Search；
- Inbox 全量管理；
- Open Branches 项目级面板；
- Project Settings；
- 批量 Node 管理。

## 27.1 与详情页的重复度评估

如果 Agent 实现第三层，必须在完成后进行对比：

| 能力 | Working State | 第三层 Local Graph | Detail Page |
|---|---|---|---|
| Parent / Current | 是 | 是 | 是 |
| Summary | 是 | 可选 | 是 |
| Current 周围局部关系 | 否 | **核心** | 是 |
| 快速切换 focus | 基础 | **核心** | 是 |
| Full Graph | 否 | 原则上否 | **核心** |
| Search | 否 | 原则上否 | 是 |
| Inbox | 否 | 原则上否 | 是 |
| Open Branches | 否 | 原则上否 | 是 |
| Project 管理 | 否 | 否 | 是 |

实现后必须回答：

1. 第三层是否比 Working State 多解决了一个明确问题？
2. 它是否减少了用户进入详情页的次数？
3. 它是否只是在更小空间里复制详情页？
4. Overlay 变大后是否明显妨碍 ChatGPT 使用？
5. 最终应该 Keep、Reduce 还是 Remove？

保留标准：

> **第三层必须有独立于详情页的高频任务。**

目前最值得验证的独立任务：

> **Local Graph：Current 周围 1–2 层节点的快速浏览与 focus 切换。**

---

# 28. Detail Page 的入口

Working State 中：

```text
↗
```

点击：

```text
打开当前 Project 的完整 Graph
```

Collapsed State 不强制提供 `↗`。

---

# 29. UI 状态图

```text
                    ┌───────────────┐
                    │   Collapsed   │
                    │ Project+Parent│
                    └───────┬───────┘
                            │ expand
                            ↓
                    ┌───────────────┐
                    │    Working    │
                    │ Parent        │
                    │ Current       │
                    │ Summary       │
                    └───┬───────┬───┘
                        │       │
              collapse  │       │ ↗
                        ↓       ↓
                  Collapsed   Detail Page
```

Parent uncertain：

```text
Working
  ↓
Parent Confirmation
  ↓
Working
```

---

# 30. Enter Interaction UI 稿

发送前：

```text
PARENT
插件 UI

CURRENT
悬浮窗采用什么形式？
```

用户输入并按 Enter：

```text
悬浮窗应该放什么内容？
```

立即：

```text
PARENT
判断中…

CURRENT
悬浮窗应该放什么内容？

SUMMARY
生成中…
```

AI 完成：

```text
PARENT
悬浮窗应该采用什么形式？

CURRENT
悬浮窗应该放什么内容？

SUMMARY
确定常驻悬浮面板的信息结构。
```

---

# 31. 长文本处理

Question 太长：

- 默认最多显示 2–3 行；
- 超出使用 ellipsis；
- hover / click 查看完整文本。

Summary 最多 2–4 行。

Collapsed State 永远保持单行。

---

# 32. Loading / Error

Summary API 失败：

```text
SUMMARY
暂时无法生成摘要
```

Parent API 失败：

```text
PARENT
未判断
```

用户仍可使用 Change Parent。

插件 AI 失败绝不能阻止 ChatGPT 正常发送消息。

---

# 33. 页面生命周期

必须处理：

- ChatGPT SPA 路由变化；
- 切换 Chat；
- 新 Chat；
- 页面刷新；
- DOM 重绘；
- Panel 被 ChatGPT React 重绘误删；
- 当前 Project / Chat 映射变化。

悬浮窗应自动恢复。

---

# 34. 当前 Chat 切换

当用户切换 Chat：

1. 识别新 chatId；
2. 加载对应 Graph context；
3. 更新 Project；
4. 更新 Current；
5. 更新 Parent；
6. 不保留错误的上一个 Chat UI 状态。

如果该 Chat 尚无 Node：

```text
PARENT
—

CURRENT
—
```

---

# 35. Project Name

收起态必须显示 Project Name。

项目名称来源优先级：

1. 已绑定 Project；
2. Graph 项目名称；
3. 当前 Chat 对应默认 Project；
4. fallback：`Chat Graph`。

---

# 36. UI 视觉原则

推荐：

- 轻量；
- 中性；
- 与 ChatGPT 风格协调但不完全复制；
- 小阴影；
- 中等圆角；
- 明确层级；
- Header 可拖；
- 不使用大量高饱和颜色。

---

# 37. UI Design — Light Mode 草图

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

视觉建议：

```text
background: light neutral
border: 1px subtle
shadow: medium
radius: 12–16px
```

---

# 38. UI Design — Dark Mode 草图

结构完全一致，不额外增加功能：

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

跟随浏览器 / ChatGPT theme 或当前插件已有 Theme 逻辑。

---

# 39. Collapsed State UI 细节

推荐：

```text
╭──────────────────────────────────────────────╮
│ Chat Graph · Parent: 悬浮窗 UI 设计       ▾ │
╰──────────────────────────────────────────────╯
```

宽度建议：

```text
220–360px
```

如果太长：

```text
Chat Graph · Parent: 悬浮窗应该采用什…
```

---

# 40. Parent 为空时

Working State：

```text
PARENT
Root

CURRENT
IBKR 港股手续费是多少？
```

不要出现：

```text
None
null
undefined
```

---

# 41. 详情页继续承担的 UI

v0.6 不要求重做详情页，但必须确保入口兼容。

详情页至少继续支持：

```text
Full Graph
Node select
Parent edit
Status
```

已有 Open Branches / Inbox / Search 则保留。

尚未实现的继续留在 Roadmap，不要硬塞进悬浮窗。

---

# 42. v0.6 数据状态

建议新增或明确：

```ts
type FloatingPanelState = {
  mode: "collapsed" | "working"
  x?: number
  y?: number
  width?: number
  currentNodeId?: string
  focusedNodeId?: string
}
```

---

# 43. Current vs Focus

示例：

```text
A
└── B
    └── C
```

当前：

```text
Current = C
Focus = C
```

点击：

```text
← Parent
```

变成：

```text
Current = C
Focus = B
```

下一条用户问题 D：

AI Parent Recommendation 应优先考虑 B。

发送 D 后：

```text
Current = D
Focus = D
```

---

# 44. 不要混淆 UI 的 Parent 与 Focus

悬浮窗 `PARENT` 永远表示：

```text
currentNode.parentId
```

而不是 focusedNode。

Focus 不属于 v0.6 必须展示 UI。

---

# 45. Debug

开发模式可记录：

```text
User Message detected
Candidate created
Current updated
Summary request
Parent candidates
Parent result
Panel render
```

生产 UI 不显示技术日志。

---

# 46. 性能要求

悬浮窗不能：

- 每次 DOM mutation 全量重渲染 Graph；
- MutationObserver 高频触发大量 AI API；
- 导致 ChatGPT 输入卡顿；
- 每次 scroll 重新计算全部 Node。

推荐：

- debounce；
- stable dedup；
- local state；
- incremental rendering。

---

# 47. Accessibility

至少：

- 按钮有 title / aria-label；
- Keyboard focus 可见；
- Change Parent 可键盘操作；
- 颜色不是唯一状态表达；
- 收起/展开按钮可访问。

---

# 48. v0.6 验收使用流程

用户打开 ChatGPT：

```text
Chat Graph · Parent: Root
```

点击展开：

```text
PARENT
Root

CURRENT
怎么做 Chat Graph 插件？
```

发送：

```text
悬浮窗应该采用什么形式？
```

Enter 后：

```text
CURRENT
悬浮窗应该采用什么形式？

PARENT
判断中…
```

随后：

```text
PARENT
怎么做 Chat Graph 插件？
```

继续发送：

```text
悬浮窗应该放什么内容？
```

自动：

```text
PARENT
悬浮窗应该采用什么形式？

CURRENT
悬浮窗应该放什么内容？
```

点击 `—`：

```text
Chat Graph · Parent: 悬浮窗应该采用什么形式？
```

点击 `↗`：

打开完整 Graph 详情页。

---

# 49. v0.6 Definition of Done

必须：

- [ ] 页面内常驻悬浮窗稳定存在
- [ ] Collapsed State 完成
- [ ] Working State 完成
- [ ] 收起态只显示 Project + Parent
- [ ] Enter 后 Current Node 立即更新
- [ ] Parent 异步更新
- [ ] Summary 异步更新
- [ ] 不等待 GPT Answer 更新 Current
- [ ] 不在悬浮窗显示 Status
- [ ] 不在悬浮窗显示 Open Branches
- [ ] 不在悬浮窗显示 Full Current Path
- [ ] 默认 Working State 不显示完整 Full Graph
- [ ] Change Parent 可用
- [ ] No Parent / Root 可用
- [ ] `← Parent` 可用
- [ ] `↗` 可打开详情页
- [ ] Panel 可收起/展开
- [ ] Panel 位置可持久化
- [ ] 刷新后恢复
- [ ] Chat 切换后 UI 正确更新
- [ ] AI API 失败不影响 ChatGPT 使用
- [ ] Roadmap 更新
- [ ] 不新增 v0.5 明确删除的复杂 Node 字段
- [ ] 若实现第三层 Local Graph，完成与详情页的重复度评估并记录 Keep / Reduce / Remove 结论

---

# 50. Roadmap 更新要求

Roadmap 新增：

```text
v0.6 — Persistent Floating Navigation Panel
```

包含：

```text
- Persistent overlay panel
- Collapsed State
- Working State
- Project + Parent collapsed UI
- Immediate Current Node update on Enter
- Parent async recommendation
- Summary async generation
- Change Parent
- Parent navigation
- Detail page entry
- Drag + persistence
```

明确标记：

```text
Not in default Working State:
- Open Branches
- Status
- Full Current Path
- Full Graph

Exploration allowed in v0.6:
- Third-stage expanded panel / Local Graph
- Must compare with Detail Page before deciding whether to keep it
```

---

# 51. 最终产品约束

Agent 必须遵循：

> ChatGPT 保存聊天内容，Chat Graph 保存讨论结构。

> 悬浮窗负责当前讨论，详情页负责整个项目。

> Current 在 Enter 后立即更新，不等待 GPT。

> 悬浮窗默认只需要 Parent + Current + Summary。

> 收起态只需要 Project + Parent。

> Status 保留在数据里，但不占悬浮窗 UI。

> Open Branches 放详情页，不进入 v0.6 悬浮窗。

> 第三层大展开态可以探索，但不能默认复制详情页；实现后必须评估其独立价值和功能重复度。
