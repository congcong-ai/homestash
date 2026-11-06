# ESP32-S31-Korvo-1 V1.1

这是 HomeStash 首块已跑通的原型板。本文集中板级文档入口；产品规则、Core 和 Web 说明见[公共文档](../../common/README.md)。

## 工程与状态

| 项目 | 内容 |
| --- | --- |
| 开发板 | ESP32-S31-Korvo-1 V1.1 |
| 构建目标 | `korvo-s31` |
| 板型标识 | `esp32-s31-korvo-1-v1.1` |
| 固件工程 | [firmware/boards/esp32-s31-korvo-1](../../../firmware/boards/esp32-s31-korvo-1/README.md) |
| SDK 与构建配置 | 以 [firmware/targets.json](../../../firmware/targets.json)及工程 README 为准 |

已有 SET 录音、Core 库存处理、LCD/Web 同步、语音播报、相机上传、配网、OTA 与恢复的真机记录。核心 PoC 基线为 0.3.5，BLE 增量为 0.4.3；0.5.0 路演增量的构建、刷入与后续模型输入回归见[路演说明](roadshow/guide.md)。声学唤醒、复杂弱网、多天运行及电流续航仍需按各报告边界验收。这里描述已有证据，不表示设备此刻在线。

## 使用与开发

| 事项 | 入口 |
| --- | --- |
| 编译、烧录、模型分区与工程结构 | [固件工程 README](../../../firmware/boards/esp32-s31-korvo-1/README.md) |
| 当前分层源码重编译及备用包 | [2026-11-05 构建归档](validation/build-20261105.md)，本轮未刷机 |
| LCD 网络与 Core 配置、OTA、首次安装 | [配置与 OTA](setup-and-ota.md) |
| 日常固件 BLE 配网 | [BLE 配网](ble-provisioning.md) |
| 屏幕页面与触摸导航 | [LCD 页面](screen.md) |
| 相机采集、JPEG 与上传 | [相机说明](camera.md) |
| 旧固件整片备份与恢复命令 | [项目恢复说明](../../../README.md#开发板固件备份与一键恢复) |

## 路演

- [三种模式、现场配网与验证边界](roadshow/guide.md)
- [离线演示操作卡](roadshow/offline-operations.md)
- [离线演示历史验收](roadshow/offline-test-results.md)

## 真机验收

| 报告 | 用途 |
| --- | --- |
| [硬件测试状态](validation/hardware-status.md) | 外设测试与后续增量索引 |
| [Phase 1 首条链路进度](validation/phase-1-progress.md) | 初次录音闭环到集中验收的历史过程 |
| [Phase 1 集中验收](validation/phase-1-acceptance.md) | 核心 PoC、休眠、OTA 和断电恢复矩阵 |
| [相机复测](validation/camera-retest.md) | 初次探测失败及后续成功记录 |
| [BLE 与 USB-A 主机专项](validation/ble-and-usb-host.md) | 独立诊断，区别于日常固件集成 |
| [录音与恢复验收](validation/recovery.md) | 原 ID 重试、物理断电及网络恢复边界 |

[板级结构化证据](evidence/)与上述报告配套，日常 BLE 增量另见 [BLE 配网](ble-provisioning.md)。所有报告按当时的版本和日期解读。

## 来源与历史设计

- [固件来源与复用审计](provenance/firmware-reuse-audit.md)
- [逐文件导入清单](provenance/firmware-import-manifest.json)
- 早期 Korvo V2 设计：[开发提示与约束](archive/master-prompt-v2.md)、[产品架构](archive/product-architecture-v2.md)、[开发路线](archive/build-roadmap-v2.md)。原根目录的 `00/01/02` 三份文档已移到这里，作为历史设计依据。
- [2026-10-20 暂停与恢复记录](archive/development-pause-20261020.md)：后续已恢复，仅保留历史现场。

新增 T5 时，业务与协议参考[公共固件复用说明](../../common/firmware/portability.md)，引脚、SDK、驱动和验收在 [T5 目录](../tuya-t5-ai/README.md)独立记录。

[返回文档总入口](../../README.md)
