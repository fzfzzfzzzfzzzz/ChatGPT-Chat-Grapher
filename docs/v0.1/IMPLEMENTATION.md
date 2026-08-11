# ChatGPT Discussion Map v0.1 — Implementation Notes

## 已确认的实现取舍

- PRD 中的 UI 技术建议为 Tailwind CSS；v0.1 实际使用组件级手写 CSS。产品行为与视觉验收范围不变，这能让 Side Panel 与 Shadow DOM Badge 共享更少的构建依赖。后续版本如形成稳定设计系统，再评估迁移 Tailwind。
- Chrome 使用 `sidePanel.open()`，最低版本为 116；Firefox 使用 `sidebarAction.open()`，最低版本为 115。两个目标共享同一套 React 侧边栏界面。
- Chrome 构建申请 `sidePanel` 与 `storage`；Firefox 构建只申请 `storage`，由 `sidebar_action` 打开原生侧边栏。两个构建均不申请可读取所有标签页元数据的全局 `tabs` 权限。
- 只有包含 `/c/{conversationId}` 的 ChatGPT URL 才能作为当前对话关联；首页、设置页和无 ID 的 `/c/` 均安全降级为“无可关联对话”。
- 点击“恢复并返回父问题”属于用户显式恢复操作，可重新激活 resolved、rejected 或 parked 的父分支；不会由后台自动恢复。

## 工具链边界

- Node.js：`>=22.22.2`
- Chrome：`>=116`
- Firefox：`>=115`
- 数据：Dexie + IndexedDB，本地保存
- 扩展：WXT + React + TypeScript + Manifest V3

## 当前验证边界

`npm run check` 负责 TypeScript、Vitest 和 Chrome / Firefox 生产构建。自动化测试中的 100 节点项目只验证 Branch → React Flow 数据转换；真实渲染流畅性、Badge 与 ChatGPT 控件的空间冲突、以及浏览器重启后的持久化仍属于发布前人工验收项。

兼容性依据：[Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)、[Firefox sidebarAction API](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)、[WebExtensions 消息传递](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)。
