# HomeStash

开源、本地优先的 AI 家庭库存平台。第一款产品是 **FreshMate — AI 智能冰箱贴**，陪你记住家里有什么、什么先吃、今晚怎么做。

当前版本：Phase 0 软件闭环已完成，按用户授权推进 Phase 1 首条 Korvo 硬件链路。SmartBadge 源码保持只读，仅在授权目录保存原板 Flash 备份。真机结果见 Phase 1 进度文档。

## 启动

需要 Node.js 22+（本机验证 24.16.0）、pnpm 9.15.9；当前启动脚本使用 macOS/Linux 的 lsof，Windows 可使用 WSL。无需 Docker。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

打开 http://127.0.0.1:3000 。生产预览使用 `pnpm build` 后运行 `pnpm start`。`pnpm dev` 先清理 3000/3100 端口，再启动 Core，等待健康检查后启动 Web；Ctrl+C 结束两个服务。不要让这些端口承载其他需要保留的服务。

默认 Mock 模式无需密钥。数据库首次启动自动建立在 `data/homestash.db`，不向官方云同步。重启保留库存、事件、设置、设备和做饭进度。备份时先停 Core，再复制数据库文件；运行中不要只复制 db 而遗漏 WAL。

## 十分钟 Demo

1. 首页或“添点新鲜”输入：`买了两个西红柿、一盒草莓和十个鸡蛋。`，点击发送。
2. 查看库存中番茄2个、草莓1盒、鸡蛋10个；首页“今天先吃”出现草莓，日期注明估算。
3. 在库存编辑包装日期、数量和位置；试用开封、部分消耗、用完、丢弃，并展开事件记录。
4. 输入 `今晚两个人吃什么？`，出现3道本地规则食谱，显示用到的库存和缺少的材料。
5. 选择番茄炒蛋“开始做饭”，点击下一步/上一步，问“放多少？”或“还要多久？”。
6. 打开“冰箱贴”，发送心跳上线，点击模拟“下一步”，LCD 与烹饪页同步。
7. 点击录音开关，输入文字模拟设备语音；切 Wi-Fi/在线、电量和休眠，模拟 Camera 事件。45秒不发心跳会离线，重新发送即可上线。
8. 设置中切换默认/温柔/猫猫人格；也可以选择自托管或外部 OpenAI-compatible 服务。

浏览器验收在当前本机数据库留下以上3条示例食材与番茄炒蛋进度，均为普通可编辑数据。全新安装不自动插入演示数据。

## 能力与真实程度

| 能力 | 当前状态 |
| --- | --- |
| 通用 InventoryItem、七类物品、位置、家庭/成员模型 | 已实现；运行时单家庭，无登录 |
| 添加/修改/消耗/丢弃/移动/开封/过期/补货 API、事件历史 | 真实 SQLite 持久化；常用动作有界面 |
| 今天先吃、临期/过期 | 本地规则，建议日期可人工修改 |
| 自然语言→结构化意图→Domain→Database | 已实现；默认有限规则 Mock |
| OpenAI-compatible Provider | HTTP adapter 和本地契约测试通过；百炼 qwen-plus 已真实接通 |
| 食谱/缺货/烹饪问答 | 本地模板与规则，不是生成式模型结果 |
| Device Simulator | 软件模拟；按钮/文字语音/Camera事件/LCD/电量/网络/休眠 |
| STT / TTS | 百炼真实接口已接通；真机验收见 Phase 1 进度 |
| Vision | 尚未接入识图，模拟 Camera 不改变库存 |
| PWA | manifest、图标、离线提示；未验收移动端安装/真机 |
| Korvo 固件 | 完成只读审计、独立固件和 ESP-IDF 构建；真机状态见 Phase 1 进度 |

日期和新鲜度只作提醒，不能保证食品安全。药品只管理库存，不提供诊断/剂量/服药建议。当前服务只绑定本机，不提供公网认证、云同步、BLE、OTA、微信或完整 App。

## 配置 AI

在 `.env` 填写 AI_API_KEY（本地模型可不填），重启 Core；在设置中选择 OpenAI-compatible，填写带 `/v1` 的服务根地址和模型名称。外部服务会收到你发送的文字，库存数据库保留本机。密钥不进入浏览器、SQLite 或 ESP32。

环境变量 AI_PROVIDER、AI_BASE_URL、AI_MODEL 只作为未保存设置时的默认值。已经在界面保存的设置优先；更换服务时通过界面更新。错误响应、超时、非法结构化输出不会改变库存，也不会静默回退成 Mock 假装成功。

## 目录

```text
apps/web/                    Next.js FreshMate 界面与集成模拟器
services/kitchen-core/       Fastify 独立本地 Core
packages/domain/            通用实体、schema、Repository 接口、库存服务
packages/database/          Drizzle SQLite 与版本化 migration
packages/ai/                Provider、Mock Parser、人格、Structured Intent
packages/protocol/          设备事件、命令、状态、媒体契约
packages/recipes/           库存推荐与 Cooking Mode
packages/api-client/        同源 API 客户端
firmware/freshmate-korvo/    Phase 1 分层边界（未实现固件）
docs/                       架构、协议、审计和验收说明
scripts/                    本地启动/端口清理
tests/                      SQLite/API/Provider 集成验收
data/                       本机运行数据（Git 忽略）
```

## 检查

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

测试使用系统临时目录或 SQLite 内存库，不改开发数据库、不接 SmartBadge。`pnpm build` 生成 Next.js 生产产物并验证共享 TypeScript；Core 由 tsx 直接运行。构建不等于部署或真实硬件验收。

详细说明：[固件审计](docs/FIRMWARE_REUSE_AUDIT.md)、[架构](docs/ARCHITECTURE.md)、[协议](docs/DEVICE_PROTOCOL.md)、[验收记录](docs/PHASE_0_ACCEPTANCE.md)、[参与开发](CONTRIBUTING.md)。

## 下一步

在确认 Phase 0 后，Phase 1 使用现有 ESP32-S31-Korvo-1 V1.1：复用 BSP/audio/SD/LCD，抽离网络和录音任务，新增 Core WAV 接收、STT/TTS、设备认证与 FreshMate PTT app，跑通按键→录音→库存→speaker/LCD/Web。无需新 ESP32 或 E-Ink；LCD 缺失时可先用 Web/串口。本阶段正在进行，不能将编译成功视为完整真机验收。

开源许可证待项目所有者确定，暂不擅自指定 MIT 或其他许可证。未来导入第三方固件保留原许可及来源。

## Phase 1 开发进度

独立 Korvo 固件已可构建，百炼真实 ASR / LLM / TTS 已接入。真机验收和仍未实现的能力详见 [Phase 1 进度](docs/PHASE_1_PROGRESS.md)；构建、配置、备份与烧录步骤见 [固件说明](firmware/freshmate-korvo/README.md)。

`pnpm hardware:build` 编译固件；`pnpm dev` 在配置设备 Token 时增加设备端口 3101。不要把百炼 Key 写入设备配置。模拟器仍可独立使用。

设备屏幕文字可通过 `pnpm hardware:status` 自动读取，或在 Web 的“真实开发板”区域查看。断电恢复与播报缓存回归测试记录见 [恢复验收](docs/RECOVERY_VALIDATION.md)。
