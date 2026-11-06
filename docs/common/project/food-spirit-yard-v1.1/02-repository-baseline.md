# 仓库初查与可复用基线

初查日期：2026-11-05。此处记录当前工作树，不代表远程部署、所有历史分支或真机版本均相同。新会话实施前重新核对。

## 工作区

`/Users/susu/code/homestash` 是已注册的 Codex 本地项目。当前有大量未提交改动：文档由旧平铺路径迁移到 `docs/common` 和板级目录；固件由旧 `firmware/freshmate-korvo`/`firmware/common` 调整为 apps/shared/platforms/boards 分层；同时已有 T5 平台、诊断工程、测试与构建工具。新路径大量仍为未跟踪状态，不得只看 Git HEAD 就判断它们不存在，也不能按删除清单自动恢复旧目录。

本次任务书只是新增于 `docs/common/project/food-spirit-yard-v1.1/`，没有修改业务代码、数据库或现有固件。

## 技术栈和入口

- pnpm 9.15.9 workspace，Node >=22，TypeScript；`apps/web` 为 Next.js 16 / React 19 / Tailwind 4。
- `services/kitchen-core/src/app.ts`：Fastify 业务 Core，旧版库存、烹饪、购物与图片候选链路。
- `services/kitchen-core/src/device-server.ts`：设备独立鉴权，录音/JPEG/心跳/屏幕/音频下载；默认设备端口 3101。
- `packages/ai/src/index.ts`：旧库存结构化意图、persona、mock 和 OpenAI-compatible Provider。
- `packages/ai/src/speech.ts`：`SpeechProvider`，百炼 ASR/TTS，完整 Buffer 输入输出，ffmpeg 采样格式转换。
- `packages/protocol/src/index.ts`：设备消息/能力与模拟器契约；扩展时兼容既有字段。
- `packages/database/src/index.ts`：Drizzle/SQLite，`app_state` 及事务；当前 migration 文件为 `0001_initial.sql`，不改历史迁移。
- `apps/web/app/app/page.tsx`、`apps/web/components/fridge-demo.tsx`：需继续跟踪旧后台与模拟器页面；项目不是 `apps/web/src` 结构。
- `scripts/dev.mjs` 和 `scripts/lib/local-network.mjs`：现有启动与端口准备，执行前以源码确认行为。架构文档中的旧登录描述可能与当前脚本不同，不能仅据文档改认证。

可优先复用鉴权、配置、设备心跳、请求 ID/幂等回执、SQLite 事务、媒体目录模式、AI Provider 接口、Web 代理与现有显示/触摸适配。新意图不能复用库存 `Intent` 并悄悄调用 InventoryService。

## T5 真实基线

依据：`firmware/targets.json`、`firmware/boards/tuya-t5-ai/README.md`、`docs/hardware/tuya-t5-ai/bring-up.md` 及对应 evidence。

- 目标名 `tuya-t5-ai`；板型 `tuya-t5-ai-board-v1.02`。
- 锁定 TuyaOpen v1.5.0，SDK commit `e92da87549fa1a2e079584fb12a4493e6bbbd863`；T5 平台 commit `046792bf3443b62994b6d4bc795fcbf42b305eb5`。
- 文档记录 0.6.4 已烧录并逐字节回读。用户已确认横屏逻辑 480×320 的中文显示、六个导航按钮和触摸切页正常。
- Wi-Fi/Core 联网、板上 SD 挂载和音频采录播放的完整闭环仍待真机验收。源码适配与交叉编译通过≠上述外设通过。
- SD 持久化使用独立 `/sdcard/homestash-t5`；无卡保护不允许录音。用户旧卡已备份，不能重构时格式化或破坏隔离。
- 摄像头未配、未移植。`firmware/boards/tuya-t5-ai/src/hs_optional.c` 的 `hs_camera_*` 返回不支持，当前 capability 未开启相机。
- `hs_audio.c` 的本地唤醒/voice_poll/demo PCM 播放相关接口仍是不支持或空实现；不能把公共函数存在当成 T5 已支持免唤醒和本地提示播放。
- `hs_board.c` 当前输入主要为 GPIO12 按键；未在所查路径发现门传感器产品接入。用户确认有角度/运动传感器，需补型号/引脚/驱动证据后实现。
- 当前目标默认值仍可能是 `korvo-s31`，构建必须显式 `--board tuya-t5-ai`，防止误产出/误刷 ESP 固件。
- T5 BLE、HomeStash OTA、低功耗、Korvo 演示馆未移植，不借本次顺手扩范围。T5 不用 ESP `flash.py`/OTA 镜像校验器。

固件目录：`firmware/apps/freshmate` 为现有共用产品主循环；`firmware/shared/components/device_port/include` 为公共接口；`firmware/platforms/tuyaopen` 为运行时、网络、HTTP、配置和文件系统；`firmware/boards/tuya-t5-ai/src` 为音频/显示/按键等板级实现。

## 最容易误接的旧接口

1. `POST /device/v1/captures/:id` 当前 transcribe → `core.prepareVoice` → 旧业务提交 → `deviceReply`。直接把“买了草莓”送这里，会进入旧库存语义；新产品必须显式路由到新的食灵业务。
2. `POST /device/v1/images/:id` 当前调用 `core.imageIntake.analyze`，返回待确认的食材候选；默认不保留原图，debug 留样也不等于家庭相册。新回忆照片必须有独立用途和保存路径。
3. `GET /device/v1/captures/:id/audio` 当前取已保存文字回执，百炼生成音频、完整下载、转固定 WAV、磁盘缓存后返回。它不是端到端流式 TTS。
4. `firmware/platforms/tuyaopen/hs_transport.c` 当前获取完整 HTTP 音频响应后写 `HS_REPLY.tmp`，校验替换缓存，再由 `hs_audio_play` 播放。改云端为流式不自动消除板端完整等待。
5. `GET /device/v1/screen` 与板端页面当前是 home/inventory/freshness/recipes/cooking/shopping 六页，不能只换标题就当新世界实现。

旧库存主线保留于旧后台/旧产品路径；新入口、消息、持久化命名空间与界面要清楚分离。最小接通不是同时重建一套 Core、用户管理和设备管理。

## 语音补充调查

用户随后要求将“可爱语音延迟与可配置 TTS”纳入本次重构，详见 `05-tts-investigation.md`。该文件比 54 项清单中的笼统“流式语音”更具体，应纳入当前必做范围。初查结论是云端合成＋本地格式转换＋整段下载链路；尚无耗时分段测量，不认定“萌化”就是实际瓶颈。
