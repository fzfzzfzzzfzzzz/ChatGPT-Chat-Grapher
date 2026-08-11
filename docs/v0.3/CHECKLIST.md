# ChatGPT Discussion Map v0.3 — Development Checklist

> 当前先完成 MVP 主链路；实现边界见 [../MVP_STATUS.md](../MVP_STATUS.md)，未逐项完成完整 Release Gate。

## 1. Schema v3

- [ ] chats 增加 projectId
- [ ] chats 增加 conversationId
- [ ] chats 增加 lastVisitedAt
- [ ] branchChats 增加 relation
- [ ] migration v2 → v3
- [ ] 保证旧数据可迁移

## 2. Conversation Registry

- [ ] 当前 Chat 自动注册
- [ ] URL 去重
- [ ] Conversation ID 可选解析
- [ ] Conversation Title 更新
- [ ] lastVisitedAt 更新
- [ ] Chat Detail UI
- [ ] Chat List UI

## 3. 多对多 BranchChat

- [ ] 一个 Branch → 多 Chat
- [ ] 一个 Chat → 多 Branch
- [ ] primary relation
- [ ] supporting relation
- [ ] related relation
- [ ] 修改 relation
- [ ] 删除关联
- [ ] 防重复关系

## 4. Breadcrumb

- [ ] 根据 parentId 生成路径
- [ ] 当前 Branch 高亮
- [ ] 每级可点击
- [ ] 处理根 Branch
- [ ] 处理孤儿 Branch
- [ ] 处理循环引用保护

## 5. 新 Chat 归属

- [ ] 新 Chat 检测
- [ ] Project selector
- [ ] Branch selector
- [ ] Create New Branch
- [ ] 手动确认绑定
- [ ] 第一个问题后 AI 推荐
- [ ] 低置信度提示
- [ ] 用户可拒绝推荐

## 6. Branch Inbox

- [ ] Inbox 页面
- [ ] AI OpenQuestion 可进 Inbox
- [ ] 手动添加 Inbox
- [ ] Priority
- [ ] Start Discussion
- [ ] Create Branch
- [ ] Merge Existing
- [ ] Ignore
- [ ] Resolve
- [ ] Inbox 数量显示在 Badge

## 7. Return to Main Thread

- [ ] Resolve 后显示 Parent
- [ ] 显示 Sibling Pending
- [ ] 显示 Inbox Item
- [ ] Suggested Next Branch
- [ ] 一键切换 Parent
- [ ] 一键开始 Sibling
- [ ] 没有 Parent 时返回 Project root

## 8. Context Packet

- [ ] Project Goal
- [ ] Breadcrumb
- [ ] Current Branch title
- [ ] Current Branch objective
- [ ] Branch Summary
- [ ] Decisions
- [ ] OpenQuestions
- [ ] Related Chat titles
- [ ] Copy
- [ ] Insert into ChatGPT textbox
- [ ] 不自动发送
- [ ] 插入前允许预览和编辑

## 9. ChatGPT 输入框 Adapter

- [ ] 找到当前 composer
- [ ] Insert Text
- [ ] 不覆盖已有文本
- [ ] 处理 composer DOM 变化
- [ ] 不触发自动发送
- [ ] 插入失败安全提示

## 10. Search

- [ ] Search UI
- [ ] Branch search
- [ ] Decision search
- [ ] OpenQuestion search
- [ ] Chat title search
- [ ] URL search
- [ ] Result type filter
- [ ] 点击结果跳转详情
- [ ] 搜索性能测试

## 11. Graph View v3

- [ ] Branch 节点显示 Chat count
- [ ] Branch 节点显示 Decision count
- [ ] Branch 节点显示 OpenQuestion count
- [ ] 点击节点侧边详情
- [ ] 不把所有 Chat 强制画成主节点
- [ ] Active Branch 自动定位
- [ ] 大图 Fit View
- [ ] 100+ Branch 性能测试

## 12. AI Branch Recommendation

- [ ] 构造 candidate branch list
- [ ] 限制 candidate 数量
- [ ] Project Goal 注入
- [ ] Current Branch 注入
- [ ] Branch Summary 注入
- [ ] JSON Schema
- [ ] Confidence
- [ ] Low-confidence fallback
- [ ] Wrong recommendation 手动修正

## 13. 关键流程测试

- [ ] 一个 Project 创建 20 个 Chat
- [ ] 一个 Branch 关联 5 个 Chat
- [ ] 一个 Chat 关联 3 个 Branch
- [ ] 新 Chat 手动归属
- [ ] 新 Chat AI 推荐归属
- [ ] Inbox → Branch
- [ ] Branch resolve → Parent
- [ ] Context Packet → Insert
- [ ] Search → Open Branch
- [ ] Branch → Open original Chat

## 14. v0.3 Release Gate

- [ ] 用户可以解释每个 Chat 为什么存在
- [ ] 用户可以快速知道当前 Branch
- [ ] 用户可以看到未处理分支
- [ ] 用户可以完成支线后返回主线
- [ ] 用户可以从图返回相关 Chat
- [ ] 用户可以为新 Chat 带入结构化上下文
- [ ] 20+ Chat 项目仍可正常使用
