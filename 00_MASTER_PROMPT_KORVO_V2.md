# Open Kitchen AI / 智能冰箱贴项目 — Codex 总控提示词

## 0. 你的角色

你现在是本项目的联合技术负责人、产品工程师和全栈开发者。

你需要帮助我们从 0 开发一个：

**开源、Local-first、AI-native 的家庭智能库存硬件平台。**

第一款应用是：

**AI 智能冰箱贴 / AI 饭搭子**

但底层设计不能写死为 Food 或 Fridge，未来需要自然扩展到：

- 食品
- 药品
- 保健品
- 宠物食品
- 日用品
- 护肤品
- 家庭药箱
- 食品柜
- 冷冻柜
- 咖啡柜
- 其他家庭库存

项目早期不追求“大而全”，核心目标是：

> 尽快做出一个真正可运行、可演示、可开源、后续可以做定制 PCB 的完整 PoC。

---

# 1. 项目核心理念

项目同时面向两类完全不同的用户。

## A. Geek / Maker 用户

他们关心：

- 开源
- BYOK
- Self-host
- Local AI
- 隐私
- ESP32
- Home Assistant
- MQTT
- API
- 自定义传感器
- 可扩展硬件

他们可以买裸开发板或 DevKit，自己折腾。

---

## B. 普通消费用户

特别是年轻家庭、年轻女性、情侣、租房用户。

他们不关心技术实现。

他们关心：

- 好不好看
- 好不好玩
- 是否便宜
- 是否拿来就能用
- 今天吃什么
- 什么快坏了
- 家里缺什么
- 做菜时不用碰手机
- 有没有有趣的人格和情绪价值

产品原则：

> 内核要 Geek，外表要小红书。

不能为了 Geek 需求把普通用户界面做成 ERP。

---

# 2. 第一阶段绝对不要做的事情

不要一开始：

- 设计最终消费级外壳
- 开模
- 大批量 PCB
- 自研 RF 天线
- 做复杂健康平台
- 做医疗诊断
- 做精准卡路里医学建议
- 做完整 App
- 做 Always-on Camera
- 做 Always-on Voice
- 做太阳能系统
- 做 RFID 全家桶
- 做复杂重量传感器
- 设计万能智能家居中枢

第一阶段的目标只是验证核心闭环。

---

# 3. MVP 必须跑通的闭环

用户能够完成：

### 场景 1：添加食物

用户说：

“今天买了两个番茄、一盒鸡蛋、一盒草莓。”

系统：

1. 识别自然语言；
2. 创建库存；
3. 推断合理保存位置和建议食用时间；
4. 显示结果；
5. 同步到 UI。

---

### 场景 2：消耗库存

用户：

“牛奶喝完了。”

系统：

更新库存。

---

### 场景 3：今天先吃什么

系统根据：

- 入库时间
- 食材类型
- 保质期
- 开封状态
- 用户设置

给出：

“今天优先吃：

草莓  
菠菜  
昨晚剩菜”

---

### 场景 4：今天吃什么

用户：

“今晚两个人，不想吃太油，有什么可以做？”

系统根据现有库存给出菜谱。

---

### 场景 5：做菜

用户：

“开始做番茄牛腩。”

进入 Hands-free Cooking Mode。

支持：

- 下一步
- 上一步
- 放多少
- 还要多久
- 我没有这个材料怎么办

第一阶段 Push-to-talk 即可。

---

### 场景 6：提醒

例如：

“菠菜建议今天吃掉。”

提醒首先在 Web UI 实现。

后续再接微信服务通知。

---

# 4. 第一阶段硬件原则（已确定现有开发板）

第一阶段不要设计定制 PCB，也不要再购买另一块通用 ESP32 开发板。

当前已经拥有并优先使用：

**ESP32-S31-Korvo-1 V1.1**

而且已经使用这块开发板完成过一个智能工牌项目，现有固件已经跑通。

因此本项目硬件 PoC 的第一原则是：

> **复用已经验证过的硬件和固件能力，不从零重写板级驱动。**

ESP32-S31-Korvo-1 V1.1 已具备适合本项目 PoC 的多媒体能力，包括：

- ESP32-S31-WROOM-3
- 双麦克风
- ES8389 音频 Codec
- 扬声器输出
- 板载 DVP Camera
- microSD
- 功能按键
- Wi-Fi / BLE
- USB
- 可配套 4.3 英寸 LCD / Touch 子板

如果现有智能工牌固件中已经实现以下能力，必须优先复用：

- 麦克风录音
- 音频编码/上传
- Speaker/TTS 播放
- Wi-Fi
- BLE
- Camera
- LCD/UI
- 按键
- OTA
- WebSocket/HTTP/MQTT 等现有通信
- 设备身份/配置
- 日志和故障诊断

不要为了“代码更干净”而重写已稳定工作的驱动。

正确做法是：

1. 审计现有智能工牌固件；
2. 列出可直接复用模块；
3. 将业务相关代码和板级能力拆开；
4. 为 Kitchen 项目建立独立 App 层；
5. 尽可能保留经过验证的 Board Support / Driver 层。

Phase 1 PoC 默认先使用 Korvo 自带/配套 LCD 做交互验证。

**暂时不要求采购 E-Ink。**

E-Ink 是未来低功耗冰箱贴形态的重要候选，但不应该阻塞当前 PoC。

Camera 硬件已经存在，但业务上仍然视为增强能力；没有 Camera 识别时，系统仍必须能通过 Voice / Web / 手机完成完整闭环。

低功耗目标在 Korvo 开发板阶段只验证：

- 软件状态机
- 可休眠逻辑
- 外设按需开启原则

不要用这块多媒体开发板的整机功耗，直接推断最终消费版续航。

---

# 5. 产品长期硬件架构

后续设计：

`Kitchen AI Core Board`

当前优先候选 SoC / 模组路线：

**ESP32-S31-WROOM-3**

原因不是为了盲目追新，而是：

- 当前手头 ESP32-S31-Korvo-1 V1.1 已经跑通；
- 智能工牌固件已有可复用经验；
- 可以最大化复用音频、网络、多媒体和工具链经验。

但 Rev.A 冻结前必须重新比较：

- ESP32-S31
- ESP32-S3
- 当时其他合适型号

比较维度：

- BOM
- 供货
- 功耗
- PSRAM/Flash
- 音频能力
- Camera
- SDK 成熟度
- 认证与量产风险

不要仅因为 PoC 用 S31 就永久锁死。

核心板包含：

- 成熟 ESP32 模组（当前首选 ESP32-S31-WROOM-3）
- USB-C
- 电源管理
- LiPo 接口
- 充电
- 电量检测
- Mic
- Button
- LED
- Flash / PSRAM
- Speaker Amp
- Camera connector
- E-Ink connector
- I2C
- UART
- GPIO
- 5V
- 3.3V

Camera、E-Ink、Speaker 等尽量模块化。

官方板不能依赖官方云才能工作。

---

# 6. 两种运行模式

必须从架构层面同时支持：

## Quick Mode

给普通用户。

未来：

微信扫码 → 配网 → 绑定 → 官方 AI → 直接使用。

可以使用官方云。

---

## Local Mode

给极客和隐私用户。

不要求注册官方账号。

数据可以完全存在：

- Mac
- Windows
- Linux
- NAS
- Raspberry Pi
- Mini PC

支持：

- Docker
- SQLite
- BYOK
- Ollama
- OpenAI-compatible API

Local Mode 不允许依赖微信小程序才能工作。

应提供：

Web / PWA。

---

# 7. AI Provider 架构

不要把业务代码绑定任何单一模型。

建立统一接口：

`AIProvider`

至少设计：

- OpenAICompatibleProvider
- OfficialCloudProvider
- LocalProvider

未来可以接：

- OpenAI
- Gemini
- Claude
- DeepSeek
- Qwen
- Hunyuan
- Doubao
- Zhipu
- Ollama
- 其他 OpenAI-compatible endpoint

API Key 不允许硬编码。

API Key 原则上不存到 ESP32。

---

# 8. 技术原则

项目使用：

- pnpm workspace
- TypeScript
- monorepo
- 尽量共享类型
- Schema-first
- API-first
- Local-first
- Offline-friendly
- 可 Docker 部署
- 硬件协议公开

所有核心 Domain 不得依赖某一前端。

---


# 8.1 现有智能工牌固件复用规则

用户已经有一个基于 **ESP32-S31-Korvo-1 V1.1** 的智能工牌项目，并且固件已经真实跑通。

这是本项目的重要资产。

当现有智能工牌固件源码被放入当前工作区、作为 Git 仓库提供、或给出本地路径后，必须先做 Firmware Audit。

输出：

`docs/FIRMWARE_REUSE_AUDIT.md`

至少包含：

- ESP-IDF / SDK 版本
- Board 初始化方式
- Audio capture
- Audio playback
- ES8389 初始化
- 双麦实现
- Camera
- LCD
- Touch
- microSD
- Wi-Fi
- BLE
- OTA
- 网络协议
- 云端依赖
- Secret / Key
- 可复用模块
- 应拆分模块
- 智能工牌业务耦合代码
- Kitchen 项目新增代码

原则：

**不要直接在原智能工牌项目上暴力改造成冰箱贴。**

优先：

- 保留原项目可继续运行；
- 复用稳定驱动和组件；
- 新项目建立独立 firmware app；
- 必要时通过 git subtree / package / component / copy-with-history 等方式迁移；
- 记录代码来源与修改。

如果当前工作区还没有智能工牌固件源码：

不要臆造其接口。

先建立：

`firmware/kitchen-board/`

和：

`docs/SMART_BADGE_FIRMWARE_IMPORT.md`

把待接入接口和迁移清单写清楚，继续完成不依赖它的软件工作。

---

# 9. 开发方式

不要一次性实现所有功能。

严格按照：

Phase 0
→ Phase 1
→ Phase 2
→ Phase 3

推进。

每完成一个 Phase：

1. 自动运行测试；
2. 更新 README；
3. 更新 CHANGELOG；
4. 写清楚哪些是真的实现；
5. 哪些只是 Mock；
6. 哪些下一阶段实现。

不要用假的成功状态掩盖未实现功能。

---

# 10. 现在首先要做什么

首先阅读：

- `01_PRODUCT_ARCHITECTURE.md`
- `02_BUILD_ROADMAP.md`

然后：

## 第一步

检查当前目录。

如果是空目录：

初始化项目。

如果已有项目：

先完整阅读项目，不能覆盖已有工作。

---

## 第二步

创建 monorepo 基础结构。

---

## 第三步

先完成 Phase 0：

**纯软件模拟版。**

即使真实 ESP32-S31-Korvo-1 暂时没有连接电脑，也必须可以完整演示：

虚拟冰箱设备

→

添加食物

→

库存变化

→

AI 推荐

→

今天先吃什么

→

菜谱

→

设备模拟屏幕

Phase 0 验收通过以前：

不要开始设计定制 PCB。

---

# 11. UI 原则

UI 不允许设计成企业后台。

这是 C 端生活产品。

要求：

- 简洁
- 可爱但不要幼稚
- 大量留白
- 卡片化
- 手机上优先
- 一眼看懂
- 尽量少表格
- 尽量少配置项

主页第一屏应该重点显示：

“今天先吃”

和：

“今晚吃什么”

而不是库存数据库。

---

# 12. AI 人格

系统支持人格配置。

至少预留：

- 默认
- 温柔饭搭子
- 毒舌饭搭子
- 健身搭子
- 猫猫

但 Phase 0 只需要实现简单 personality prompt。

---

# 13. 安全边界

对于药品：

允许：

- 库存
- 数量
- 到期时间
- 储存位置
- 临期提醒
- 补货提醒
- 用户自己设定的提醒

禁止默认提供：

- 诊断
- 处方
- 改变剂量
- 判断用户应该服用什么药
- 替代医生做治疗建议

数据模型必须支持 Medicine，但产品第一版仍主要展示 Food。

---

# 14. Codex 工作要求

不要只给设计建议。

你需要：

- 直接创建代码
- 直接创建目录
- 直接创建数据库
- 直接运行项目
- 直接运行测试
- 修复报错
- 完成可以运行的结果

遇到第三方 Key 缺失时：

使用 Provider Stub / Mock。

不要因此停止整个项目。

优先完成一个：

**本机可运行的完整闭环。**

开始工作。


---

# 15. 当前已知真实硬件上下文（重要）

截至当前：

- 已有开发板：**ESP32-S31-Korvo-1 V1.1**
- 已经基于此板做过智能工牌项目
- 智能工牌开发板固件已经真实跑通
- 因此不要重新推荐购买一块 ESP32-S3 开发板作为 Phase 1 起点
- 不要在 Phase 1 强制采购 E-Ink
- 优先用现有 LCD / Audio / Camera / Button 能力快速验证产品交互
- 后续定制冰箱贴 PCB 再针对 E-Ink、尺寸、电池和低功耗重新设计

这是后续所有硬件与固件决策的默认前提。
