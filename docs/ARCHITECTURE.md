# HomeStash 架构与 Phase 0 边界

HomeStash 是开源、本地优先的 AI 家庭库存平台；FreshMate 是第一款食品/厨房产品。本文落实三个 KORVO_V2 文档及用户最新命名/硬件约束；原始需求文档保留原样。当前只实现 Phase 0。

## 执行链

Web/Device Simulator → Fastify Kitchen Core → AIProvider/Parser → Zod Structured Intent → InventoryService → Repository → Drizzle/SQLite。

Domain 不导入 Next.js、Fastify、Drizzle 或 Korvo。InventoryItem 支持七类家庭物品，Location、Household、HouseholdMember 独立。单家庭 local 是当前运行方式；多家庭登录、授权和切换未实现。FreshMate 的食谱仅读取 food 类别，不提供医学建议。

SQLite 保存物品快照、不可覆盖的事件、设备、设置、烹饪会话与幂等回执。事件包含前后快照；数量为0仍保留历史。InventoryService 校验动作与位置，Repository 在事务中同步保存当前值和事件。AI 批量动作、设备事件与请求回执在同一个事务中提交；同请求 ID 重放返回原结果，内容改变则拒绝。异步 AI 调用在事务外完成，再串行提交，避免持锁等待网络。Phase 0 是单 Core 进程；不支持多进程写协调。

初始迁移 `packages/database/migrations/0001_initial.sql` 通过 schema_migrations 检查仅执行一次。后续表结构变更新增编号 migration 并扩展 runner，不修改已执行文件。Drizzle 表以 JSON 存储通用库存快照，SQL 表保留独立实体/事件，方便早期领域迭代；大规模检索应新增列/索引迁移。

## 推荐和日期

Freshness Engine 按到期日期、建议食用日期、食品开封后2天的最早时间计算 fresh/eat_soon/urgent/expired。默认日期按 UTC 日界线，Phase 0 不支持家庭时区设置。规则只作提醒，包装日期可以手动修改，不能保证食品安全。模拟解析器建议日期标记 estimatedDate，用户可以覆盖。过期食品不进入可用食谱库存。

本地 Recipe Engine 从4个明确模板匹配现有食材，返回3道菜，按人数缩放，标注已有/缺少食材；单位无法匹配时要求核对，不猜换算。缺货清单由食谱推导，无预测采购。Cooking Mode 保存食谱快照、当前步骤和问答；烹饪不自动扣库存，由用户确认实际消耗。

## AI 与隐私

MockAIProvider 是明确的有限中文规则解析器，无外部调用。OpenAICompatibleProvider 真实实现 `/chat/completions` HTTP adapter，带超时、JSON 请求、Zod 结果校验；没有真实服务密钥时不声称模型联调成功。测试用本地 HTTP 服务验证契约和错误路径。通过 Provider 接口可扩展官方云或本地模型，当前不实现官方云。STT/TTS/Vision 只保留可选能力接口。

用户选择外部 provider 后会向其发送输入文字和结构化意图 schema，不发送完整库存数据库；界面明确说明。API Key 只通过 Core 环境注入，不在数据库、浏览器或固件保存。Settings 只公开 keyConfigured 布尔值。默认 mock 不需要 Key、不依赖微信或官方云。

## Web 和服务边界

Next.js 是客户端与同源 `/api` 代理，Fastify 是独立 Core。当前端口 3000/3100 只监听127.0.0.1，Core 拒绝未知浏览器 Origin。未实现账号或真实设备认证，不能直接暴露公网。手机尺寸响应式已实现；手机真机访问需后续配置局域网绑定及认证，不把本机预览称为真机验收。

原生语义表单/按钮与Tailwind CSS 与统一组件样式构成当前界面；没有引入企业后台模板。PWA manifest、图标与离线提示已实现；Core 离线时不能写库存，不缓存 API 的旧响应伪装实时状态；浏览器每3秒刷新状态，断连显示上次读取提示。

模拟器集成在 Web 的“冰箱贴”页，共用 packages/protocol，不建立重复 UI 工程。设备可以模拟按键、文本语音、拍照元数据、Wi-Fi、电量、在线/离线、休眠；心跳45秒过期，手动发送便于测试离线。没有真实媒体处理或物理电量测量。

## 固件边界

`firmware/freshmate-korvo` 只有职责说明。Board/Drivers → Device Capability → FreshMate App 的边界已经定义，但没有提前实施 Phase 1。BSP 来源、引脚与 SDK 以只读 SmartBadge 审计为准。尤其 Camera BSP 存在不等于工牌应用已抓图，BLE/OTA/TTS 仍需新增。

## Phase 1：真实设备接入

新增独立设备监听器 3101，仅提供认证后的录音和心跳接口。Web/Core 管理 API 保持 loopback；设备不能访问设置接口。百炼 Key 仅驻留 Core。`SpeechProvider` 不接触数据库：ASR 文本经既有结构化意图和 Domain Service 提交；TTS 在提交后独立生成和缓存。

固件已在 `firmware/freshmate-korvo` 独立构建，BSP 来源和哈希见 `FIRMWARE_IMPORT_MANIFEST.json`。此次用户明确允许将原开发板完整 Flash 备份保存到 SmartBadge 的忽略目录；该授权不包括修改 SmartBadge 源码。

## 录音持久化与重试

设备在 SD 独立目录中以 UUID 文件名保存录音。`.part` 表示录制过程，校验并同步后转换成 `.wav`；已完成播报的文件先转换成 `.done` 再清理。重新启动可用已落盘的完整样本补全录音长度；未知或损坏格式保留并报错。

待上传录音的字节和 UUID 在重试时保持不变。Core 将音频 SHA-256、Domain 变更和处理回执绑定到同一幂等键；HTTP 响应丢失不等于库存事务失败。语音合成和播放在库存提交后独立重试，不能因为播报失败重新执行库存操作。
