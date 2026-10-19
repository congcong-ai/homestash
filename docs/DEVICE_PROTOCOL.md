# HomeStash 设备协议 v1（Phase 0）

运行 schema 位于 `packages/protocol/src/index.ts`。当前设备 ID 固定 korvo-simulator，仅本机模拟；Phase 1 要新增认证、设备注册与真实媒体端点，不能把模拟接口直接暴露给未认证网络。

POST `/api/device/events`：

```json
{"version":1,"eventId":"ad66b83f-522e-4353-bbde-b8be40b9d353","deviceId":"korvo-simulator","at":"2026-10-17T05:00:00.000Z","payload":{"type":"HEARTBEAT","battery":86,"wifi":true,"online":true}}
```

所有 envelope 必须有版本、UUID eventId、deviceId、ISO 时间。服务器以接收时间计算 lastSeen，不能由设备时间伪造在线；45秒无心跳即离线。同 ID 内容必须一致。幂等回执跨 Core 重启保留，不自动清空。

| 事件 | 内容 | 当前行为 |
| --- | --- | --- |
| HEARTBEAT | battery 0–100、wifi、online | 更新状态；Wi-Fi断开强制离线 |
| BUTTON_PRESSED | SET/NEXT/PREVIOUS | 录音开关或推进烹饪；没有烹饪会话时报错 |
| VOICE_CAPTURED | simulated:true、text | 文本→Provider→Intent→Domain→SQLite |
| CAMERA_CAPTURED | simulated:true、1280×720、image/jpeg | 记录事件次数/显示反馈，不识别、不入库 |
| POWER_CHANGED | active/idle/light_sleep/deep_sleep | 模拟电源模式；深睡眠拒绝业务操作直到唤醒 |

返回 device、message 与 commands。DISPLAY_RENDER 含文本；SET 另返回 START_RECORDING/STOP_RECORDING。PLAY_AUDIO 类型仅预留，不产生假音频。

真实录音基线来自 SmartBadge：16kHz、16bit、mono WAV；采集端双声道混单声道。AudioDescriptor 预留 mediaId、mime、采样参数、bytes、sha256。Camera 预留 JPEG 与实际协商宽高。Phase 1 使用独立有限大小上传/校验端点产生 mediaId，再在事件引用；不使用 JSON base64 大包。先用 HTTP 请求/响应，暂不需要 WebSocket/MQTT，后续 transport 可替换而不改变库存 Domain。

## Phase 1 媒体传输

实际首条链路采用独立 3101 监听器：认证后直接向 `/device/v1/captures/:uuid` 上传固定头 PCM WAV，避免 JSON 中传输大段 Base64。服务端以设备 ID、录音 UUID 和 SHA-256 绑定处理回执，跨重启复用；同 ID 不同音频返回 409。成功返回 `{id,text,message}`。

TTS 通过同 ID 的 `/audio` 子资源按需获取，输出固定 44 字节头的 WAV，16 kHz / 单声道 / 16 bit，最大 60 秒。库存提交成功但 TTS 失败时不回滚库存，设备保留录音并用原 ID 重试。服务端缓存语音，不缓存云端 Key 或下载签名。心跳不携带音频。

模拟设备 JSON 协议仍保留，真实板不会伪装为 `korvo-simulator`。

## 实际 LCD 状态上报

真实设备心跳可包含 `screen`、`network`、`screenRevision` 和 `uptimeMs`。`screen` 来自固件实际调用 LCD 更新函数时保存的文字，包含恢复、上传和播报失败提示；Core 不用意图处理成功的消息推测设备是否显示或播放成功。旧版空心跳继续兼容，普通媒体请求刷新时间时保留上次上报的屏幕内容。

这是设备显示文字的同步，不包含 LCD 像素截图；离线时 Web 显示的是上次收到的内容，在线状态按心跳时间判断。
