# v0.6.0 实现状态

当前实现已在 v0.5 Question Graph 导航核心上加入 V0.6 常驻浮窗：收起态、工作态、Enter 后即时 Current、Parent / Summary 异步状态、轻量候选确认、Manual Change Parent、Parent focus 导航、详情页入口、拖动与位置/模式记忆均已进入主流程。

跨会话导航现在会优先复用同一浏览器配置中已打开的目标会话；未打开时提供新标签页、当前页和取消选择。完整 Graph 与浮窗图谱均为首次单击设为 Current、再次单击确认定位原问题，右键只更新节点状态；侧栏搜索页签可检索当前项目的 question / summary。

浮窗只承担 Project、Parent、Current、Summary 与关键导航动作；Current Path、Open Branches、Inbox、Status、Full Graph 和节点管理继续留在侧栏详情页。

已从主实现删除 v0.2–v0.4 的 Decision/OpenQuestion 知识抽取、AI Review、Search、Context Packet、导入导出、Supabase 登录/云快照与同步队列。

仍需真实浏览器人工验收的部分：

- ChatGPT DOM 更新后的发送按钮、composer 与 user-message selector
- 新 Chat 从无 conversation id 到 `/c/{id}` 的路由切换捕获
- 跨 Chat 跳转后的精确 message anchor 命中率
- Chrome / Firefox 真实侧栏与 100 Node React Flow 性能
- ChatGPT 页面明暗主题属性在真实账号配置下的切换表现
- 浮窗拖动位置在多显示器、浏览器缩放和极窄窗口下的恢复边界

自动化测试覆盖数据最小化、去重、Forest、人工改 Parent、循环保护、焦点持久化、Open Branches、Undo、删除重挂、IndexedDB 重开、Parent JSON 解析、100 Node 布局，以及 V0.6 浮窗的即时 Candidate、Current/Focus 区分、候选确认、跨 Chat 空状态与 API 失败状态。
