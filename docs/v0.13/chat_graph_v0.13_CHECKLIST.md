# Chat Graph v0.13 Implementation Checklist

> 配套文件：`chat_graph_v0.13_PRD.md`  
> 核心目标：让问题节点轻量展示附件、图片和 Assistant 回答引用，并保留原消息定位能力。

## A. Scope 与样本

- [x] 确认引用作为问题节点附属信息，不创建独立图节点
- [x] 锁定 `file` / `image` / `assistant_quote` 三种类型
- [x] 为三种 ChatGPT DOM 结构保存脱敏测试 fixture
- [ ] Chrome 真实页面捕获验收
- [ ] Firefox 真实页面捕获验收

## B. 数据模型

- [x] 增加 `QuestionReference` 联合类型
- [x] 增加通用 `ReferenceLocator`
- [x] `CapturedQuestion` 支持引用
- [x] `QuestionCandidate` 支持引用
- [x] `QuestionNode` 支持引用
- [x] 老数据缺失引用时安全降级为空数组
- [x] 引用数量、摘录和缩略图大小限制集中定义

## C. ChatGPT Adapter

- [x] 新增引用提取模块
- [x] 提取文件名、MIME 和大小
- [x] 提取图片名称、替代文本和缩略图
- [x] 提取 Assistant 回答引用摘录
- [x] 建立用户/Assistant 引用定位器
- [x] 引用去重并保持 DOM 顺序
- [x] 提取异常不得阻断问题捕获
- [x] 虚拟历史批量建图携带引用

## D. Service 与持久化

- [x] Candidate 创建时保存引用
- [x] Candidate 提升为 Node 时保留引用
- [x] 直接建 Node 时保存引用
- [x] 一键线性建图保存引用
- [x] 消息定位信息细化时不丢失引用
- [x] 删除 Node 后不残留外部资源（缩略图内联随 Node 删除）

## E. 消息与浮窗状态

- [x] `FloatingPanelGraphNode` 返回引用计数
- [x] Current 状态返回引用摘要
- [x] 增加按引用来源定位消息
- [x] 后台命令支持用户与 Assistant 角色
- [x] 内容脚本定位并高亮指定角色消息

## F. 图与详情 UI

- [x] 详情问题节点显示引用计数徽标
- [x] 节点徽标点击不触发 Current 切换
- [x] 紧凑节点悬浮提示显示引用计数
- [x] 节点详情展示文件引用
- [x] 节点详情展示图片缩略图
- [x] 节点详情展示 Assistant 引用摘录
- [x] 每条引用提供“定位原文”
- [x] 图片不可用时显示占位状态
- [x] 引用列表满足键盘和读屏访问

## G. 备份、搜索与隐私

- [x] 备份 schema 支持引用字段
- [x] 导入校验引用类型、长度、MIME 与大小
- [x] 导入旧备份时兼容缺失引用
- [x] 搜索支持文件名和回答摘录
- [x] 默认不向 AI Provider 发送引用内容
- [x] 更新中英文 README 数据边界
- [x] 更新中英文隐私政策
- [x] 更新 Roadmap、Changelog 与发布说明

## H. 测试

- [x] 文件引用提取测试
- [x] 图片引用与缩略图降级测试
- [x] Assistant 引用提取测试
- [x] 引用去重与限制测试
- [x] Candidate → Node 引用保留测试
- [x] 一键建图引用保留测试
- [x] 用户/Assistant 双角色定位测试
- [x] 图节点引用徽标交互测试
- [x] 节点详情引用渲染测试
- [x] 备份引用往返与恶意数据校验测试
- [x] TypeScript 编译通过
- [x] Vitest 全量测试通过（184 项）
- [x] Chrome / Firefox 生产构建通过

## I. 发布验收

- [ ] 附件、图片、回答引用均可在图中识别
- [x] 刷新后引用仍可查看（IndexedDB 持久化字段）
- [x] 原文存在时可以定位（自动化覆盖 Assistant 与现有用户定位）
- [x] 原文不存在时本地信息仍存在
- [x] 大量引用不会显著破坏图布局（节点仅显示聚合徽标）
- [x] 普通问题捕获与导航无回归
