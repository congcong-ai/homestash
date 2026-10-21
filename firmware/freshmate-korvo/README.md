# FreshMate Korvo 固件

面向 ESP32-S31-Korvo-1 V1.1 的独立 ESP-IDF 工程。第一条链路为 SET 按键 → 双麦录音 → 单声道 WAV → HomeStash Core → 百炼 ASR / 结构化意图 → 库存事务 → 百炼 TTS → Speaker / LCD。

## 构建

复用已验证 SDK：ESP-IDF 6.2 开发版，提交 `ab95e70748f2eddac6f87217b0cf62533684a6ba`。默认路径为 `$HOME/esp/esp-idf-smartbadge`，这是共享 SDK，不是 SmartBadge 工程。

```sh
cp scripts/hardware/device.env.example data/hardware/device.env
# 填写独立 Wi-Fi、Core LAN 地址、设备 ID 和 Token
pnpm hardware:build
```

从 HomeStash 根目录执行；`data/hardware` 已忽略。无配置也能构建，但不能联网。配置仅生成到忽略的 `build/local-network-config.h`。二进制包含 Wi-Fi 和设备 Token，不能公开发布；不包含 AI API Key。`HOMESTASH_IDF_PATH` 可指定相同提交的 SDK。字体更新运行 `node scripts/hardware/font.mjs`。

## 分层与构建目标

- `../apps/freshmate_app`：通用产品流程，当前工程main只调用它。
- `../common/components`：网络、配置、录音队列、协议、OTA、BLE和电源等公共ESP-IDF服务，以及device_port契约。
- `components/board`：当前Korvo身份、能力和按键映射。
- `components/audio/camera/display/settings_ui/storage`：Korvo硬件与界面适配，继续使用原厂BSP和已验证代码。
- 数据根目录由当前目标指定为`/sdcard/homestash`，NVS与SD内容保持原位置。

根目录执行`pnpm hardware:targets`查看目标，`pnpm hardware:build:generic --board korvo-s31`构建无本机凭据镜像。当前源码版本0.5.0仅完成编译与主机验证，没有刷入设备；此前0.4.3已实测Camera、BLE和OTA。AEC/NS/VAD尚未启用。迁移设计见 [固件复用](../../docs/FIRMWARE_PORTABILITY.md)。

## 交互与恢复

按 SET 开始，再按 SET 停止，最长约 59 秒。断网保留待上传录音，再按 SET 重试。UUID 编入 `.part` / `.wav` 文件名，重启恢复时保持原 ID；损坏文件不会被新录音覆盖。同一录音 ID 重复上传不会重复入库；TTS 失败可以独立重试。播放未成功前不开始下一条录音。

串口 115200 下输入 `status` 回车可查看录音、待上传和存储状态；输入 `record` 回车，可触发同一个按键处理入口，用于联调；不会伪造音频。真实按键和听感仍需人工验收。

## 烧录前备份

必须先验证 USB 序列号、MAC 和完整 Flash 备份。此项目的 `backup.py` 是只读 Flash 工具：空白块先核对设备 MD5 再重建为 `0xff`，非空白块从设备读取；最终再次校验整片摘要，并保存本地 SHA-256。脚本可用同一目录断点续传。

备份含设备配置，仅保存在用户明确授权的 SmartBadge 忽略目录，不能复制到 HomeStash 或提交 Git。上次未完成的读取结果不能用于恢复。

```sh
# 使用已安装的 IDF Python 环境
python scripts/hardware/backup.py --directory /绝对路径/备份目录 --usb-serial 设备序列号 --mac 设备MAC
python scripts/hardware/flash.py --backup /绝对路径/备份目录/manifest.json --dry-run
python scripts/hardware/flash.py --backup /绝对路径/备份目录/manifest.json
```

刷写范围仅包含 bootloader、分区表与 app，不擦除 NVS、不改 SD 其它目录。恢复时先核对备份 SHA-256 和目标 MAC，再使用 esptool 从偏移 0 写回完整备份；恢复会把整个 Flash（含配置）还原到备份时状态。

恢复状态、测试范围和物理断电验收见 [恢复验收](../../docs/RECOVERY_VALIDATION.md)。

## 自动读取屏幕状态

`pnpm hardware:status` 读取 Core 保存的设备真实屏幕文字和时间；设备离线时明确标记离线。UART 日志同时输出 `LCD:` 行，可以直接检查恢复、上传和播报失败提示。Web“真实开发板”区域显示同一设备上报的内容。该能力同步显示文字，不提供 LCD 像素截图。

刷写可用 `--wait-seconds 300` 等待已配置的 UART 目标出现，仍会检查 USB 序列号、MAC 和完整备份，且不会选择其它串口。
