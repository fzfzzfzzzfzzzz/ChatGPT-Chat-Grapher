# ChatGPT Discussion Map v0.2 — Development Checklist

> 当前先完成 MVP 主链路；实现边界见 [../MVP_STATUS.md](../MVP_STATUS.md)，未逐项完成完整 Release Gate。

## 1. ChatGPT Adapter

- [ ] 创建 adapters/chatgpt 目录
- [ ] getConversationMeta
- [ ] getLatestUserMessage
- [ ] getLatestAssistantMessage
- [ ] getLatestTurn
- [ ] isAssistantStreaming
- [ ] SPA 路由变化监听
- [ ] DOM selector 集中配置
- [ ] 解析失败安全返回
- [ ] 编写 Adapter 单元测试

## 2. AI 设置

- [ ] Settings 页面
- [ ] API Key 输入
- [ ] API Key Mask
- [ ] Base URL 输入
- [ ] Model ID 输入
- [ ] Timeout 设置
- [ ] AI Enable / Disable
- [ ] Test Connection
- [ ] API Key 不进入日志
- [ ] Export 不包含 API Key

## 3. Service Worker AI Client

- [ ] bailianClient.ts
- [ ] host_permissions
- [ ] Content → Service Worker messaging
- [ ] Service Worker → API fetch
- [ ] Timeout
- [ ] Network error
- [ ] Non-200 status
- [ ] Rate limit error
- [ ] Retry button
- [ ] Response parsing

## 4. Structured Output

- [ ] 定义 Analyzer JSON Schema
- [ ] branch_match
- [ ] topic
- [ ] summary
- [ ] decisions
- [ ] open_questions
- [ ] operations
- [ ] confidence
- [ ] Schema validation
- [ ] Invalid JSON fallback

## 5. Prompt

- [ ] System Prompt
- [ ] 明确“不回答用户问题”
- [ ] 明确“只分析讨论结构”
- [ ] 明确“不能重写整张 Graph”
- [ ] 提供现有 Branch 列表
- [ ] 提供 Project Goal
- [ ] 提供 Current Branch
- [ ] 控制 Summary 长度
- [ ] 控制 OpenQuestion 数量
- [ ] 控制 Operation 类型

## 6. AI Review UI

- [ ] Analyze Turn button
- [ ] Loading State
- [ ] Current Branch Recommendation
- [ ] Confidence display
- [ ] Editable Summary
- [ ] Decisions list
- [ ] OpenQuestions list
- [ ] Proposed Operations list
- [ ] Accept individual item
- [ ] Reject individual item
- [ ] Edit individual item
- [ ] Accept All
- [ ] Apply Selected
- [ ] Cancel

## 7. 数据模型升级

- [ ] schema version 2
- [ ] decisions 表
- [ ] openQuestions 表
- [ ] graphEvents 表
- [ ] migration v1 → v2
- [ ] Decision repository
- [ ] OpenQuestion repository
- [ ] GraphEvent repository

## 8. Graph Operation Engine

- [ ] CREATE_BRANCH
- [ ] UPDATE_BRANCH
- [ ] SET_ACTIVE_BRANCH
- [ ] RESOLVE_BRANCH
- [ ] PARK_BRANCH
- [ ] ADD_DECISION
- [ ] ADD_OPEN_QUESTION
- [ ] Operation validation
- [ ] Apply transaction
- [ ] Rollback on failure

## 9. Undo

- [ ] GraphEvent 保存 before/after
- [ ] Undo latest event
- [ ] Undo 后 UI 更新
- [ ] 连续 Undo
- [ ] 不允许 Undo 到破坏 schema 的状态

## 10. Error Handling

- [ ] API 未配置
- [ ] API Key 错误
- [ ] Base URL 错误
- [ ] Model 不存在
- [ ] 请求超时
- [ ] JSON 无效
- [ ] ChatGPT DOM 解析失败
- [ ] Assistant 尚在 streaming
- [ ] 无最新 User Message
- [ ] 无最新 Assistant Message

## 11. 测试样例

- [ ] 当前问题仍属于同一 Branch
- [ ] 明确出现一个新子问题
- [ ] GPT 一次提出 5 个子问题
- [ ] 没有形成任何结论
- [ ] 已形成明确结论
- [ ] AI 推荐错误 Branch
- [ ] AI 输出重复 OpenQuestion
- [ ] API 返回非法 JSON
- [ ] 用户拒绝全部建议
- [ ] 用户编辑后接受

## 12. v0.2 Release Gate

- [ ] AI 永不自动改 Graph
- [ ] AI 失败不破坏手动功能
- [ ] API Key 不出现在日志/导出
- [ ] 所有 AI 修改可追溯
- [ ] 所有 AI 修改可撤销
- [ ] “分析本轮”完整流程可稳定运行
