# HomeStash：开源的家庭物品管理软硬件项目

**家的小事，不必全靠记性。**

HomeStash 将家庭物品管理软件与交互硬件结合起来，帮助你记住家里有什么、什么要先用、还需要买什么。首个应用 **FreshMate 智能冰箱贴**面向冰箱与厨房：用语音记录食材，在屏幕上查看库存与提醒，按现有食材选菜，并在做完饭后核对消耗。

**硬件与软件是项目同等重要的两个部分。** 硬件提供随手可用的语音、拍照和屏幕入口；软件负责库存、采购、食谱、数据与设备管理。两者通过统一设备协议协作，软件也可以独立通过浏览器使用。

当前使用的 **ESP32-S31-Korvo-1 V1.1 开发板用于原型开发与功能验证**。我们会尽快做出一款**更便宜、更适合日常使用的硬件**；具体选型、成本和交付时间尚未确定。

[项目官网](https://homestash.bebackpacker.com) · [源码仓库](https://github.com/congcong-ai/homestash) · [MIT 许可证](LICENSE) · [参与开发](CONTRIBUTING.md)

## 项目概览

HomeStash 是通用家庭物品管理底座，FreshMate 是第一个场景应用。现有物品分类包括食品、药品、保健品、宠物食品、日用品、护肤品和其他物品；厨房以外的专用流程与设备仍需继续适配。

| 组成 | 职责                                                       | 当前实现                                              |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------- |
| 硬件 | 采集语音与照片、显示状态、播报结果、提供按键与触摸交互     | Korvo 原型板、独立 ESP-IDF 固件、配网、断网恢复与 OTA |
| 软件 | 管理家庭物品与采购、推荐食谱、陪伴做饭、保存数据与管理设备 | Web 界面、Core 服务、SQLite 数据库、AI 与语音适配     |

项目处于可运行的原型阶段。以下能力依据当前源码整理，验收状态截至 **2026-10-22**；历史测试记录不代表设备此刻在线，也不代表消费级产品已经完成。

## 硬件

### 当前原型

当前唯一完成真实板级适配的目标是 **ESP32-S31-Korvo-1 V1.1**，构建目标名为 `korvo-s31`。

| 部分                        | 在 FreshMate 中的作用                                   |
| --------------------------- | ------------------------------------------------------- |
| 麦克风、ES8389 音频与扬声器 | SET 按键录音，上传 Core 识别与处理，再播报结果          |
| LCD 与触摸屏                | 展示首页、库存、临期、菜谱等页面，配置网络、Core 和更新 |
| SC101IOT 摄像头             | MODE 按键拍照，上传后在 Web 核对识别候选                |
| Wi-Fi                       | 连接 Core，同步设备状态与业务页面                       |
| BLE                         | 在设备主动开启的限时窗口内，加密下发 Wi-Fi 与 Core 配置 |
| microSD 与持久化配置        | 保存待处理媒体、支持录音恢复，保留网络与设备设置        |
| 双槽 OTA                    | 经设备确认安装应用更新，校验镜像并支持启动回滚          |

设备通过网络连接运行 Core 的电脑或服务器，不在开发板上运行大模型。真实语音当前接入百炼 ASR/TTS，模型密钥保留在服务端。

### 已验证与待验证

- 已有真机记录：SET 录音 → 语音识别与库存处理 → LCD/Web 同步 → 扬声器播报；相机采集与上传；LCD 手动配网；Mac 客户端 BLE 加密配网；OTA 与部分断电、恢复场景。
- 核心原型验收基线为 **0.3.5**，后续日常固件 **0.4.3** 已完成 BLE 等增量真机验证。当前源码默认版本 **0.5.0** 已完成构建及主机验证，**尚未刷入设备完成真机回归**。
- 受控定时休眠与短时连续观察已有记录；复杂弱网、多天运行、电流与续航仍待验证。手机 BLE 配网页面尚未实现，独立 USB 扫码枪专项不代表日常固件已集成扫码枪。
- 相机拍摄和上传成功不等于食材识别准确；识别结果需要人工核对。

完整范围见 [硬件集中验收](docs/PHASE_1_ACCEPTANCE.md)、[日常 BLE 配网](docs/DEVICE_BLE_PROVISIONING.md) 和 [相机复测](docs/CAMERA_RETEST_REPORT.md)。

### 后续日用硬件

Korvo 用于验证产品交互和软硬件链路。后续硬件将以**低成本、适合家庭日常摆放与操作**为目标，按真实使用需求确定体积、供电、显示、音频及相机等配置，不直接照搬开发板的全部外设。

固件已经拆分为公共 FreshMate 应用、公共 ESP-IDF 服务和板级适配器，便于新硬件复用现有业务。**第二块物理板尚未适配，自研 PCB 和最终硬件方案尚未完成。** 新板仍需重新验证音频、供电、存储恢复和升级等能力。参见 [固件复用与新板接入](docs/FIRMWARE_PORTABILITY.md)。

### 硬件开发入口

从仓库根目录执行：

```sh
pnpm hardware:targets
pnpm hardware:build:generic --board korvo-s31
```

构建依赖锁定的 **ESP-IDF 6.2 开发版**，提交为 `ab95e70748f2eddac6f87217b0cf62533684a6ba`，并非任意 ESP-IDF 安装均可直接使用。构建脚本默认使用 `$HOME/esp/esp-idf-smartbadge`；可通过 `HOMESTASH_IDF_PATH` 和 `HOMESTASH_IDF_PYTHON_BIN` 指定 SDK 与 Python 环境。

通用构建不嵌入本机网络和设备凭据，应用产物为 `firmware/freshmate-korvo/build/homestash_freshmate.bin`。首次烧录需先核对设备身份和完整 Flash 备份；已有兼容分区的设备可走 Web 发布、设备确认的 OTA 流程。同一芯片不代表不同板型的固件可以互刷。

设备接口默认仅绑定本机。真机接入需配置 `DEVICE_HOST`、设备凭据及可达的 Core 地址；设备使用独立接口端口，默认起始值为 `3101`，不是 Web 端口或 Core 管理端口。若启动时端口变化，需同步核对设备配置。

详细操作：[固件构建与烧录](firmware/freshmate-korvo/README.md) · [设备配置与 OTA](docs/DEVICE_SETUP_AND_OTA.md) · [设备协议](docs/DEVICE_PROTOCOL.md)

## 软件

### 当前功能

| 功能           | 当前行为                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------- |
| 家庭库存       | 七类物品，按批次保存数量、单位、位置、开封与日期信息；支持搜索、筛选和临期提醒           |
| 库存操作与纠正 | 添加、补货、消耗、用完、丢弃、移动和开封；保留事件历史，支持受条件限制的最近操作纠正     |
| 文字与语音指令 | 记录购买、查询余量与位置、查看优先食用项；歧义批次不猜测修改                             |
| 图片与条码入库 | 图片/小票提取候选；条码支持本地商品记忆与可选外部查询；核对后确认入库                    |
| 采购与待确认   | 手动或按菜谱缺口生成清单；标记买到后核对实际购买信息；统一处理待确认与失败记录           |
| 食谱与陪做饭   | 按库存、人数和要求推荐菜谱，查看缺货、逐步做饭与问答；保留进度，做完后明确确认才扣减库存 |
| 备份与恢复     | 导出家庭业务数据，校验与预览后覆盖恢复；恢复前自动保存快照                               |
| 设备管理       | 多设备登记、独立凭据与状态、停用及重新签发、按板型管理固件；另有软件模拟器               |
| 手机访问       | 提供带登录的家庭局域网开发入口；真实手机体验仍待验收                                     |

采购 → 核对入库 → 选菜 → 做饭 → 确认消耗 → 再次补货的软件流程已有隔离数据库验收，覆盖重启、重放和进度恢复。详见 [日常流程验收](docs/DAILY_WORKFLOW_ACCEPTANCE.md)。

### 数据与 AI

- **本地优先**：库存、事件、采购、设置、设备和做饭进度保存在部署机器的 SQLite，不向 HomeStash 官方云同步。
- **默认无需模型密钥**：Mock 使用有限中文规则与模板，适合先体验流程；它不代表真实大模型或语音识别效果。
- **可配置外部或自托管模型**：支持 OpenAI-compatible 服务。使用外部模型、视觉或云端语音时，相关文字、图片、音频或播报文本会发送给所配置的服务。
- **业务规则负责落库**：模型不直接操作数据库。图片候选与采购入库需确认；做饭完成先核对用量，再明确确认扣减。模型错误不会静默回退为 Mock 假装成功。

这是自行部署的开源项目，官网用于介绍项目，不提供公共家庭库存托管。当前为单家庭数据与单账号访问保护，尚无多家庭隔离、成员角色、云同步或自动下单采购。PWA 已有基础资源，手机安装、离线操作和浏览器语音仍未完成真机验收。

设置页支持新增、重命名家庭存放位置；库存批次可自定义开封提醒天数、关闭提醒或恢复默认。详见[家庭位置与日期规则](docs/HOUSEHOLD_LOCATIONS_AND_DATES.md)。家庭时区可在设置页选择，库存提醒、食谱、语音与设备投影统一按家庭日期；旧数据默认UTC，切换不会改写已录入日期，见[家庭时区与日期](docs/HOUSEHOLD_CALENDAR.md)。

日期与新鲜度仅供提醒，应结合包装、储存条件和实际状态判断；药品分类仅用于库存管理。

### 软件技术栈

Web 使用 **Next.js 16、React 19、Tailwind CSS 4**；Core 使用 **Fastify、TypeScript**；数据库使用 **SQLite、Drizzle ORM**。Web 通过同源代理访问 Core，真实设备使用独立认证接口。

## 快速上手

### 本机运行

需要 **Node.js 22+、pnpm 9.15.9**。macOS/Linux 需提供 `lsof`；Windows 可使用 WSL。无需 Docker。

```sh
git clone https://github.com/congcong-ai/homestash.git
cd homestash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

默认入口：

| 入口     | 地址                               |
| -------- | ---------------------------------- |
| 项目首页 | http://127.0.0.1:3000              |
| 我的厨房 | http://127.0.0.1:3000/app          |
| 更多应用 | http://127.0.0.1:3000/applications |

启动器先检查端口，停止本仓库目标端口上的旧服务；其他项目占用时向后选择空闲端口。Core 就绪后启动 Web，**以终端输出的实际地址为准**。默认仅本机可访问，Ctrl+C 结束服务。

首次启动自动创建 `data/homestash.db`，不自动填充演示数据，重启保留记录。可先试用：

1. 在“我的厨房”输入 `买了两个西红柿、一盒草莓和十个鸡蛋。`，检查生成的库存。
2. 查看批次、位置与日期，试用开封、消耗和操作历史。
3. 输入 `今晚两个人吃什么？`，选择菜谱并查看缺少的食材。
4. 开始做饭，尝试下一步与用量问答；做完后核对用量，再决定是否扣减。

Mock 只识别有限句式。软件模拟器用于协议与界面联调，不代表真实硬件效果。

### 手机局域网试用

手机与电脑连接同一可信家庭 Wi-Fi，在仓库根目录运行：

```sh
pnpm dev:lan
```

用手机打开日志中的 `/app` 地址。首次未配置账号时，登录凭据自动生成并保存在本机 `data/lan/access.txt`；已有有效登录配置时沿用。Core 管理接口仍仅监听本机。

这是 HTTP 开发试用入口，不用于公网。当前已验证 LAN HTTP 登录与 API 链路，手机布局、手持操作、安装与离线能力仍待验收。详见 [手机局域网访问](docs/LOCAL_MOBILE_ACCESS.md)和[手机模拟验收](docs/MOBILE_WEB_ACCEPTANCE.md)。

### 配置模型与语音

默认保留 `.env` 中的 `AI_PROVIDER=mock` 即可使用基础流程。启用真实模型时：

1. 在 `.env` 填写 `AI_API_KEY`，重启 Core；自托管服务可按其要求留空。
2. 在应用设置中选择 OpenAI-compatible，填写包含 `/v1` 的服务根地址和模型名。
3. 图片识别使用 `AI_VISION_MODEL`，复用服务端地址与 Key。真实百炼语音需配置 `SPEECH_PROVIDER=bailian` 及相应模型，见 [.env.example](.env.example)。

`AI_PROVIDER`、`AI_BASE_URL`、`AI_MODEL` 是尚未保存应用设置时的默认值，界面保存的设置优先。条码默认仅查本地商品记录；显式设置 `PRODUCT_LOOKUP_PROVIDER=open-food-facts` 后才向外部商品库查询。

### 构建与部署

本机生产构建预览：

```sh
pnpm build
pnpm start
```

服务器采用 Node.js、pnpm、PM2、Nginx、HTTPS 与 SQLite 的原生部署方式。先在 `.deploy.env` 配置目标和审计后的端口：

```sh
cp .deploy.env.example .deploy.env
pnpm server:install --check
pnpm server:install
pnpm server:deploy
```

`server:install` 用于首次准备环境；首次发布与日常更新均使用 `server:deploy`。部署包含隔离构建、健康检查与失败代码回滚，数据库独立保存在共享目录，代码回滚不会回滚数据库。公网内部测试后台使用独立登录页，设备接口默认关闭。完整配置与备份步骤见 [部署说明](docs/DEPLOYMENT.md)。

日常可在“设置 → 数据备份与恢复”导出家庭业务备份；其中不包含机器 AI 配置、设备凭据和媒体。直接复制 SQLite 文件时先停止 Core，避免遗漏运行中的 WAL。详见 [备份与恢复](docs/DATA_BACKUP_AND_RESTORE.md)。

## 开发与文档

### 仓库结构

```text
firmware/
  apps/freshmate_app/        共享 FreshMate 产品流程
  common/components/        公共设备服务与板级能力契约
  freshmate-korvo/           Korvo 工程、驱动与界面适配
  diagnostics/              独立硬件诊断工程
  targets.json              构建目标与 SDK 锁定信息
vendor/espressif/            原厂板级支持与第三方来源
apps/web/                   项目首页、厨房 Web 与设备模拟器
services/kitchen-core/      库存、AI、食谱、设备与备份服务
packages/
  domain/                   物品模型与库存业务规则
  database/                 SQLite 持久化与版本化迁移
  ai/                       模型、规则解析与语音适配
  protocol/                 设备事件、状态、命令与媒体契约
  recipes/                  食谱与烹饪流程
  api-client/               Web API 客户端
scripts/                    启动、部署与硬件开发工具
tests/                      软件与协议自动化测试
docs/                       使用说明、架构与验收证据
data/                       本机运行数据与私密配置，不提交 Git
```

### 开发检查

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

测试使用临时目录或内存数据库。固件构建、软件测试与真实板卡验收分别记录；换板后需要重新做适用的真机验证。

### 文档索引

| 主题           | 文档                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 系统与开发进度 | [架构](docs/ARCHITECTURE.md) · [整体进度与历史记录](docs/BUILD_STATUS.md)                                                                                           |
| 硬件开发       | [Korvo 固件](firmware/freshmate-korvo/README.md) · [固件复用](docs/FIRMWARE_PORTABILITY.md) · [来源审计](docs/FIRMWARE_REUSE_AUDIT.md)                              |
| 设备交互与维护 | [屏幕页面](docs/KORVO_SCREEN.md) · [设备管理](docs/DEVICE_MANAGEMENT.md) · [配置与 OTA](docs/DEVICE_SETUP_AND_OTA.md) · [BLE 配网](docs/DEVICE_BLE_PROVISIONING.md) |
| 入库与采购     | [图片入库](docs/IMAGE_INTAKE.md) · [条码入库](docs/BARCODE_INTAKE.md) · [采购与待确认](docs/SHOPPING_AND_REVIEW.md)                                                 |
| 库存与做饭     | [批次与纠正](docs/INVENTORY_BATCHES_AND_CORRECTIONS.md) · [陪做饭](docs/COOKING_MODE.md) · [完整流程验收](docs/DAILY_WORKFLOW_ACCEPTANCE.md)                        |
| 数据与部署     | [备份恢复](docs/DATA_BACKUP_AND_RESTORE.md) · [局域网访问](docs/LOCAL_MOBILE_ACCESS.md) · [服务器部署](docs/DEPLOYMENT.md)                                          |
| 硬件验收       | [核心 PoC 验收](docs/PHASE_1_ACCEPTANCE.md) · [BLE 增量验收](docs/DEVICE_BLE_PROVISIONING.md) · [恢复验证](docs/RECOVERY_VALIDATION.md)                             |

## 许可证

HomeStash 自有代码采用 [MIT 许可证](LICENSE)，允许使用、修改、分发与商用，需保留版权及许可声明。第三方固件、字体与依赖遵循各自许可证；外部模型、语音服务与硬件费用另计。
