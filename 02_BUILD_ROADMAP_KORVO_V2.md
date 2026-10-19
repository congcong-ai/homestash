# Open Kitchen AI — Build Roadmap

# 1. 推荐仓库结构

使用 pnpm monorepo。

建议：

```text
open-kitchen-ai/

apps/
  web/
  miniapp/
  simulator/

services/
  kitchen-core/

packages/
  domain/
  database/
  api-client/
  protocol/
  ai/
  inventory/
  recipes/
  shared/
  ui/

firmware/
  kitchen-board/

hardware/
  rev-a/
  docs/

docker/

docs/

examples/
```

使用 workspace protocol。

避免复制类型。

---

# 2. Web 技术栈

使用：

- TypeScript
- React
- Next.js
- Tailwind CSS
- shadcn/ui 或同级成熟组件体系

要求：

Mobile First。

支持 PWA。

不要设计成管理后台。

---

# 3. Mini Program

使用：

- Taro
- React
- TypeScript

尽可能共享：

- types
- schemas
- API client
- business validation

不要强行共享所有 UI。

小程序和 Web 可以有不同 UI。

---

# 4. Kitchen Core

建议：

Node.js + TypeScript。

API Framework 可以采用：

Fastify

数据库：

SQLite。

ORM：

Drizzle ORM 或等价轻量方案。

支持 Docker。

提供：

REST API

优先。

以后根据设备实时通信需求增加：

WebSocket / MQTT。

---

# 5. Validation

统一使用：

Zod

或同级 schema library。

AI structured output 也使用相同 Schema。

---

# 6. Phase 0 — Software Simulator

这是现在立即实现的阶段。

完全不依赖真实硬件。

建立：

`Device Simulator`

模拟：

- Button press
- Voice input
- Screen
- Battery
- Wi-Fi state
- Device heartbeat

UI 中显示一个虚拟 E-Ink。

---

## Phase 0 必须功能

### Inventory

- Create
- Update
- Consume
- Discard
- Move
- Open
- Expire

---

### Today First

根据规则生成：

- Eat soon
- Urgent
- Expired

---

### AI Chat

用户自然语言：

“今天买了一盒草莓和两个西红柿。”

转换成结构化动作。

没有 API Key：

使用 Mock AI Provider。

有 Key：

允许 OpenAI-compatible Provider。

---

### Recipe

根据当前库存：

推荐 3 个菜。

---

### Cooking Mode

支持：

- Start
- Next
- Previous
- Ask

---

### Personas

实现最少：

Default

Gentle

Cat

---

### Web

至少页面：

Home

Inventory

Add

Recipes

Device

Settings

---

# 7. Phase 0 验收标准

必须可以执行完整 Demo：

1.

启动 Docker / pnpm dev。

2.

打开 Web。

3.

看到虚拟冰箱贴。

4.

输入：

“买了两个西红柿、一盒草莓和十个鸡蛋。”

5.

库存自动建立。

6.

首页出现：

“今天先吃”。

7.

问：

“今晚两个人吃什么？”

8.

得到基于库存的菜谱。

9.

选择菜谱。

10.

进入 Cooking Mode。

11.

模拟按钮：

Next。

12.

虚拟 E-Ink 更新。

全部成功才进入 Phase 1。

---

# 8. Phase 1 — Real Hardware PoC（使用现有 Korvo）

不要购买新的通用 ESP32 开发板。

不要定制 PCB。

当前真实 PoC 硬件固定优先使用：

**ESP32-S31-Korvo-1 V1.1**

用户已经基于这块板做过智能工牌项目，而且固件已经跑通。

该阶段的目标不是证明“我们会驱动硬件”，而是：

> **最大限度复用已验证的板级能力，尽快证明 Kitchen 产品体验。**

优先复用板上/配套能力：

- 双麦克风
- ES8389 Audio Codec
- Speaker output
- Function buttons
- Wi-Fi
- BLE
- DVP Camera
- microSD
- 4.3" LCD / Touch（如果当前套件中具备）
- USB/UART
- 已跑通智能工牌固件中的 OTA / 网络 / 日志能力

Phase 1 暂时不强制：

- E-Ink
- 新麦克风
- 新 Speaker 模块
- 新 Camera
- 新开发板

如果 LCD 子板当前不在手头：

不要因此阻塞。

使用：

- Web/PWA
- Serial/Log
- 现有可用输出方式

完成真实设备 PoC。

Camera 业务功能可以开启验证，但库存闭环不能依赖 Camera 才能工作。

---

# 9. Firmware — 先审计并复用智能工牌固件

正式固件继续优先使用：

ESP-IDF。

但在创建新的板级驱动之前：

## 必须先执行 Firmware Audit

如果智能工牌固件源码已在当前工作区或用户给出了路径：

先阅读完整项目并生成：

`docs/FIRMWARE_REUSE_AUDIT.md`

记录：

- SDK / ESP-IDF version
- build system
- partition table
- sdkconfig
- board init
- ES8389 / I2S / TDM
- microphone capture
- playback
- camera
- LCD
- touch
- Wi-Fi
- BLE
- OTA
- storage
- networking
- device identity
- logging
- backend coupling
- secrets handling

然后标记：

`REUSE_AS_IS`
`REFACTOR_AND_REUSE`
`BADGE_ONLY`
`REWRITE`

不要为了 Kitchen 项目重写已经稳定工作的音频/Camera/LCD驱动。

不要直接破坏原智能工牌仓库。

Kitchen Firmware 应作为独立应用存在。

Firmware 模块建议：

```text
app/
drivers/
display/
audio/
network/
ble/
power/
ota/
protocol/
storage/
```

---

# 10. 配网

首先检查智能工牌现有固件已经采用什么配网方案。

如果现有方案：

- 稳定
- 安全
- 不强依赖智能工牌业务后台

则优先复用。

否则再实现新的 BLE Provisioning。

目标流程：

第一次启动：

Device 进入 BLE Provisioning。

手机：

连接 BLE。

发送：

- Wi-Fi SSID
- Wi-Fi credential
- Kitchen Core endpoint

之后：

ESP32 连接 Wi-Fi。

敏感信息存储在 NVS。

不要把用户 AI API Key 下发给 ESP32。

---

# 11. Device Protocol

定义稳定协议。

例如：

```ts
DeviceEvent
DeviceCommand
DeviceState
```

设备事件：

```text
BUTTON_PRESSED
VOICE_CAPTURED
DEVICE_ONLINE
DEVICE_SLEEPING
BATTERY_CHANGED
CAMERA_CAPTURED
```

服务端指令：

```text
DISPLAY_RENDER
PLAY_AUDIO
START_RECORDING
STOP_RECORDING
ENTER_SLEEP
OTA_UPDATE
```

协议独立成为：

`packages/protocol`

---

# 12. Voice

Phase 1：

Push-to-talk。

不要做 Always Listening。

流程：

用户按键

→

设备录音

→

发送 Kitchen Core

→

STT

→

AI Intent

→

Domain Action

→

TTS / Display

→

ESP32 Sleep

---

# 13. Power

从第一版 Kitchen Firmware 就定义：

Active

Idle

Light Sleep

Deep Sleep

状态机。

但需要区分：

## Korvo PoC 功耗

ESP32-S31-Korvo-1 V1.1 是多媒体开发板，板上包含大量为开发和音视频准备的外围电路。

所以：

**不要把 Korvo 整板实测续航直接当成最终冰箱贴续航指标。**

Phase 1 主要验证：

- 软件可否休眠
- 网络能否按需唤醒
- Camera 能否按需使用
- Audio 是否按需工作
- UI 状态恢复
- 唤醒后的连接与业务时延

## Custom Board 功耗

真正续航目标在 Rev.A/Rev.B 自研板验证。

未来 PCB 对：

Camera / Display / Audio / Sensor

应尽量提供可控电源域 / load switch。

Wi-Fi 不应默认永久高功耗运行。

---

# 14. Phase 2 — 微信 Quick Mode

Phase 1 跑稳以后再开始。

实现：

- 微信登录
- 绑定设备
- Cloud Household
- Inventory
- Today First
- Recipe
- 图片识别入口
- 小票入口
- 订单截图入口
- Barcode
- 官方 AI

注意：

微信小程序只是 Quick Mode 客户端。

Local 用户继续使用 Web / PWA。

---

# 15. Phase 3 — Custom Core Board Rev.A

只有 Phase 1 的真实硬件使用一段时间后才画 PCB。

不要提前画。

---

# 16. Rev.A 目标

当前默认优先评估：

**ESP32-S31-WROOM-3**

因为现有 ESP32-S31-Korvo-1 V1.1 + 智能工牌固件已经提供了真实工程基础。

但冻结 BOM 前必须制作：

`hardware/rev-a/SOC_SELECTION.md`

比较：

- ESP32-S31-WROOM-3
- ESP32-S3 成熟模组
- 当时其他合适方案

至少比较：

- 模组成本
- 供货周期
- SDK 成熟度
- Flash / PSRAM
- Wi-Fi / BLE
- Audio
- Camera
- 低功耗
- PCB 难度
- 量产风险
- 可获得认证资料

最终再冻结 SoC。

不要自己从 RF 裸芯片和天线起步，优先使用成熟无线模组。

需要：

- USB-C
- 5V input
- 3.3V regulator
- LiPo connector
- Charger
- Battery measurement
- Mic
- Button
- LED
- Speaker amp
- Camera connector
- E-Ink connector
- I2C
- UART
- GPIO
- Debug pads
- Test pads

预留独立电源控制：

- Camera
- Display
- Audio

---

# 17. Rev.A 必须提交的工程文件

`hardware/rev-a/`

至少包括：

- Schematic
- PCB
- BOM
- CPL
- Gerber
- Assembly notes
- Pin map
- Power tree
- Test points
- Bring-up checklist

需要适配嘉立创 / JLCPCB SMT 文件要求。

第一批只做小批量工程验证。

---

# 18. 测试治具

Rev.A 同时设计简单测试流程。

每块板测试：

- Power
- USB
- Flash
- Wi-Fi
- BLE
- Mic
- Speaker
- Display
- Button
- Battery ADC
- Camera connector

生成：

PASS / FAIL。

不要靠人工随便试一下就发货。

---

# 19. Phase 4 — DevKit

正式开源 Beta。

产品：

## Open Board

裸板。

面向 Maker。

---

## DevKit

包含：

- Core Board
- E-Ink
- Camera
- Speaker
- Cable
- 简单磁吸/3D 打印结构

不需要开模。

---

# 20. Phase 5 — Consumer Lite

在社区验证有需求以后才开发。

目标不是开发板。

目标：

漂亮。

便宜。

简单。

适合小红书传播。

建议硬件：

Core Board BOM variant

+

Color E-Ink

+

Mic

+

Button

+

Speaker

Camera 可以取消。

---

# 21. Consumer Lite 使用流程

用户收到：

拆盒

→

贴冰箱

→

微信扫码

→

配 Wi-Fi

→

选一个人格

→

完成。

目标：

第一次体验尽量控制在几分钟内。

不能要求用户：

- 看 GitHub
- 配 Docker
- 填十个参数
- 理解 API

---

# 22. Open Source

Repository 要从第一天保持可以公开。

要求：

- 不提交 Secret
- `.env.example`
- Setup 自动化
- README
- Architecture
- Contributing
- Hardware Docs
- Firmware Docs

最终应该能够做到：

Geek 用户：

Clone

→

运行

→

成功。

---

# 23. 第一阶段 Codex 当前任务

现在不要实现 Phase 1～5。

只：

## 完整实现 Phase 0。

但是所有接口必须为后续真实硬件做好结构准备。

完成 Phase 0 后：

输出：

1. 已完成内容
2. 项目结构
3. 如何运行
4. Demo 操作步骤
5. 测试结果
6. 尚未实现
7. Phase 1 所需采购清单建议

然后停止在 Phase 0 验收节点。


---

# 24. Phase 0 → Phase 1 的新验收门槛

Phase 0 完成后，不需要先写“采购一块什么开发板”。

直接进入：

## A. Existing Firmware Audit

读取已有智能工牌固件。

## B. Korvo Bring-up

在 ESP32-S31-Korvo-1 V1.1 上确认：

- 能成功 build
- 能 flash
- 双麦可录音
- Speaker 可播放
- Wi-Fi 可联网
- Button 可触发
- Camera 可抓图
- LCD 可显示（若当前硬件具备）
- 与 Kitchen Core 可通信

## C. Kitchen Vertical Slice

真实开发板跑通：

按键

→ 录音

→ Kitchen Core / STT

→ 识别“买了两个西红柿”

→ Inventory 更新

→ 返回响应

→ Speaker 播放 / LCD 显示 / Web 同步

这是 Phase 1 的第一优先级。

不要先花时间追求完整设备 UI。

---

# 25. Phase 1 完成后的输出

额外输出：

1. `FIRMWARE_REUSE_AUDIT.md`
2. Korvo 实际复用模块清单
3. 智能工牌代码与 Kitchen 代码边界
4. 实际 pin / board 配置来源
5. 真实硬件 Demo 操作步骤
6. Korvo 阶段已发现的产品问题
7. Rev.A 应保留的硬件能力
8. Rev.A 可以删除的 Korvo 能力
9. 是否仍需要 E-Ink
10. 是否需要 Camera 的产品结论
11. 低功耗实验数据（只作为参考，不作为最终续航承诺）
