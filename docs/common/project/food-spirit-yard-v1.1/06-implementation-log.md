# V1.1 实施记录

2026-11-05 现场工作区已有小院 Web、yard.ts、语音配置与目录迁移，均作为保留基线。原始状态摘要保存在 /tmp/homestash-v11-audit；不提交整个工作区。

实施顺序：修复许可/预览/保存一致性并补临时库回归；补独立 T5 产品状态机与本地音频播放；接通设备小院屏幕；验证 TTS HTTP 契约和取消；运行 CLI、固件构建、浏览器检查并记录剩余硬件缺口。

数据继续使用 app_state 的 product:food-spirit-yard:v1 命名空间，图片位于私有媒体目录。旧库存接口和表保留。新 T5 产品不走旧拍照识别接口。

详细完成范围、测试与未完成项见 07-delivery-status.md。没有 git add/commit/push，没有刷写、采购、格式化或修改历史 migrations。

最终增量：工作任务处理网络/播报，主循环可取消，过时代次丢弃；启动撤销许可并清理孤立媒体；补文件丢失失败回归；旧备份显式排除小院产品记录。最终 111 项测试通过，typecheck/lint/build 通过；独立 Next 检查目录下重新实走浏览器主链，异常零，三种宽度无横向溢出。仍有纯软件未完成项，见 07，不能宣称全量 V1.1 完成。

## Wi-Fi 配置修复与 IMU 型号确认

新增 yard_console.c 并注册独立 UART 配置任务，恢复 wifi-connect/status/scan/reconnect/disconnect、core-config，以及 record/stop/screen。输入缓冲有上限，拒绝尾随 JSON，不回显密码/Token，解析后清理敏感缓冲；连接成功才持久化沿用现有网络服务。主机使用锁定 SDK cJSON 编译 tests/firmware/yard-console.c，通过配置解析、remember 默认/false、非法字段、尾随数据拒绝测试；T5 实际交叉构建通过。修复版 QIO 归档 food-spirit-yard-1.1.0-wifi，尚未刷写，实际 Wi-Fi 连接未验。

用户确认运动模块为 TDK InvenSense ICM-20602 六轴 IMU。现有仓库无此型号驱动或有效门事件接入；正在向用户确认实际连接状态与引脚，不能猜测 I2C/SPI 接线或已连通。

## IMU 最小实机诊断准备

用户提供接线参考截图，但没有实际 T5 针脚信息；用户要求先不拍照，直接测功能，并报告 IMU 红色 LED 已亮。不能将 LED 当通信成功。

实际对当前 UART1 执行 help 只读检查，无可用 IMU 产品诊断入口。SDK cli_i2c 是 BK 硬件控制器测试，当前 TKL 触摸采用软件 I2C，不直接重初始化硬件控制器碰运气。

新增 hs_imu_probe.c，在显示/触摸线程启动前，用当前 BSP 的 GPIO13/15 与 I2C0，读取地址 0x68、0x69 的 WHO_AM_I(0x75)，期望 ICM-20602 返回 0x12；只写寄存器选择字节，不改 IMU 配置，不初始化门事件。实际软件引脚只是受测候选，尚未证明与用户接线相符。该诊断与 Wi-Fi 修复一起交叉构建成功，镜像归档 food-spirit-yard-1.1.0-imu-probe。尚未刷写、没有芯片身份实测结果，正在请求本次刷写授权。随后需先核实身份，再验证运动采样与安装到冰箱门后的触发。

## 真机刷写与 IMU 检测结果

用户明确授权刷入并检测。原厂备份哈希核对通过，刷写前另外完整读取当前8MB Flash，SHA-256 bba624196561a1c4cf15632266e731d2efba1d13f6f27e1f970cc584c81b347c。首次921600速率擦除在0x00130000失败；没有将失败当成成功。随后改460800重试，完成镜像写入及逐字节回读，启动成功，未格式化SD。

实际启动日志：GPIO13/15、软件I2C0，0x68与0x69均 result=-1，WHO_AM_I=0x00，verified=0，found=0。这是当前候选接线上的通信失败，不是芯片损坏证明，尚未运动采样或门事件验收。新固件 UART0 wifi-status 已实测返回配置命令成功，connected=0、connecting=0、saved=0。当前无 config.local.json，尚需配置用户Wi-Fi再实连。

证据位于 data/hardware/builds/tuya-t5-ai/food-spirit-yard-1.1.0-imu-probe/，包括原始启动日志、刷前备份、回读与 flash-verification.json。

用户另授权新建 GPT-6.1 SOL 中文独立会话重构 Web 后台，不必兼容旧库存后台UI，但不清空数据。新会话 01a1ab0e-7f86-7b73-b701-a83f4526a92c；硬件主会话保留，明确禁止该会话改固件/串口/硬件脚本或占用当前调试服务端口。

用户补充实际IMU接线：SCL→P00、SDA→P01，与诊断使用的GPIO13/15不一致。原厂V1.02主板原理图明确TX1=P0、RX1=P1，S1复用表P00/P01对应LOG_UART；当前固件保留UART1日志且实测460800输出。因此不能直接把P00/P01改作IMU软件I2C而继续使用现有日志/USB串口连接。下一步优先断电后把IMU两根信号线移至已验证触摸总线GPIO13(SCL)/GPIO15(SDA)，保留原触摸连接；用户尚未确认完成改线，不记录为通信已通过。

## 引脚图复核与结论纠正

用户要求按原厂 pinout/t5-ai-board-v1.02.pdf 复核。已渲染并检查整页：P11连接器的P00明确标注 I2C1_SCL / UART1_TX / DEBUG_TX，P01明确标注 I2C1_SDA / UART1_RX / DEBUG_RX。因此用户SCL→P00、SDA→P01符合该图I2C1复用能力；之前将其笼统判为不适用并建议改接13/15不准确，不能由测错引脚的失败推断用户接线有错。

需解决实际占用：锁定SDK CONFIG_UART_PRINT_PORT=1，当前UART1调试已实测；原厂图S1 LOG_UART开启时将P00/P01连接到CH342F调试通道，P01还标注用户LED复用。保留用户接线的路线是隔离S1对应TX1/RX1日志连接、确认P01用户LED负载状态，并使固件停止或迁移UART1日志后，以独立I2C实例驱动P00/P01；触摸I2C0(GPIO13/15)保留。没有确认开关状态前不重配P00/P01，不要求用户盲动编号开关。现有诊断仅测13/15，不能作为P00/P01测试结果。

用户确认S1 TX1/RX1已OFF并重新上电。已构建独立I2C1(P00/P01)诊断，触摸I2C0不变，原厂日志尝试通过shell_set_uart_port迁移至UART0，随后重建115200配置RX。构建通过，归档food-spirit-yard-1.1.0-imu-p00。此版本未完成实机刷写：下载握手持续无响应，未生成刷前备份、未进入擦写，已停止握手并释放串口，等待用户核对TX0/RX0是否仍ON。UART0日志迁移、配置RX与IMU均未验证，不把待刷镜像记为真机成功。

用户确认S1 TX1/RX1 OFF、TX0/RX0 ON。P00/P01版本两次尝试均在手动RESET后完成握手但Flash读取失败：一次460800握手后等待门控、一次115200直接读取；均未擦除/写入，不能标为升级完成。停止同条件重试。请求用户断电、临时断开IMU两根信号线、恢复TX1/RX1 ON，以隔离变量并恢复此前成功的刷写连接。需要注意115200工具单页4096读取超时0.5s余量较小，不以低速失败断言接线问题。后续刷入应采用此前成功的460800并校验，再断电恢复TX1/RX1 OFF与IMU接线。

## 2026-11-06 面包板重接后真机检测

用户确认IMU仍接P00/P01、TX1/RX1 OFF，且今天用面包板重新接线。先执行 scripts/hardware/t5-probe.py，只读4KB与CRC成功：FlashID 0x1765c8，460800，4111字节协议响应完整，约89ms，总过程约0.5秒。不能仅由此前读取失败认定硬件接线有错。

随后完整读取当前8MB备份，写入P00/P01诊断4d356...并逐字节回读通过。但shell_set_uart_port(0)运行时日志迁移版没有UART0输出，用户反馈屏幕黑屏或未正常显示，未认定启动通过。已去除该日志迁移路径：关闭原厂UART1日志，产品hs_log直接tal_uart_write(UART0)，保留115200配置RX；重新实际交叉构建并刷写、逐字节回读通过。此次受影响Flash区域另行备份，完整8MB备份仍保留；未格式化SD。

最终证据目录：data/hardware/builds/tuya-t5-ai/food-spirit-yard-1.1.0-imu-p00-direct/。
真实输出：I2C1、SCL=P00/SDA=P01，地址0x68 result=0，WHO_AM_I=0x3f，预期0x12，verified=0；0x69 result=-1。UART0 wifi-status返回connected=0、connecting=0、saved=0，命令结果成功。新日志路径已工作，尚待用户确认屏幕。0x68收到应答不等于ICM-20602识别通过；需要检查CS/SA0和重复身份读取/总线时序，未做运动采样、角度标定、开门唤醒验收。已向用户询问面包板CS连接，未要求照片，未将0x3f伪装为通过。

用户确认IMU CS接3.3V。增加imu-probe串口命令，在主循环空闲时读取身份；启动/命令各对0x68/0x69及STOP/重复起始两种方式各测5次。实际构建、写入、回读通过，证据food-spirit-yard-1.1.0-imu-repeat。此次20个样本verified全0：0x68首样本0x00，其余多为0x1f；0x69多为0xff，均result=0。不能将底层返回成功视为真实设备身份通过，也不能由0x3f/0x1f判定芯片型号或损坏。SDK软件I2C的ACK/采样时序仍需排查，未写IMU工作寄存器。

用户新增摄像头已安装：当前固件配置CONFIG_ENABLE_EX_MODULE_CAMERA/ENABLE_CAMERA均未启用，hs_optional.c相机接口仍返回不支持，故目前未实际使用摄像头。锁定SDK含GC2145/OV2640等驱动，但原厂附件型号说明与实际模组必须对照；已询问用户型号/是否原厂，先核实驱动与ID，不将插上排线当作出图成功。

摄像头补充：用户确认另购，排线丝印 ST2606-LXSC 101-V2.0。对该完整丝印及组合关键词的公开检索未找到可靠的厂商规格或传感器对应资料；不能将排线编号当成GC2145/OV2640型号。现场锁定SDK仅发现GC2145、OV2640 DVP传感器驱动，原厂BSP默认注册GC2145；仍不足以确认用户模组兼容。已索取购买商品链接或商品标题中的芯片型号，用于核对传感器、接口引脚和供电；未盲目上电复位或套写寄存器表。

用户确认T5当前所装与旧ESP32-S31成功拍照的是同一只摄像头。结合本仓库camera-retest.md及camera-retest-20261019.json的实机SC101IOT PID=0xda4a记录，将SC101IOT作为当前移植目标；丝印ST2606-LXSC 101-V2.0本身仍不是独立型号证据。旧S31成功不代表当前T5控制通信或DVP收帧已通。

已读T5 lcd-display-sub-board.pdf和主板引脚资料：主板P10是18针DVP引出；子板归档包含LCD/触摸及18针DVP转接信号，不足以确认用户实际摄像头FPC插座与转接方式。已询问实际接入接口标号/转接板，确认电气映射前不盲写GC2145或SC101IOT初始化表，不改触摸总线。锁定TuyaOpen相机层未发现SC101IOT驱动，需从原厂Espressif传感器定义参考移植适配，保留版权和许可，不能直接编译ESP V4L2/BSP到T5。

## T5相机控制通信初测

用户说明同一SC101IOT摄像头通过排线插在屏幕转接板某排线座；实际转接板型号与该座的引脚映射仍未知。新增hs_camera_probe.c，依据Espressif公开sc101iot.h/reg定义，7bit地址0x68，页选择0xf0写0x31，读取0xf7/0xf8拼PID0xda4a；没有复制初始化表或业务代码。启动时在显示触摸线程之前使用BSP候选I2C0(GPIO13/15)检测三次，不触发拍照、不供MCLK、不操作复位或电源脚。公开依据：https://github.com/espressif/esp-video-components/tree/master/esp_cam_sensor/sensors/sc101iot 。

实际交叉构建、备份、刷写、逐字节回读通过，证据food-spirit-yard-1.1.0-camera-probe。相机三次result=-1、pid=0x0000、verified=0；结论仅为当前被动控制通信未读通，不排除缺时钟/复位/实际映射差异，不能宣称相机损坏或不兼容。未采集画面、未进入旧图片识别入库路径。同期IMU0x68多数WHO_AM_I=0x3f，0x69无应答，matches=0/20，仍未识别通过。后续先确认实际屏幕转接板/相机排线插座映射，再增加相机时钟/复位及DVP适配，避免盲切GPIO51影响LCD。

## IMU优先：独立开漏慢速路径实测

用户要求先不处理相机，集中解决IMU。已停止启动相机诊断（仅保留源码，不再调用）。核对锁定SDK软件I2C：数据读SCL拉高后立即采样，ACK轮询发生在SCL拉高前；这是待比较的时序差异，不足以直接断言根因。新增板级独立慢速开漏实现，不改SDK：释放引脚为上拉输入、拉低才输出，50us稳定等待、SCL拉伸超时2ms、SCL高电平采样ACK与数据；检测空闲电平异常就拒绝继续。只写WHO_AM_I寄存器指针，不改IMU模式或强行忽略身份。

新增主机回归tests/imu-probe.test.ts及C/GPIO测试替身：检查不主动驱动高电平、0x12位序、NACK拒绝、GPIO错误传播；实际CLI通过。T5交叉构建、刷写、逐字节回读通过；原厂与当前区域备份保留，未格式化SD。证据food-spirit-yard-1.1.0-imu-opendrain。

实际启动和UART0 imu-probe两轮共10次：idle_scl=1、idle_sda=1、io_ok=1；0x68 transfer_ok=1且WHO_AM_I稳定0x2e；0x69 transfer_ok=0。matches=0，尚未验证ICM-20602身份，未启用运动采样/门事件。结果比SDK路径0x1f/0x3f稳定，但不能把0x2e改成白名单或据此判断模块损坏。TDK手册DS-000176明确0x75只读WHO_AM_I默认0x12。已请求用户抄芯片本体丝印（非PCB型号），无需照片或改线，以确认器件/模块与寄存器协议。

用户补充芯片本体丝印 I62 H77E 4CH。TDK DS-000176第13节明确ICM-20602标记I62，其余为追溯码；保留型号线索，不据此断言身份读取已正确。

新增imu-reset命令：先读WHO/PWR/CONFIG，成功后按PWR_MGMT_1 DEVICE_RESET复位，200ms后复读。实际构建/刷写/回读通过，证据food-spirit-yard-1.1.0-imu-reset。复位前后PWR均0x41、CONFIG均0x80（符合手册默认），WHO保持0x2e；仍未通过身份验收，不做0x2e白名单。

为进一步区分“只有控制通信”与“运动传感器实际工作”，增加手动imu-raw诊断：仅当PWR=0x41、CONFIG=0x80且通信成立时临时PWR写0x01唤醒，限时读取14个原始数据寄存器，日志显式identity_verified=0，结束尝试恢复原PWR；不发门事件、不当作正式兼容。实际构建/刷写/回读已通过，证据food-spirit-yard-1.1.0-imu-raw。已请求用户准备静止/缓慢转动动作，尚未采集动作对照，不将未来结果写成已完成。

## 已确认物理连接缺口：模块排针未焊接

原始运动诊断：首轮仅1组有效，第二组传输失败；该组加速度(-248,16312,-1080)幅值接近1g，不能据一组判运动通过。结束时PWR恢复传输失败，后续imu-reset确认PWR由0x01恢复为0x41。静止采集曾收到11组有效数据，但因最初采集窗口30秒未覆盖明确结束，完整性未通过；持续串口重新采集静止测试再次出现首组传输失败、PWR恢复未确认。因此不能把失败只归因于用户转动。

用户明确确认：IMU排针没有焊接，仅直接插入接触。这是已确认的电气连接可靠性缺口，足以要求停止带电运动和继续刷写；不能保证焊接后所有故障必然消失，但应先焊牢/建立可靠连接再判断芯片或软件。未将0x2e接受为正式ID，未启用门事件。已通知用户先断电，修复模块排针；串口在诊断后关闭，完整固件与日志保留。后续顺序：确认焊接与短路检查→保持P00/P01、TX1/RX1 OFF→imu-probe应稳定0x12→静止/移动原始数据→去抖/门事件标定。无需继续索取芯片型号或盲换GPIO。

## 焊接等待期间：准备无传感器诊断的联网构建

转向Wi-Fi/按键语音联调前，已请求用户先断电并将未焊IMU及所有跳线完整拆离，包括VCC/GND/CS/SA0/FSY/INT/SCL/SDA；不能只拔信号线。确认前本轮只操作电脑端，未打开串口、探测设备或烧录。

新增yard_mode.h，正常构建默认HS_YARD_SENSOR_DIAGNOSTICS=0；CMake只有HOMESTASH_T5_SENSOR_DIAGNOSTICS=1时才纳入IMU/相机探测源码。关闭时启动跳过探测，应用不调用40/42/43动作，串口明确拒绝imu-*/camera-*命令，能力标记未改为可用。Wifi/Core配置主机C回归新增诊断拒绝断言并通过；实际T5交叉构建通过，arm-none-eabi-nm核对libtuyaapp.a没有hs_t5_imu/camera探测符号。镜像和SHA归档food-spirit-yard-1.1.0-wifi-only，尚未刷写。等待模块完整隔离确认后，核对串口再进行联网测试；Wi-Fi凭据留在本机私有配置或本地输入，不进入聊天日志。

用户明确确认IMU已连同所有线完整拆离。已执行wifi-only镜像备份/刷写/逐字节回读通过，原厂/当前完整备份保留，未格式化SD。该镜像不包含IMU/相机诊断符号；并非用故障IMU固件继续联网。

新增scripts/hardware/configure-t5-wifi.py，支持本机终端隐藏密码或macOS隐藏输入框；保存前核对git忽略路径、校验Wi-Fi长度，原子写config.local.json且权限0600，拒绝把密码放命令行/聊天。用户已通过本机输入框填写，工具仅输出保存成功，未打印凭据。尚未向设备发送网络配置。

wifi-only启动后UART0日志为空，115200的wifi-status无响应；镜像回读正确不能视为设备启动/联网成功。已请求用户短按RESET并说明屏幕是否显示小院，待确认。55秒UART0启动采集未收到数据；不能据此假定用户已按RESET。下一步先确认实际重启/屏幕并增加必要启动分段诊断，再发送Wi-Fi配置，不以未联网当成密码问题。此段未改动新会话负责的Web/Core业务。

## Wi-Fi与中文显示真机通过（2026-11-06）

用户短按RESET后屏幕亮起，反馈“小院”等出现错字/方框。复测UART0配置命令恢复响应。仅通过本地读取私有JSON发送wifi-connect，未打印网络名/密码；实机从connecting=1变为connected=1、saved=1，后续多次状态保持连接，证明连接和保存成功。

中文字库hs_font.c仍是旧生成物，早于本轮文案。重新运行scripts/hardware/font.mjs，CLI验证萌小冰/食灵小院及导航、当前正文所需Unicode字形无缺失。联网模式交叉构建、备份、刷写、逐字节回读通过；未格式化SD。用户明确反馈“中文已正常”，不将字形覆盖检查替代真机观察。

最新镜像归档food-spirit-yard-1.1.0-wifi-font，QIO SHA-256 ada8352fedad669016d82bc9dc509e99afefb4722749e6a38c9e7587b423d521。固件升级重启后，不重发Wi-Fi凭据，实机connected=1，验证保存与自动重连。主动wifi-disconnect后connected=0；wifi-reconnect使用板上保存配置，15秒后connected=1。此时saved=0表示本次重连未再次写入凭据，不是已保存配置丢失。imu-probe返回尚未支持，确认正常联网镜像拒绝传感器诊断；IMU仍完全拆离。验收JSON在镜像归档wifi-acceptance.json；脱敏状态日志在/tmp/homestash-v11-audit/wifi-connect-result.log与wifi-reconnect-result.log。Core设备鉴权/心跳、按键语音与真实ASR/TTS仍未验收，不能用Wi-Fi连接成功代替业务联通。
