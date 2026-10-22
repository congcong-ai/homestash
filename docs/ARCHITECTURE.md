# HomeStash 架构与 Phase 0 边界

HomeStash 是开源、本地优先的 AI 家庭库存平台；FreshMate 是第一款食品/厨房产品。本文落实三个 KORVO_V2 文档及用户最新命名/硬件约束；原始需求文档保留原样。Phase 0 已完成，当前正在补齐 Phase 1 产品主流程；整体状态见 [功能进度](BUILD_STATUS.md)。

## 执行链

Web/Device Simulator → Fastify Kitchen Core → AIProvider/Parser → Zod Structured Intent → InventoryService → Repository → Drizzle/SQLite。

Domain 不导入 Next.js、Fastify、Drizzle 或 Korvo。InventoryItem 支持七类家庭物品，Location、Household、HouseholdMember 独立。单家庭 local 是当前运行方式；多家庭登录、授权和切换未实现。FreshMate 的食谱仅读取 food 类别，不提供医学建议。

SQLite 保存物品快照、不可覆盖的事件、设备、设置、烹饪会话与幂等回执。事件包含前后快照；数量为0仍保留历史。InventoryService 校验动作与位置，Repository 在事务中同步保存当前值和事件。AI 批量动作、设备事件与请求回执在同一个事务中提交；同请求 ID 重放返回原结果，内容改变则拒绝。异步 AI 调用在事务外完成，再串行提交，避免持锁等待网络。Phase 0 是单 Core 进程；不支持多进程写协调。

初始迁移 `packages/database/migrations/0001_initial.sql` 通过 schema_migrations 检查仅执行一次。后续表结构变更新增编号 migration 并扩展 runner，不修改已执行文件。Drizzle 表以 JSON 存储通用库存快照，SQL 表保留独立实体/事件，方便早期领域迭代；大规模检索应新增列/索引迁移。

## 推荐和日期

Freshness Engine 按到期日期、建议食用日期、批次开封提醒（食品默认2天，可自定义或关闭）的最早时间计算 fresh/eat_soon/urgent/expired。默认日期按 UTC 日界线，Phase 0 不支持家庭时区设置。规则只作提醒，包装日期可以手动修改，不能保证食品安全。模拟解析器建议日期标记 estimatedDate，用户可以覆盖。过期食品不进入可用食谱库存。

本地 Recipe Engine 从4个明确模板匹配现有食材，返回3道菜，按人数缩放，标注已有/缺少食材；单位无法匹配时要求核对，不猜换算。缺货清单由食谱推导，无预测采购。Cooking Mode 保存食谱快照、当前步骤和问答；烹饪不自动扣库存，由用户确认实际消耗。

## AI 与隐私

MockAIProvider 是明确的有限中文规则解析器，无外部调用。OpenAICompatibleProvider 真实实现 `/chat/completions` HTTP adapter，带超时、JSON 请求、Zod 结果校验；没有真实服务密钥时不声称模型联调成功。测试用本地 HTTP 服务验证契约和错误路径。通过 Provider 接口可扩展官方云或本地模型，当前不实现官方云。STT/TTS 已通过独立语音 Provider 接入百炼，Vision 已通过 OpenAI-compatible 多模态请求接入，输出只作为待审核候选。

用户选择外部 provider 后会向其发送输入文字和结构化意图 schema，不发送完整库存数据库；界面明确说明。API Key 只通过 Core 环境注入，不在数据库、浏览器或固件保存。Settings 只公开 keyConfigured 布尔值。默认 mock 不需要 Key、不依赖微信或官方云。

## Web 和服务边界

Next.js 是客户端与同源 `/api` 代理，Fastify 是独立 Core。日常 `pnpm dev` 的 Web/Core 默认仅监听127.0.0.1；显式 `pnpm dev:lan` 将 Web 绑定实际家庭私有IPv4，并强制启用已有的单账号签名Cookie登录。凭据自动生成至忽略的 `data/lan/` 或复用已有环境配置，不能通过关闭登录进入LAN模式。Core仍只监听回环地址，API由Next同源代理；Core拒绝未知浏览器Origin。真实设备另用独立监听器和设备凭据，不共享家庭网页登录会话。当前没有多家庭账号体系。手机尺寸与主要交互已通过Chrome触屏仿真验收，真实手机按用户要求跳过；不能将仿真或HTTP接口验证称为真机实测。

原生语义表单/按钮与Tailwind CSS 与统一组件样式构成当前界面；没有引入企业后台模板。PWA manifest、图标与离线提示已实现；Core 离线时不能写库存，不缓存 API 的旧响应伪装实时状态；浏览器每3秒刷新状态，断连显示上次读取提示。

模拟器集成在 Web 的“冰箱贴”页，共用 packages/protocol，不建立重复 UI 工程。设备可以模拟按键、文本语音、拍照元数据、Wi-Fi、电量、在线/离线、休眠；心跳45秒过期，手动发送便于测试离线。没有真实媒体处理或物理电量测量。

## 固件边界

`firmware/freshmate-korvo` 已建立独立固件，按 Board/Drivers → Device Capability → FreshMate App 分离。BSP 来源、引脚与 SDK 以只读 SmartBadge 审计为准。尤其 Camera BSP 存在不等于工牌应用已抓图；BLE 产品配网已作为独立能力组件接入（手机前台仍待实现），OTA 已独立接入，TTS 已在 Core 生成并由现有 Speaker 播放。

## Phase 1：真实设备接入

新增独立设备监听器 3101，仅提供认证后的录音、JPEG 图片和心跳接口。Web/Core 管理 API 保持 loopback；设备不能访问设置接口。百炼 Key 仅驻留 Core。`SpeechProvider` 不接触数据库：ASR 文本经既有结构化意图和 Domain Service 提交；TTS 在提交后独立生成和缓存。

固件已在 `firmware/freshmate-korvo` 独立构建，BSP 来源和哈希见 `FIRMWARE_IMPORT_MANIFEST.json`。此次用户明确允许将原开发板完整 Flash 备份保存到 SmartBadge 的忽略目录；该授权不包括修改 SmartBadge 源码。

## 录音持久化与重试

设备在 SD 独立目录中以 UUID 文件名保存录音。`.part` 表示录制过程，校验并同步后转换成 `.wav`；已完成播报的文件先转换成 `.done` 再清理。重新启动可用已落盘的完整样本补全录音长度；未知或损坏格式保留并报错。

待上传录音的字节和 UUID 在重试时保持不变。Core 将音频 SHA-256、Domain 变更和处理回执绑定到同一幂等键；HTTP 响应丢失不等于库存事务失败。语音合成和播放在库存提交后独立重试，不能因为播报失败重新执行库存操作。

## 语音烹饪与消耗确认

烹饪由 Core 的 `cookingService` 协调，`packages/recipes` 提供食谱、规则问答和批次消耗计划；通用 Inventory Domain 不依赖 FreshMate 或板卡。Provider 上下文只含候选菜名、人数与任务摘要。操作依次经过结构化意图、状态校验和事务。会话保存 active / awaiting_confirmation / completed 状态；确认前保留具体批次版本，确认后原子保存库存事件、任务和回执。语音回执统一包含菜名和步数，同一结果供设备 LCD、TTS 与 Web 使用。详细边界见 [语音烹饪](COOKING_MODE.md)。

## 库存查询、购物与生成式菜谱

`inventoryAssistant` 将结构化查询和操作接到真实 Repository/InventoryService。查询仅返回数据库事实，播报做长度摘要；开封、移动、消耗和丢弃继续记录通用事件。购物清单属于 HomeStash Domain，保存于现有 `app_state.shopping`，标记已购买不等于确认入库。食谱缺货先查询，再由用户明确加入清单；不推测采购、不自动购买。

AI Provider 可生成经过 Zod 校验的菜谱草稿和当前步骤问答。仅向模型提供可用食品的名称、数量和单位摘要，以及用户人数、要求；不发送完整批次、库存事件或密钥。Core 负责分配菜谱 ID、核算实际已有/缺少食材，并将生成目录存于 `app_state.recipe-catalog`。模型失败时保留旧目录并报错，不静默伪装成本地生成成功。Mock 仍走本地模板和规则。上述状态扩展没有修改历史 migration。

## 图片候选与确认入库

Domain 共享 `ImageRecognition` / `ImageReview`，AI Provider 负责结构化视觉提取，Core 保存候选并执行用户确认。浏览器上传有上限的图像数据，模型识别与库存写入分开；只有确认后的选中候选进入通用 InventoryService。图片原始字节不写数据库，候选依据和图片摘要保存在本机。确认事务同时保存物品、事件、审核状态和幂等回执；取消不更改库存。Web 图片与真实 Camera 二进制上传共用 `imageIntake.analyze`，设备端只创建候选，不绕过确认。相机文件恢复与采集 ID 独立于录音，互不混用。[详细边界](IMAGE_INTAKE.md)。

## 真实设备页面投影

`deviceScreen` 将当前库存、临期规则、菜谱、烹饪任务和购物清单转成受限的只读文字页面。3101 设备接口只返回当前页摘要与 revision；不复用完整管理接口，也不向固件发送模型 Key。固件通过独立任务在空闲时约每5秒读取，不阻塞主循环等待 AI；本次操作结果会保留到用户点击页面导航。触摸导航仅切换显示，不会修改库存或触发隐式做饭扣减。具体边界见 [LCD 页面](KORVO_SCREEN.md)。

## 设备配置与固件发布

`device_config` 使用独立 NVS 命名空间 `hs_device`，原子保存 Core 地址、设备 ID 和设备 Token；`hs_wifi` 只在获得 IP 后保存手动网络。通用固件不含预置网络和设备凭据，首次配置通过 LCD，已有配置跨升级保留。Transport 每次请求读取配置快照，设备 Token 不回传 Web。

Core 校验 ESP32-S31 应用头、项目名、版本、分段校验和及附加 SHA-256，将固件存于数据库旁的私有目录；发布状态使用现有 `app_state`，没有修改历史 migration。设备下载仅使用固定认证路由。manifest 以设备 Token 作 HMAC-SHA256 认证，设备再验证长度、SHA-256、SDK 镜像和应用描述后切换启动分区。HMAC 不等同于硬件安全启动签名；局域网 HTTP 仍不提供链路保密性，不能当成公网量产更新方案。

分区保留原 NVS/PHY/factory，追加 OTA 选择区和两个 4 MiB 应用槽。首次安装需 UART 和已核验的整片恢复镜像；正常 OTA 只写非运行槽。启用 SDK 自动回滚，新应用启动后通过本地基础初始化并运行30秒才标记有效；SD 初始化失败请求回滚。网络不通不会立即造成回滚。具体真机结果和未验收项见 [设备维护](DEVICE_SETUP_AND_OTA.md)。

## Korvo受控休眠与验收遥测

`components/power`负责Idle/Active/Light Sleep/Deep Sleep状态及1至10秒范围的定时睡眠，App提供固定3秒实验命令。实验通过现有上传队列串行执行，录音/待处理媒体/未完成启动确认时拒绝；先由Wi-Fi管理任务暂停网络，再由LVGL适配器暂停显示、保留UI对象并释放LCD panel/DMA，最后进入睡眠。Light Sleep返回后使用原BSP重建LCD panel、恢复LVGL和背光，再连接保存过的网络，Deep Sleep通过定时唤醒重启并从NVS/SD恢复。不是自动睡眠策略，未声明SET/触摸唤醒或电源域全部关闭。

SDK的PSRAM半睡恢复路径曾触发IWDT；HomeStash配置中禁用这一选项进行隔离，保留SDK和看门狗。设备心跳报告powerState、OTA确认状态、内部空闲堆和历史最低空闲堆。`hardware:acceptance`从Core与只读SQLite采样，不调用模型或修改库存。

## 条码商品查询

Domain 定义 `Barcode`、`ProductCandidate` 和 `ProductLookupProvider`，与模型和Korvo解耦。Core先查本地已确认商品，只有显式配置才调用Open Food Facts；默认不会向外发送条码。查询只产生待确认记录，用户核对后经Inventory Service、同一事务创建库存事件与幂等回执。商品目录只复用名称、类别及必要来源，批次数量和日期不跨批次继承。复用既有app_state，不改历史migration。详情见 [条码入库](BARCODE_INTAKE.md)。

## BLE 配置能力

日常固件的 `components/provisioning` 复用乐鑫 protocomm BLE / Security 1，自定义 `hs-config` JSON端点。官方组件只负责会话、加密和传输；Wi-Fi仍交给原有管理器，获得IP并保存网络后才提交Core字段。配置通过UUID和内容摘要防止重复及冲突；显式窗口内与录音、相机、OTA和睡眠互斥。PoP仅LCD和受限本机UART可读，不进入心跳。LVGL内存池通过官方属性放在PSRAM，保留内部RAM供控制器与DMA。Mac客户端与真机验证范围见 [BLE配网](DEVICE_BLE_PROVISIONING.md)。

## 多设备与固件可移植性 · 2026-10-21

后台通过managed-devices分别保存设备身份、凭据摘要、状态和能力；设备接口按认证身份隔离幂等回执、TTS任务和缓存。physical-device仅保留最近通信的兼容投影，不再作为新设备管理的唯一事实来源。旧环境凭据只导入一次；撤销或重新签发不会被Core重启覆盖。复用现有app_state，不改历史migration。

固件应用位于firmware/apps/freshmate_app，公共ESP-IDF能力位于firmware/common/components；Korvo工程只负责目标配置、板级实现与入口。device_port是编译时接口，板型由目标manifest和镜像内标记绑定；公共应用不引用BSP、GPIO或LVGL。后台按boardId独立维护固件与下载权限。具体取舍、SDK边界、可选硬件、兼容和验证见 [固件复用](FIRMWARE_PORTABILITY.md) 与 [设备管理](DEVICE_MANAGEMENT.md)。

## 采购与统一待确认

ShoppingService.receive通过InventoryService创建批次，在同一Repository事务中保存购物来源、实际入库快照、购物状态和库存事件；HTTP幂等回执与其一起提交。购物来源ID提供跨新请求ID的重复保护，已完成后内容不一致则拒绝。勾选已购买不等于入库，日期由用户核对。

待确认中心从既有图片/条码索引、已买购物项和最小失败记录汇总，不建立平行候选数据库。失败的异步模型调用不写库存；只保存重试标识，成功时原子清除失败记录并创建候选。原图不保存，图片重试需用户重选；未完成表单草稿暂不持久化。详情见[采购与待确认](SHOPPING_AND_REVIEW.md)。

## 批次与事件纠正

库存卡片以InventoryItem.id为批次身份，同名物品不合并。freshnessInfo统一解释最早提醒日期和估算来源；保持既有提醒阈值。完整批次事件通过独立接口读取，避免最近50条全局摘要遗漏批次历史。

InventoryService.correct仅恢复当前批次最近一次未纠正事件的before快照；误创建恢复为数量0。ITEM_CORRECTED保留原事件引用与原因，版本递增；不修改历史事件、不重开购物或烹饪任务。HTTP请求回执、库存与事件同事务提交。新库存网页动作提交expectedVersion和requestId；旧设备动作保持兼容，尚未统一版本前置条件。详见[批次与纠正](INVENTORY_BATCHES_AND_CORRECTIONS.md)。

## 家庭备份与恢复

备份采用版本化JSON业务载荷，白名单导出家庭/位置、库存/完整事件、购物/候选/商品、菜谱/烹饪、业务回执及旧请求拦截信息，不导出设备认证、机器AI设置或媒体文件。导入先校验事件连续性、快照与引用、支持状态和SHA-256，再核对预览时的业务指纹。

恢复通过Core同一串行提交队列执行，先同步写恢复前快照，再在SQLite事务中覆盖业务表和状态、保存恢复回执。机器配置与固件指针保留。数据代次使排队旧任务与旧网页写入失效；旧回执阻止设备重传把备份时间之后的操作再次执行。API客户端传代次头，旧设备保持兼容；不声称控制了尚未提交的离线意图。详情见[备份与恢复](DATA_BACKUP_AND_RESTORE.md)。

## 日常续做与购物复核

同菜、同人数且尚未结束的CookingSession在再次start时直接继续原快照，包括awaiting_confirmation；不重新分配会话或改变步骤。网页对不同菜/人数的替换先展示确认，提交原sessionId/revision进行校验，旧API兼容保留。

ShoppingService.syncRecipe在事务内同步特定食谱来源的未购买计划项，已齐则移除，手动及已购记录保留。已买但未入库的对应项先走待确认，不重复创建待购项，也不充当实际库存。整链和恢复验证见[日常验收](DAILY_WORKFLOW_ACCEPTANCE.md)。

## 本地手机试用启动

启动器在绑定前检查端口，仅停止本项目旧监听者，保留其他项目并选择空闲端口。Core健康检查包含每次启动的随机实例标识，避免把占端口的其他实例当作就绪。Web和Core端口通过环境变量传递，同源代理指向实际Core端口。局域网模式禁止生产运行；生产沿用独立HTTPS部署流程。私有IPv4只控制监听接口，不提供网络加密或家庭成员角色隔离。HTTP局域网页面不注册Service Worker；不声称具备离线写入、安装或浏览器麦克风能力。[使用与验收边界](LOCAL_MOBILE_ACCESS.md)。

## HTTP局域网客户端兼容

浏览器请求ID统一由api-client生成，安全上下文优先使用randomUUID，HTTP环境使用getRandomValues生成UUID v4，无安全随机数则拒绝操作。各组件仍保存原待重试ID，不因刷新消息或请求失败重发不同ID；服务端幂等协议不变。窄屏行布局允许换行，文件输入不依赖原生最小宽度。[仿真与验证边界](MOBILE_WEB_ACCEPTANCE.md)。

## 家庭位置与批次规则

LocationService属于HomeStash Domain，校验唯一名称、当前名称冲突与数量上限；既有locations表保存名称和稳定ID，Core通过同源/登录/数据代次检查及once事务提交。语音Provider上下文提供当前有限的位置ID/名称列表，真实库存变更仍由InventoryService执行。开封规则是可选库存字段，旧数据不回填；库存事件、纠正、备份以及统一freshnessInfo共同使用该字段，不在Web或设备另建日期算法。具体范围见[家庭位置与日期规则](HOUSEHOLD_LOCATIONS_AND_DATES.md)。
