# T5 官方技术文档与 Demo

用户提供的 TuyaOpen 官方资料，整理与页面核对日期：2026-11-05。这里保留官方链接与用途说明，在线内容及 SDK 目录以官方对应版本为准。

## 开发板与入门

| 入口 | 用途 |
| --- | --- |
| [T5AI-Board 开发套件概览](https://tuyaopen.ai/zh/docs/hardware/tuya-t5/t5-ai-board/overview-t5-ai-board) | 硬件组成、板级配置、引脚和 LCD/摄像头扩展说明；与[本地原厂附件](README.md)配合查阅 |
| [Step 0：环境搭建](https://tuyaopen.ai/zh/docs/quick-start/enviroment-setup) | 安装工具链、获取 TuyaOpen 并激活 `tos.py`。用户提供的“入门指南”链接当前对应环境搭建页，编译与烧录见后两项 |
| [Step 1：项目编译](https://tuyaopen.ai/zh/docs/quick-start/project-compilation) | 环境搭建后的项目配置与编译入口 |
| [Step 2：固件烧录](https://tuyaopen.ai/zh/docs/quick-start/firmware-burning) | 官方固件烧录流程，使用前核对对应的板卡与连接方式 |

## 应用与外设示例

| 入口 | 官方页面内容 | 在 HomeStash 中的参考用途 |
| --- | --- | --- |
| [AI 聊天机器人 Demo](https://tuyaopen.ai/zh/docs/cloud/device-ai/demo-your-chat-bot) | `your_chat_bot`：语音采集、对话、播报和屏幕交互 | 参考音频和交互组织方式；库存业务仍需按 HomeStash 协议对接 Core |
| [IoT 智能插座/灯 Demo](https://tuyaopen.ai/zh/docs/cloud/iot-client/demo-tuya-iot-light) | 页面当前标题为 `switch_demo`，介绍开关应用的连接、配网、控制和 OTA；示例未控制真实负载 | 参考 TuyaOpen 联网与设备控制流程，不作为 HomeStash 的硬件控制验收 |
| [Wi-Fi、BLE 与其他外设基础示例](https://tuyaopen.ai/zh/docs/examples/demo-generic-examples) | `examples/` 按网络、外设、多媒体、图形和系统功能组织独立示例 | 用于拆分验证录音/播放、显示/相机、网络与存储等板级能力，再接入产品流程 |

## 建议查阅顺序

先核对板卡概览和本地引脚/原理图，再按“环境 → 编译 → 烧录”运行适用的官方示例。底层外设可分项参考基础示例，语音与屏幕交互参考聊天机器人；需要研究涂鸦云连接时再看 IoT 示例。

这些链接是 T5 平台开发资料。本仓库已有实验 T5 目标，具体复用范围见[公共固件说明](../../../common/firmware/portability.md)，适配状态及后续验收回到 [T5 索引](../README.md)维护。
