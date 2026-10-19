# Phase 1 首条硬件链路进度

2026-10-18。用户已授权先将现有开发板固件备份到 SmartBadge，再刷 HomeStash；SmartBadge 源码和配置仍为只读。这里区分编译、软件集成和真实硬件证据。

## 已实现的软件和固件

- 独立 Korvo 工程、原样 BSP 与增益/WAV 工具、独立 Wi-Fi 命名空间。
- SET 录音与停止，SD 暂存、失败重试、双声道输入转换为 16 kHz 单声道 PCM WAV。
- Core 独立设备监听器，设备 ID + Bearer Token 认证；管理 API 仍只监听本机 3100。
- 音频 SHA-256 + 请求 ID 落库；库存和处理回执原子提交。TTS 下载独立重试，避免再次修改库存。
- 百炼 `qwen-plus` 负责结构化意图，`qwen3-asr-flash` 负责识别，`qwen3-tts-flash` / Cherry 负责播报。
- Web 区分真实设备心跳与模拟器；真实库存通过现有轮询同步。

当前云端语音会将录音发送至百炼；库存仍存储在本机 SQLite。API Key 只在 Core 环境变量中。首次 PoC 设备到 Core 使用局域网 HTTP，设备 Token 不应跨公网使用；远程场景需要 TLS。

## 当前验证

- ESP-IDF 固件构建成功，镜像小于 4 MB app 分区。
- 10 项软件测试通过，包括并发重试、重启重放、TTS 失败、音频格式和设备鉴权。
- 百炼真实 TTS → ASR → 结构化意图已通过，样本“买了两个西红柿。”正确返回数量 2。
- 上述百炼测试使用合成音频，不是真机麦克风证据。
- 2026-10-18 已完成 16 MB 原板备份与整片摘要校验，FreshMate 烧录写入校验通过。
- 真机启动确认 PSRAM、LCD、SD、ES8389 初始化成功、Wi-Fi 获得 IP；Core 连续收到认证心跳，Web 显示真实开发板在线。
- 真实 SET 按键录音已完成：用户说“买了两个西红柿”，Core 新增一批 2 个番茄（不覆盖此前软件 Demo 的批次），LCD 显示成功，设备下载 TTS 并进入播放；用户确认“听到了，内容正常”。
- 第一条硬件 Vertical Slice 验收通过，详见 `hardware-evidence/freshmate-20261018.json`。

## 使用

根目录 `.env` 设置百炼和设备参数，`data/hardware/device.env` 设置 Wi-Fi、Core LAN 地址和相同的设备 ID/Token。`pnpm dev` 先释放 3000、3100、3101，再启动。Web 访问 http://127.0.0.1:3000 。

`pnpm exec tsx scripts/hardware/probe-bailian.ts` 会真实调用三个模型并将音频和结果写到系统临时目录，不修改库存。需要已配置的 Key，会产生对应模型调用量。

设备 API：`POST /device/v1/heartbeat`、`POST /device/v1/captures/:uuid`（audio/wav）、`GET /device/v1/captures/:uuid/audio`。每次请求必须带 `Authorization: Bearer <设备Token>`、`X-Device-ID`。语音回执仅包含 ID、转写和响应文字；不返回云端 Key 或签名下载 URL。

## 未完成范围

首条按键录音及播报听感已验收；录音中物理断电恢复、原 ID 重试和播报已专项通过。复杂网络恢复和长时间运行仍待验证。Camera、BLE、OTA、AEC/NS/VAD 尚未接入，不应把 BSP 能力视为已完成产品功能。当前录音队列只有一条，不能连续离线批量采集。字体为子集，任意模型返回字形尚未完整覆盖。

## 官方接口依据

- [百炼 Qwen-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)：兼容 Chat Completions 的音频输入。
- [百炼 Qwen-TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)：生成音频 URL，Core 下载后转换成设备固定 WAV 格式。

## 原板恢复资产

完整备份位于 SmartBadge 本地忽略目录：`data/hardware/devices/1c2904d054a8/backups/before-homestash-20261018-verified/`，含 `manifest.json` 和 16 MB 镜像。SHA-256：`5e2e31789c7e5c52192e976c0978468832436ff4f739aca5bc00de3358b4599b`。已验证与设备备份时整片内容一致；恢复写回操作未执行。

## 录音恢复加固

已修复录音和 UUID 分开保存的中断窗口，以及 FAT 播报缓存覆盖失败；13 项测试通过。真实录音中拔掉全部供电再重连后，恢复相同 UUID 的 WAV，并完成上传、播放及清理，用户确认听感正常。库存和事件完整数据保持一致。现可通过 `pnpm hardware:status` 和 Web 直接查看实际 LCD 文字。详细验收及网络限制见 [恢复验收](RECOVERY_VALIDATION.md)。首条正常语音链路的历史验收仍保留，不能据此替代本次故障恢复测试。
