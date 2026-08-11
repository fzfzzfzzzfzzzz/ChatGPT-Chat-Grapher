# v0.12.0 实现状态

当前实现已在 v0.5 Question Graph 导航核心上加入 V0.6 常驻浮窗：收起态、工作态、Enter 后即时 Current、Parent / Summary 异步状态、轻量候选确认、Manual Change Parent、Parent focus 导航、详情页入口、拖动与位置/模式记忆均已进入主流程。

v0.7–v0.8.1 进一步加入浮窗图视角、节点右键详情/状态/删除、一键建图、项目级消息去重，以及对 ChatGPT 虚拟化历史的完整捕获与旧问题定位。v0.9.0 将父节点推荐升级为多厂商配置，并将浮窗调整为 Current 优先布局、统一节点菜单、单行暂停提示和全项目节点图视角；图视角支持缩放、拖动与适应全部节点。浮窗数据操作现在由统一后台命令层直接返回最新状态，当前界面不再依赖广播刷新。

原问题定位以当前 ChatGPT 页面为边界：定位时先按消息 ID、Turn ID、锚点与文本指纹查找当前页面，即使早期根节点保存的会话标识已经变化，只要原问题仍在本页即可滚动并高亮。跨页面自动打开会话暂不属于 v0.12 范围。侧栏完整图与浮窗图视角均为首次单击设为 Current、再次单击确认定位原问题，右键可查看详情、标记状态或删除；侧栏搜索页签可检索当前项目的 question / summary。

节点状态与父子结构相互独立：所有新节点默认为待讨论，新增子节点、改 Parent、批量建图和删除重挂均不自动修改状态，已完结状态只由用户手动设置。

浮窗只承担项目、Current、父节点、摘要、全节点图视角与关键导航动作；侧栏默认以 Current + Parent 展示当前讨论，并保留待讨论列表和项目级节点管理。

已从主实现删除 v0.2–v0.4 的 Decision/OpenQuestion 知识抽取、AI Review、Search、Context Packet、Supabase 登录/云快照与同步队列。当前重新加入的 JSON 导入导出只备份 Question Graph 结构，不恢复旧知识库模型，也不包含 AI 设置或 API Key。

自动化测试覆盖数据最小化、去重、Forest、人工改 Parent、循环保护、焦点持久化、Open Branches、Undo、删除重挂、IndexedDB 重开、Parent JSON 解析、100 Node 布局，以及浮窗的即时 Candidate、Current/Focus 区分、候选确认、后台命令响应和真实按钮点击。
