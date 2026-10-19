# Open Kitchen AI — 产品与系统架构

# 1. 产品定义

这不是单纯的“智能冰箱库存软件”。

产品长期定位是：

**Open Home Inventory AI**

第一款应用：

**AI Fridge Magnet / AI 冰箱贴 / AI 饭搭子**

核心价值：

> 让普通冰箱不需要更换，就拥有 AI 食材管理和厨房助手能力。

用户只需要记住五句话：

1. 家里有什么？
2. 什么快坏了？
3. 今晚吃什么？
4. 缺什么？
5. 这个菜怎么做？

---

# 2. 数据模型

不要建立：

`FoodItem`

作为系统最上层数据结构。

建立：

`InventoryItem`

建议字段：

```ts
type InventoryItem = {
  id: string

  category:
    | 'food'
    | 'medicine'
    | 'supplement'
    | 'pet_food'
    | 'cosmetic'
    | 'household'
    | 'other'

  name: string

  quantity?: number
  unit?: string

  locationId?: string

  purchasedAt?: Date
  openedAt?: Date
  bestBeforeAt?: Date
  expiresAt?: Date

  freshness?: 'fresh' | 'eat_soon' | 'urgent' | 'expired'

  source:
    | 'voice'
    | 'camera'
    | 'barcode'
    | 'receipt'
    | 'order'
    | 'manual'
    | 'api'

  metadata?: Record<string, unknown>
}
```

---

# 3. Location

Location 独立。

例如：

```text
Fridge
Freezer
Pantry
Medicine Cabinet
Kitchen Cabinet
Bathroom
Pet Cabinet
Other
```

用户未来可以自定义。

---

# 4. Event 模型

不要只保存当前库存。

必须有库存事件：

```text
ITEM_CREATED
ITEM_UPDATED
ITEM_CONSUMED
ITEM_DISCARDED
ITEM_MOVED
ITEM_OPENED
ITEM_EXPIRED
ITEM_RESTOCKED
```

这样以后才能追踪：

- 消耗
- 浪费
- 家庭行为
- 推荐
- 同步冲突
- 多设备

---

# 5. Food 特有字段

Food 可以扩展：

- storageMethod
- freshness
- estimatedShelfLife
- openedShelfLife
- nutrition
- allergens
- recipeTags

但这些应该是扩展属性，而不是污染整个 InventoryItem。

---

# 6. Medicine

Medicine 可以扩展：

- manufacturer
- batchNumber
- storageRequirement
- prescriptionFlag
- userDefinedReminder

暂时不要实现医疗决策。

---

# 7. 家庭

Domain 中加入：

`Household`

`HouseholdMember`

而不是只设计单用户。

未来可以描述：

- 几个人吃饭
- 饮食偏好
- 忌口
- 过敏
- Vegetarian
- Low-carb 等用户主动设置的偏好

不要擅自推断健康状况。

---

# 8. 核心服务

业务核心拆成：

## Inventory Service

管理：

- 添加
- 删除
- 消耗
- 移动
- 临期
- 查询

## Freshness Engine

计算：

- Fresh
- Eat Soon
- Urgent
- Expired

第一版允许规则 + AI 混合。

关键日期必须允许人工修改。

---

## Recipe Engine

输入：

- 当前库存
- 人数
- 饮食偏好
- 时间
- 用户要求

输出：

- 推荐菜
- 使用哪些现有食材
- 缺什么
- 做法

---

## Shopping Engine

根据：

- 当前库存
- 用户习惯
- 食谱
- 缺货情况

生成补货建议。

Phase 0 不需要预测购买。

---

## AI Orchestrator

负责：

- Intent extraction
- Structured output
- Tool calls
- Recipe generation
- Natural language response

LLM 不能直接修改数据库。

正确方式：

User
→ AI
→ Structured Intent
→ Domain Service
→ Database

例如：

用户：

“牛奶喝完了。”

AI 返回：

```json
{
  "intent": "consume_item",
  "item": "牛奶",
  "quantity": "all"
}
```

然后由 Inventory Service 执行。

---

# 9. AI Provider

统一接口，例如：

```ts
interface AIProvider {
  chat(...)
  structuredOutput(...)
  vision?(...)
  speechToText?(...)
  textToSpeech?(...)
}
```

业务层不得知道当前使用的是：

OpenAI、DeepSeek、Qwen 或 Ollama。

---

# 10. Storage

Local Mode 第一阶段：

SQLite。

以后：

官方 Cloud 使用 PostgreSQL。

Repository 层必须抽象。

不要让 Domain 直接写 SQL。

---

# 11. Local Core

设计一个独立：

`Kitchen Core`

职责：

- Database
- Inventory
- Recipe
- AI Provider
- Device management
- Sync
- API

运行：

Docker

或直接 Node.js。

硬件不应该直接把所有业务写在 ESP32 上。

ESP32 主要负责：

- Input
- Display
- Audio
- Camera
- Connectivity
- Power
- Device state

智能逻辑主要运行于 Kitchen Core / Cloud。

---

# 12. 客户端

## Web / PWA

这是 Local Mode 第一客户端。

必须可以：

- 手机访问
- PC 访问
- 查看库存
- 添加库存
- 今天先吃
- 菜谱
- 设备管理
- AI Provider 设置

---

## 微信小程序

面向 Quick Mode。

未来负责：

- 绑定设备
- 配网辅助
- 官方 Cloud
- 拍照
- 小票
- 订单截图
- 条码
- 查看库存
- 提醒入口

不要强迫 Local 用户依赖微信。

---

## App

不是 Phase 0 必须项。

后续视需求使用 React Native / Expo。

---

# 13. 食材录入优先级

国内版优先：

1. Voice
2. 手机拍照
3. 小票 / 订单截图
4. Barcode
5. Manual

设备 Camera 属于增强能力。

不要把 Camera 作为系统能够工作的必要条件。

---

# 14. Barcode

建立：

`ProductLookupProvider`

未来可以接：

- Open Food Facts
- 国内商品数据库
- 自有数据库

如果查不到：

交给 OCR / Vision / Manual correction。

---

# 15. 屏幕首页

E-Ink 默认不要显示数据库列表。

默认界面：

```text
今天先吃

🥬 菠菜       今天
🍓 草莓       1 天
🥛 牛奶       2 天

今晚推荐

番茄牛腩
约 35 分钟
```

可以切换 Persona Theme。

---

# 16. 情绪价值

系统预留：

`Persona`

和：

`Theme`

例如：

- Minimal
- Cat
- Pixel
- Cute
- Retro

提醒可以根据 Persona 改写。

但库存事实不能因为 Persona 改变。

---

# 17. 隐私模式

系统明确区分：

## Official Cloud

最简单。

## BYOK

用户自己的 AI API。

## Local AI

例如 Ollama。

要求：

Local Mode 核心库存数据在没有用户主动启用云同步时不能上传官方服务器。

---

# 18. 设备身份

未来官方硬件每块板可拥有：

- Device ID
- Device Certificate
- QR Code

用于：

- 绑定
- OTA
- 官方服务
- 售后

但自行打板用户依然能够运行完整开源版本。

---

# 19. 开源边界

建议后续讨论后确定最终 License。

暂定原则：

开放：

- Firmware
- Core
- Web
- Protocol
- Hardware schematics
- SDK
- 3D reference design

商业能力可以包括：

- Official Cloud
- Managed AI
- Automatic OTA service
- Official device identity
- Premium themes
- Official hardware
- Support

核心商业价值是：

**Convenience，而不是人为锁死。**


---

# 20. 已有硬件与固件资产

项目不是从零开始。

当前已有：

**ESP32-S31-Korvo-1 V1.1**

并且已经基于该板开发过智能工牌，固件已经跑通。

因此系统架构额外遵守：

## Hardware Abstraction

Kitchen Core 和 Domain 层不得依赖 Korvo。

Firmware 层增加：

```text
Board Support Layer
        ↓
Device Capability Layer
        ↓
Kitchen Device App
```

其中 Board Support Layer 负责：

- ES8389
- 双麦
- Speaker
- Camera
- LCD
- Touch
- Button
- Wi-Fi
- BLE
- microSD
- Power/USB
- 其他板级能力

Kitchen Device App 只负责：

- Push-to-talk
- Food/Inventory interaction
- Kitchen UI
- Device protocol
- Display rendering
- Camera capture request
- Device state

这样以后从 Korvo PoC 切换到自研 Kitchen AI Core Board 时，不需要重写 Kitchen 业务协议。

---

# 21. PoC 显示策略调整

此前长期产品方向仍然可以考虑 E-Ink。

但当前已有 Korvo 板，因此：

## Phase 1

优先使用现有/配套 4.3 英寸 LCD 完成真实硬件交互。

目的是验证：

- Voice UX
- 食材添加
- Today First
- Recipe
- Cooking Mode
- Device communication
- Camera capture
- 手机/Web 同步

## 定制板以后

再根据目标 SKU 决定：

- E-Ink
- Color E-Ink
- LCD
- 无屏语音版

不要为了最终形态，在 PoC 阶段提前增加硬件依赖。

---

# 22. Camera 策略

ESP32-S31-Korvo-1 V1.1 已有 DVP Camera 能力。

所以真实硬件 PoC 可以尽早验证：

- 拍摄包装
- 拍摄食材
- 拍摄条码
- 上传图片到 Kitchen Core
- Vision Provider 结构化识别

但 Camera 仍不是库存系统唯一入口。

系统必须继续支持：

Voice / Web / Mini Program / Manual。

---

# 23. 现有智能工牌代码的迁移原则

不要把“智能工牌业务逻辑”带进 Kitchen Domain。

建议把现有固件划分：

```text
Reusable:
- board init
- audio
- codec
- network
- camera
- lcd
- ota
- logging
- transport

Badge-specific:
- badge workflow
- badge backend contract
- badge UI
- badge prompts
- badge business state

Kitchen-specific:
- kitchen protocol
- kitchen UI
- push-to-talk workflow
- food capture workflow
```

只复用 Reusable 部分。

如果现有网络协议已经足够通用，可以适配；否则通过 Adapter 保留旧实现，不要让 Kitchen Core 被智能工牌协议绑死。
