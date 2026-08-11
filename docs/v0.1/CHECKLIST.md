# ChatGPT Discussion Map v0.1 — Development Checklist

## 1. 项目初始化

- [x] 创建 WXT 项目
- [x] 启用 React
- [x] 启用 TypeScript strict
- [x] 配置 Manifest V3
- [x] 限定 ChatGPT 页面匹配范围
- [x] 创建 background/service worker
- [x] 创建 content script
- [x] 创建 side panel entrypoint
- [x] 配置开发构建
- [x] 配置生产构建

## 2. 基础 UI

- [x] CurrentBranchBadge
- [x] SidePanelLayout
- [x] ProjectHeader
- [x] GoalDisplay
- [x] Breadcrumb
- [x] ActiveBranchCard
- [x] ChildBranchList
- [x] PendingBranchList
- [x] Empty State
- [x] Delete Confirm Dialog

## 3. Branch 操作

- [x] Create Project
- [x] Edit Project
- [x] Delete Project
- [x] Create Root Branch
- [x] Create Child Branch
- [x] Rename Branch
- [x] Edit Description
- [x] Move Branch / 设置 parentId
- [x] Set Active
- [x] Resolve
- [x] Park
- [x] Reject
- [x] Delete
- [x] Return Parent

## 4. 数据层

- [x] 安装 Dexie
- [x] 建立 projects 表
- [x] 建立 branches 表
- [x] 建立 chats 表
- [x] 建立 branchChats 表
- [x] 建立 schema version 1
- [x] Project repository
- [x] Branch repository
- [x] Chat repository
- [x] BranchChat repository
- [x] 基础事务处理
- [x] 数据初始化
- [x] Demo seed（开发环境）

## 5. ChatGPT 页面集成

- [x] 检测当前域名
- [x] 仅识别可定位的 Conversation 路径
- [x] 注入 Badge
- [ ] Badge 不遮挡 ChatGPT 关键控件
- [x] 获取当前 URL
- [x] 尝试获取 Conversation Title
- [x] 当前 URL 改变时刷新关联状态
- [x] SPA 导航监听
- [x] 无法解析标题时安全降级

## 6. Graph

- [x] 安装 React Flow
- [x] Branch → Node 转换
- [x] parentId → Edge 转换
- [x] Active 节点标识
- [x] Pending 节点标识
- [x] Resolved 节点标识
- [x] Parked 节点标识
- [x] Rejected 节点标识
- [x] 点击节点切换详情
- [x] Fit View
- [x] Center Active Node
- [x] Zoom / Pan

## 7. Chat 关联

- [x] 绑定当前 Chat 到 Branch
- [x] 一个 Branch 支持多个 Chat
- [x] Branch Detail 显示 Chat 链接
- [x] 点击打开原 Chat
- [x] 防止重复绑定同一 URL

## 8. 状态规则

- [x] 每个 Project 最多一个 active
- [x] 切 active 时旧 active 自动 pending
- [x] resolved 不能自动重新 active
- [x] parked 需要显式恢复
- [x] parent 删除时处理 children
- [x] Project 删除时级联清理

## 9. 测试

- [x] 创建 1 个 Project
- [x] 创建 20 个 Branch
- [x] 创建 5 层嵌套
- [x] 快速切换 Active
- [x] Resolve 后返回 Parent
- [x] Park / Resume
- [x] 绑定多个 Chat
- [x] 页面刷新
- [ ] Chrome 重启
- [x] IndexedDB 数据保留
- [ ] 100 节点 Graph 渲染性能测试

## 10. v0.1 Release Gate

- [x] 无 AI 依赖
- [x] 无后端依赖
- [x] 核心数据不依赖 ChatGPT DOM
- [x] 核心流程可完整走通
- [ ] 无阻塞级 bug
- [x] README 写明安装方式
- [x] README 写明数据保存在本地

> 2026-08-08 验证记录：自动化测试覆盖 20 分支、6 层路径、快速 Active 切换、多 Chat 去重、父分支恢复、分支移动、Conversation URL 校验、IndexedDB 重开和 100 节点数据转换；本地浏览器预览已走通核心 UI 流程。100 节点真实 React Flow 渲染、Badge 遮挡和 Chrome 重启仍需在加载真实扩展的 Chrome + ChatGPT 页面中验收。实现取舍见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。
