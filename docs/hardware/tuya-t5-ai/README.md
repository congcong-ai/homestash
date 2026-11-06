# 涂鸦 T5 AI 开发板

这是 HomeStash 准备新增的第二块开发板。原 `docs/hardware/tuya t5 ai board/` 中的资料已归入本目录，文件名统一为英文小写与连字符。

## 当前状态

截至 2026-11-05，已新增独立 T5 工程和实验构建目标，并复用跨平台产品主循环。用户已确认主板接有屏幕，屏幕型号、摄像头和存储卡仍待实物核对。

代码入口：[T5 固件工程](../../../firmware/boards/tuya-t5-ai/README.md)。功能范围、构建验证与真机待验项见 [适配记录](bring-up.md)。尚未完成烧录及真机验收，不能把源码或编译结果当作硬件已跑通。

## 原厂资料

| 资料 | 文件 |
| --- | --- |
| T5 数据手册 | [t5.pdf](reference/datasheets/t5.pdf) |
| T5-E1-IPEX 模组数据手册 | [t5-e1-ipex-module.pdf](reference/datasheets/t5-e1-ipex-module.pdf) |
| 开发板 V1.02 引脚图 | [t5-ai-board-v1.02.pdf](reference/pinout/t5-ai-board-v1.02.pdf) |
| 开发板 V1.02 原理图 | [t5-ai-board-v1.02.pdf](reference/schematics/t5-ai-board-v1.02.pdf) |
| LCD 显示子板原理图 | [lcd-display-sub-board.pdf](reference/schematics/lcd-display-sub-board.pdf) |
| 主板三维模型 | [t5-board-v1.02.step](reference/mechanical/t5-board-v1.02.step) |
| LCD 装配三维模型 | [t5-ai-lcd-assembly.step](reference/mechanical/t5-ai-lcd-assembly.step) |

附件内容保持原样；[原文件名对照](reference/README.md)用于追溯资料来源。实际板卡版本需在适配时与资料核对。

## 官方文档与 Demo

[官方技术资料索引](reference/official-resources.md)已收录用户补充的五个入口：开发板概览、环境搭建、聊天机器人、IoT 开关、Wi-Fi/BLE 与外设示例，并补齐官方编译与烧录页面。每项标明用途及与 HomeStash 适配的关系。

## 后续文档归属

后续的 SDK 与 BSP 选型、引脚与外设映射、构建与烧录、配网与 OTA、板级测试和证据均放在本目录。公共产品流程、Core 接口及设备管理继续维护在[公共文档](../../common/README.md)，避免复制两份业务说明。

移植前先看[固件复用与多板适配](../../common/firmware/portability.md)：公共接口已增加 TuyaOpen 平台实现，未移植能力明确关闭；现有 Korvo 镜像、分区表和烧录工具不能直接视为 T5 方案。录音、播放、显示、存储恢复及升级需要新增板级证据。

[返回文档总入口](../../README.md) · [查看已跑通的 Korvo 原型](../esp32-s31-korvo-1/README.md)
