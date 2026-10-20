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

首条按键录音及播报听感已验收；录音中物理断电恢复、原 ID 重试和播报已专项通过。复杂网络恢复和长时间运行仍待验证。Camera 后续已真实复测成功，见文末增量；BLE产品配网、AEC/NS/VAD 尚未接入，OTA已新增维护流程，不应把 BSP 能力视为已完成产品功能。当前录音队列只有一条，不能连续离线批量采集。字体为子集，任意模型返回字形尚未完整覆盖。

## 官方接口依据

- [百炼 Qwen-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)：兼容 Chat Completions 的音频输入。
- [百炼 Qwen-TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)：生成音频 URL，Core 下载后转换成设备固定 WAV 格式。

## 原板恢复资产

完整备份位于 SmartBadge 本地忽略目录：`data/hardware/devices/1c2904d054a8/backups/before-homestash-20261018-verified/`，含 `manifest.json` 和 16 MB 镜像。SHA-256：`5e2e31789c7e5c52192e976c0978468832436ff4f739aca5bc00de3358b4599b`。已验证与设备备份时整片内容一致；恢复写回操作未执行。

## 录音恢复加固

已修复录音和 UUID 分开保存的中断窗口，以及 FAT 播报缓存覆盖失败；13 项测试通过。真实录音中拔掉全部供电再重连后，恢复相同 UUID 的 WAV，并完成上传、播放及清理，用户确认听感正常。库存和事件完整数据保持一致。现可通过 `pnpm hardware:status` 和 Web 直接查看实际 LCD 文字。详细验收及网络限制见 [恢复验收](RECOVERY_VALIDATION.md)。首条正常语音链路的历史验收仍保留，不能据此替代本次故障恢复测试。

## 语音烹饪增量 · 2026-10-19

已补齐选菜人数承接、菜名与步数播报、重复当前步骤、做饭完成后的明确扣减确认及不扣减退出。用户已在真实 Korvo 上确认开始第 1 步、下一步与再说一遍两次保持第 2 步，三条录音均播放成功并清理。Web 确认界面已实际操作，并以不扣减方式结束演示；库存与事件完整数据不变。

17 项自动测试通过。百炼真实 ASR/意图/TTS 的合成语音探针通过，确认扣减、跨批次回滚与重启重放由临时数据库测试验证，没有为验收去扣减日常库存。详细操作和限制见 [语音烹饪模式](COOKING_MODE.md)，真机证据见 `hardware-evidence/cooking-20261019.json`。本轮没有修改或重刷固件，没有修改 SmartBadge。

## 相机与 LCD 页面增量 · 2026-10-19

新增 MODE 拍照、SD JPEG 暂存、独立认证二进制上传和共用候选确认；同时新增六页触摸导航和 Core 页面轮询。31 项软件测试通过。第一版相机固件刷写、启动和断网重连通过，但两个已启用传感器均没有 I²C 响应，未生成真实照片。用户说明套件摄像头已安装并已移除镜头盖；镜头盖不能解释 I²C 探测失败。带页面的新固件曾因断电导致刷写中断，现已以115200完整恢复并通过Flash哈希校验。首页和采购页已由真机串口与认证心跳核对；浏览器添加临时购物项后设备显示1项，撤销后恢复0项。实际触摸和相机抓图仍未验收。重启后曾出现Core连接超时，约120秒后恢复，根因尚未确定。详见 [相机](KORVO_CAMERA.md)、[页面同步](KORVO_SCREEN.md)。

## 摄像头复测与设备维护 · 2026-10-20

摄像头独立复测已确认 SC101IOT、640×480 UYVY 与可解码 JPEG，三次新采集成功，原失败记录保留作为历史证据；不能继续使用“摄像头未取得图片”的旧结论。详见 [复测报告](CAMERA_RETEST_REPORT.md)。本轮带配置/OTA的固件又成功拍照并上传，返回0个候选，没有确认入库。

新增 LCD 网络扫描、密码键盘、Core配置保存、固件检查及二次确认；Web可发布经过芯片/项目/版本/校验和/摘要验证的应用镜像。用户已确认设置和 Wi-Fi 列表正常，Core保存与手动连网已通过串口实际验证。首次OTA迁移已有完整16 MiB恢复镜像并通过整片Flash摘要校验，未修改SmartBadge源码或配置。真实下载中断测试已拒绝不完整镜像并保持原应用运行。最终OTA启动结果见 [设备配置与OTA](DEVICE_SETUP_AND_OTA.md) 和对应结构化证据。

本轮软件32项测试、Wi-Fi管理真实C源码的主机模拟检查、lint/typecheck/build通过。BLE产品配网、升级中物理断电、故障启动回滚、长时间运行和功耗仍待后续验收，不宣称Phase1已全部完成。

## 集中验收 · 2026-10-20

本轮新增完整LCD手动配网/Core原值保存的用户确认、六页真实LCD文本逐项比对、Core约25秒中断恢复、OTA待确认启动复位后自动回滚。真实百炼库存/菜谱/烹饪临时库探针通过，日常库存未改动。

0.3.3/0.3.4的Light Sleep分别出现PSRAM半睡恢复和LCD underrun/IWDT，均保留为失败。0.3.5在独立配置禁用PSRAM半睡，并使用现有LVGL睡眠准备/恢复接口和最小BSP面板缓存释放扩展；真实Light Sleep已返回ESP_OK，Deep Sleep定时唤醒原因为4，NVS、联网及页面投影恢复。没有关闭看门狗、修改共享SDK或SmartBadge。

这不是最终低功耗方案：当前仅3秒受控定时实验，无SET深睡唤醒、电流或电池续航结论。完整矩阵、验证边界、BLE后续范围与最终结果见 [Phase 1集中验收](PHASE_1_ACCEPTANCE.md)。
