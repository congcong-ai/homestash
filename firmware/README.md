# 固件开发入口

HomeStash 共用一份产品流程，通过接口适配 SDK 和板卡。换板时新增平台或板级实现，不复制库存、录音重试和页面同步流程。每块板分别编译、烧录和验收。

```text
firmware/
├── apps/freshmate/                  共用产品流程与语义操作
├── shared/
│   ├── components/device_port/      平台及设备接口、能力策略
│   ├── components/outbox/           共用录音队列、WAV 校验与恢复
│   └── assets/                     共用中文字库
├── platforms/
│   ├── esp-idf/components/          ESP 网络、配置、HTTP、OTA、配网及电源
│   └── tuyaopen/                    Tuya 运行时、网络、配置、HTTP 及文件系统
├── boards/
│   ├── esp32-s31-korvo-1/           ESP32 原型工程、驱动与路演界面
│   └── tuya-t5-ai/                  T5 工程、音频、屏幕与输入适配
├── diagnostics/                    独立诊断工程，不作为产品入口
└── targets.json                    板型 ID、工程位置与锁定 SDK 提交
```

## 代码放在哪里

- 产品事件和流程写入 `apps/freshmate`，仅使用公共接口，不引入 ESP、Tuya、FreeRTOS、GPIO 或 LVGL 头文件。
- 公共契约写入 `shared/components/device_port/include`。文件系统契约放在使用它的 `outbox/include/hs_fs.h`，产品队列不依赖 SDK 的文件类型。
- 线程、队列、网络、配置持久化及 HTTP 实现属于 `platforms`。ESP 运行时通过独立 `runtime` 组件链接。
- 引脚、原厂 BSP、音频、屏幕、触摸和按键属于 `boards`。板级资源不可倒流到应用层。
- 字库等可共用资源放入 `shared/assets`；Korvo 专用路演场景与配音保留在该板工程内。
- `build/`、`.build/`、SDK、口令和设备配置均不提交。不要把生成物或上游 SDK 复制进源码树。

## 构建与验证

从仓库根目录执行：

```sh
pnpm hardware:targets
pnpm hardware:build:generic --board korvo-s31
pnpm hardware:build:generic --board tuya-t5-ai
pnpm hardware:check:ports
pnpm test
```

两个目标使用不同 SDK。环境准备和能力边界分别见 [Korvo 工程](boards/esp32-s31-korvo-1/README.md)与 [T5 工程](boards/tuya-t5-ai/README.md)。未知目标直接拒绝，不回退到默认板型。`hardware:build:generic` 不嵌入设备凭据；实际联网需本地配置或串口设置。

T5 当前为实验目标；镜像编译、烧录、外设功能和产品验收是不同阶段。实际验证记录见 [T5 适配说明](../docs/hardware/tuya-t5-ai/bring-up.md)。

硬件资料及测试记录在 [docs/hardware](../docs/README.md) 维护；共用架构见 [固件适配说明](../docs/common/firmware/portability.md)。

## 已归档构建

2026-11-05 已在原开发 Mac 的锁定 SDK 上重编译当前 ESP32 分层源码，通过镜像和分区检查。备用包、源码快照及摘要已保存到项目，见 [ESP32 重编译与备用归档](../docs/hardware/esp32-s31-korvo-1/validation/build-20261105.md)。本轮没有刷写设备。
