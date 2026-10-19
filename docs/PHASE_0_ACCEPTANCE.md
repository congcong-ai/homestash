# Phase 0 验收记录

日期：2026-10-17。环境：macOS、Node.js 24.16.0、pnpm 9.15.9、Next.js 16.4.2、Fastify 5.12.7、Drizzle 0.44.7、SQLite/better-sqlite3 12.11.1。精确依赖以 pnpm-lock.yaml 为准。

## 已完成

- HomeStash monorepo、FreshMate 首页/库存/添加/食谱/设备/设置六个功能视图。
- 七类通用库存、家庭与成员/位置基础模型、完整库存动作与事件历史、SQLite 持久化。
- 文字→Parser/Provider→Zod Intent→Domain→Database；批量事务、持久化幂等、错误不静默成功。
- 临期优先列表、库存匹配3道食谱、人数/缺货、Start/Next/Previous/Ask 和持久化做饭进度。
- Default/Gentle/Cat 人格、AI provider 设置、服务端环境密钥。
- LCD、Korvo按钮、文字语音、Camera事件、Wi-Fi、电量、在线/离线/心跳/休眠模拟。
- PWA manifest、离线提示、断连状态；移动尺寸响应式。
- 独立 firmware/freshmate-korvo 边界目录与 SmartBadge 只读审计。

## 软件检查

| 检查 | 结果 |
| --- | --- |
| pnpm lint | 通过 |
| pnpm typecheck | 通过，Web 包先运行 next typegen |
| pnpm test | 8组全部通过 |
| pnpm build | 通过，Next.js 生产页面生成成功 |
| pnpm start | 真实启动 Core 与 Next.js 生产服务 |
| 首页 /、同源 /api/health | HTTP 200；health 返回 HomeStash / phase 0 |
| SQLite 重启后读取 | 库存、事件、烹饪会话和幂等回执保留 |

测试不是只检查返回状态：实际断言数据库物品数量、事件数量/类型、批量失败回滚、回执写入失败回滚、重复ID并发和重启重放、同名物品歧义、非Food不参与推荐、过期过滤、非法数量/位置拒绝、模拟Camera不写库存、深睡眠拒绝、心跳过期、Provider HTTP 请求及非法JSON拒绝。

本机可复验日志：`/tmp/homestash-lint.log`、`/tmp/homestash-typecheck.log`、`/tmp/homestash-tests.log`、`/tmp/homestash-build.log`；HTTP输出 `/tmp/homestash-production-health.json`、`/tmp/homestash-production.html`。测试数据库使用临时目录或内存并自动清理。

## 浏览器实际 Demo

通过 Codex 浏览器实际点击：

1. 默认文字“刚买了两个番茄、一盒草莓和十个鸡蛋。”提交成功，显示2/1/10数量。
2. 今天先吃显示草莓及估算日期。
3. 输入“今晚两个人吃什么？”得到番茄炒蛋、番茄蛋花汤、草莓水果碗。
4. 选择番茄炒蛋开始做饭。
5. 进入冰箱贴，发送心跳上线，点击下一步，LCD 显示“第2步：热锅加少量油，倒入蛋液炒至凝固后盛出”。
6. Core/页面重新连接后库存与第2步保留；生产页面正常显示。
7. 开发服务切换期间离线提示生效，重连恢复。

截图 `/tmp/homestash-device.png`。本次没有桌面宽屏逐像素验收、手机真机安装验收或真实硬件验收。响应式界面已在当前窄窗口查看。

## Mock 与尚未实现

- Mock AI 是有限中文规则解析器；外部 OpenAI-compatible adapter 已做本地HTTP契约测试，但没有真实外部模型联调。
- 食谱为本地模板，Cooking Ask 是规则问答。
- 录音由文字模拟；Camera 只模拟元数据；电量/网络/休眠不代表真实硬件测量。
- STT、TTS、Vision、BLE、OTA、设备认证/配对、多家庭登录、云同步、微信、完整App均未实现。
- 当前仅本机监听，不开放给局域网或公网。浏览器断开 Core 不支持离线写库存。
- 尚未决定开源许可证。只初始化本地 Git，没有创建远程、commit、push 或 PR。

## SmartBadge 与后续

SDK 是锁定提交的 ESP-IDF 6.2 开发基线；不是稳定正式发布承诺。BSP 的音频、按键、LED、SD、LCD/Touch可原样复用；Camera BSP 可保留但需真板验证。Wi-Fi、录音/播放任务、SD恢复、HTTP传输需要从工牌 UI/配置/业务抽离。员工归属、模板、工牌 API/COS合约及工牌页面为 BADGE_ONLY。详细版本/引脚/来源见 Firmware Reuse Audit。

Phase 1 首条链路需新增认证与媒体接收、STT/TTS、FreshMate PTT状态机、LCD view model、下载播放和异步网络任务。使用已有 ESP32-S31-Korvo-1 V1.1，无需新 ESP32 或 E-Ink；现有 LCD 不在手头时可先用 Web/串口，不要求额外采购。

最大的技术风险是 S31 开发版 SDK 与音频/显示/网络同时运行的稳定性，尤其共享 I2S 切换和阻塞网络请求导致控制延迟。软件侧主要限制是有限 Mock 语法、模板食谱、缺少真实 AI/媒体评估。建议先人工体验 Phase 0 并确认意图与库存规则，再单独授权 Phase 1 真板闭环。本次停在 Phase 0。
