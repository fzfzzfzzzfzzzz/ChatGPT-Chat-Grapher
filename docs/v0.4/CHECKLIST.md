# ChatGPT Discussion Map v0.4 — Development Checklist

> 当前采用单用户全量云快照以尽快验证 MVP；实现边界见 [../MVP_STATUS.md](../MVP_STATUS.md)。

## 1. Supabase 初始化

- [ ] 创建 Supabase Project
- [ ] 配置环境变量
- [ ] 创建 users/profile 逻辑
- [ ] projects 表
- [ ] branches 表
- [ ] chats 表
- [ ] branch_chats 表
- [ ] decisions 表
- [ ] open_questions 表
- [ ] graph_events 表
- [ ] tombstones / deleted_at 策略
- [ ] 建立必要索引

## 2. Auth

- [ ] Sign Up
- [ ] Login
- [ ] Logout
- [ ] Session restore
- [ ] Auth error UI
- [ ] Token refresh
- [ ] Delete Account
- [ ] Logout 后本地数据策略

## 3. RLS

- [ ] projects RLS
- [ ] branches RLS
- [ ] chats RLS
- [ ] branch_chats RLS
- [ ] decisions RLS
- [ ] open_questions RLS
- [ ] graph_events RLS
- [ ] 用户 A 无法读用户 B 数据
- [ ] 用户 A 无法写用户 B 数据

## 4. Local-first Sync

- [ ] syncQueue 表
- [ ] 本地 mutation 自动入队
- [ ] Background sync
- [ ] Online 检测
- [ ] Offline 状态
- [ ] Retry
- [ ] Exponential backoff
- [ ] Sync Status
- [ ] Manual retry

## 5. Upsert

- [ ] Project upsert
- [ ] Branch upsert
- [ ] Chat upsert
- [ ] BranchChat upsert
- [ ] Decision upsert
- [ ] OpenQuestion upsert
- [ ] GraphEvent append

## 6. Delete / Tombstone

- [ ] Branch delete
- [ ] Project delete
- [ ] Chat unlink
- [ ] Tombstone sync
- [ ] 另一设备不会恢复已删除节点
- [ ] Tombstone 清理策略

## 7. Conflict Resolution

- [ ] updatedAt 比较
- [ ] last-write-wins
- [ ] parentId conflict
- [ ] status conflict
- [ ] delete conflict
- [ ] 冲突日志
- [ ] UI 不因冲突崩溃

## 8. v0.3 → v0.4 Migration

- [ ] 本地 schema v4
- [ ] migration test
- [ ] 首次登录上传现有本地数据
- [ ] 防止重复 upload
- [ ] migration 中断可恢复
- [ ] migration 完成标记

## 9. AI Provider 抽象

- [ ] AIProvider interface
- [ ] BYOK provider
- [ ] Managed provider placeholder
- [ ] Provider selector
- [ ] 百炼调用逻辑不耦合 UI
- [ ] API Key 永不上传 Supabase

## 10. 安全

- [ ] API Key 不进入 sync payload
- [ ] API Key 不进入 export
- [ ] API Key 不进入 logs
- [ ] Supabase key 权限正确
- [ ] RLS 测试
- [ ] HTTPS only
- [ ] 敏感错误信息脱敏

## 11. Export

- [ ] JSON export
- [ ] Project export
- [ ] All projects export
- [ ] Markdown summary export
- [ ] Export version metadata
- [ ] 不包含 API Key

## 12. Import

- [ ] JSON import
- [ ] Version check
- [ ] Schema validation
- [ ] Duplicate handling
- [ ] Conflict handling
- [ ] Invalid file error

## 13. Data Deletion

- [ ] Delete single Project
- [ ] Delete all local data
- [ ] Delete all cloud data
- [ ] Delete account
- [ ] Confirmation dialog
- [ ] 删除完成反馈

## 14. Onboarding

- [ ] Welcome
- [ ] 产品说明
- [ ] 隐私说明
- [ ] 创建第一个 Project
- [ ] 填写 Goal
- [ ] 创建第一个 Branch
- [ ] 可选设置百炼
- [ ] 完成引导

## 15. Multi-device Test

- [ ] Device A 创建 Project
- [ ] Device B 自动出现
- [ ] A 创建 Branch
- [ ] B 同步
- [ ] B Resolve
- [ ] A 同步
- [ ] A 离线编辑
- [ ] B 在线编辑
- [ ] A 恢复网络
- [ ] 冲突策略正确
- [ ] 删除同步正确

## 16. Release Gate

- [ ] 两台设备稳定同步
- [ ] 离线可继续工作
- [ ] 无数据丢失
- [ ] 删除不复活
- [ ] RLS 测试通过
- [ ] API Key 不上云
- [ ] v0.3 数据可迁移
- [ ] Export / Import 可用
- [ ] Delete Account 可用
- [ ] 无阻塞级同步 bug
