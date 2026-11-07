# T5 SC101IOT 相机接通记录

日期：2026-11-06。目标为 11 月 7 日演示；本文不构成真实出图验收。

## 最新事实与旧记录修正

用户已确认：相机是旧 ESP32-S31 曾成功使用的同一只 SC101IOT，PID 0xda4a，排线标记 ST2606-LXSC 101-V2.0。目前经屏幕转接板排线座连接，不能再沿用 00—07 的“无模组”描述，也不能改称 GC2145。排线标记不能证明连接器方向、每针网络或电压兼容。

已读 00—09 需求/记录与当前相关 diff。保留所有原有改动，本次只新增独立身份适配、主机测试及本文。未改 hs_display.c、yard_app.c、CMake、旧相机接口、数据库或配置。没有占用串口、SDK 构建、刷写、接线、带电测量或拍照。IMU 已连所有线拆离，不安排带电探测。

## 源码证据

锁定 SDK：`/tmp/homestash-tuyaopen-v1.5.0`，实物 T5AI Board V1.02。

- `boards/T5AI/TUYA_T5AI_BOARD/tuya_t5ai_ex_module.c` 注册 GC2145，不是 SC101IOT。
- 同目录 `tuya_t5ai_ex_module.h` 的 GPIO13/15、复位 GPIO51 只是该 BSP 候选定义，不是当前转接座实测映射。GPIO13/15 还涉及触摸，共用时须串行化；禁止照搬 GPIO51 复位操作，避免影响 LCD。
- `src/peripherals/camera/tdd_camera/include/tdd_camera_dvp.h` 提供传感器 rst/init/set_ppi 和 clk/fmt 配置扩展点；未发现现成 SC101IOT 驱动。
- `tdd_camera_dvp.c` 有 YUV422/JPEG 输出配置，但不能由此推断 SC101IOT 与 T5 编码链已经适配。
- 当前 `hs_optional.c` 的 `hs_camera_*` 仍返回不支持。原接口与旧库存队列不作为小院相机接入目标。

协议依据：[Espressif SC101IOT 驱动](https://github.com/espressif/esp-video-components/tree/master/esp_cam_sensor/sensors/sc101iot)。其身份协议为 7 位地址 0x68，0xf0 选页 0x31，读 0xf7/0xf8；参考模式使用 20 MHz 输入时钟、DVP 8 位 YUV422。此处是参考驱动模式，不证明当前模组供电或排线兼容。应冻结具体上游提交再移植初始化表，遵守 Apache-2.0 许可并保留声明；本次没有复制寄存器初始化表。

## 独立适配与验证

新增：

- `firmware/boards/tuya-t5-ai/include/hs_sc101iot.h`
- `firmware/boards/tuya-t5-ai/src/hs_sc101iot.c`
- `tests/firmware/sc101iot.c`

适配仅提供可注入 SCCB 读写的身份检查；电气映射、供电、时钟、复位四项未确认时零访问，逐步检查通信错误，读到其他 PID 明确拒绝。调用者必须独占总线。没有默认 GPIO、初始化表、输出时钟、视频启动或 capability 变更。尚未纳入 CMake，避免与主会话当前镜像构建冲突。后续板级接入必须提供真实读写回调，四项标志须来自实际验证，不得为通过检查直接置真。

CLI 已执行并通过：

```sh
cc -std=c11 -Wall -Wextra -Werror tests/firmware/sc101iot.c firmware/boards/tuya-t5-ai/src/hs_sc101iot.c -o /tmp/homestash-sc101iot-test
/tmp/homestash-sc101iot-test
```

覆盖未确认条件零访问、正确身份、错误身份、选页与两次读取失败的短路，以及无效参数。输出为“SC101IOT 主机协议测试通过；未访问硬件。”这只是协议替身回归，不是 T5 交叉编译或硬件读 ID 成功。

## 电气映射解除条件

归档资料位于 `docs/hardware/tuya-t5-ai/reference/schematics/` 的主板 V1.02 与 LCD 子板原理图；目前仍不能从归档名称确认用户手中转接板及所插排线座就是对应版本。

| 项目 | 当前结论 | 下一步证据 |
|---|---|---|
| 转接板型号、座编号、1 脚及触点方向 | 未核实 | 断电核对实物丝印、连接器和对应图纸 |
| 每针供电/GND、模组各路额定电压 | 未核实 | 模组定义与转接网络逐针对应；禁止按 FPC 外观推定 |
| SCCB SCL/SDA、电平与上拉 | 仅有 BSP 候选 13/15 | 断电连通性与电平规格核实，再协调上电验证 |
| MCLK 与复位/PWDN | 未核实 | 明确网络、极性、时序；确认与 LCD 无冲突 |
| D0—D7、PCLK、VSYNC、HREF | 未核实 | 逐针映射到 T5 DVP，验证采样边沿、同步极性 |
| YUV 顺序、JPEG 编码、缓冲生命周期 | 未接通 | 先单帧 YUV，再验证编码、内存与屏幕并发 |

此前无 MCLK/复位的通信初测未读到 ID，只能说明该测试条件下通信未通，不能判模组损坏。禁止盲扫/盲写 GC2145 表或改 GPIO51。需要真机时先协调主会话释放串口和构建资源；当前不执行。

## 小院照片接入边界与顺序

现有 `/api/yard/photo/preview` 的 schema 强制 `simulated: true`，仅支持模拟联调；`/device/v1/yard/settings` 不是照片上传接口。当前无真实设备 JPEG 上传/回执，不能复用旧 `/device/v1/images/:id` 或删除 simulated 约束冒充完成。

建议在传感器身份与单帧通过后，新增有设备鉴权的小院拍摄命令及上传接口，复用小院暂存/保存服务逻辑而非复制另一份存储。许可绑定会话、设备、采集 ID 与短期令牌，倒数取消/到期后禁采集和拒收；采集令牌一次使用，网络重试只复用同一请求，不能重拍。重拍重新取得当次许可；放弃删除暂存；确认保存才生成正式回忆与成功反馈。上传后再次检查许可，防止上传期间取消导致迟到照片进入预览。设备重启不恢复未消费许可。

验收顺序：电气核实 → 协调只读身份检查 → 移植 SC101IOT 专属格式/初始化 → 单帧 YUV → 真实 JPEG 解码核查 → 小院独立鉴权上传 → 预览/重拍/放弃/保存 → 断网重试及取消竞态 → 屏幕/音频同时运行 → 实际机位与两人入镜。原图留在私有忽略目录，测试产物用独立临时目录，不提交照片、凭据或用户数据。

## 当前交付等级

源码：身份控制适配已新增。协议：主机替身测试通过。模拟：现有 Web 路径明确标记模拟，本次未重新验收。T5 构建/刷写：本次未执行。真实 PID：本次未读取。真实画面/JPEG/回忆端到端：未完成。外部阻断：转接板与模组电气定义仍未核实；工程缺口：SC101IOT DVP 驱动、编码与独立设备照片协议尚待实施。两类缺口不能相互代替或隐藏。

## 2026-11-06 追加：对照两端原理图发现供电差异

用户再次确认是 ESP32-S31-Korvo-1 套装原配相机，直接插到 T5 屏幕转接板，插接方向未确认。已读取本仓库旧板 camera.md、validation/camera-retest.md 与 BSP camera.h，确认原板真实 SC101IOT 640×480 JPEG 成功记录。不能再要求用户解释硬件术语；下面的图纸和软件核查由工程侧完成。

本次用 macOS PDFKit 提取并实际渲染检查图纸，临时文本和图片均在 `/tmp/hs-*`。对照来源：

- 本地 `docs/hardware/tuya-t5-ai/reference/schematics/lcd-display-sub-board.pdf` 第 2 页 CN2。
- [Espressif 官方 Korvo V1.1 原理图](https://dl.espressif.com/schematics/esp32-s31-korvo-1-schematics.pdf)第 3 页 J4；下载仅存 `/tmp/hs-korvo-schematic.pdf`。该在线图纸标题日期为 2026-10-28，仍需结合实物修订确认，不能自动视为用户旧板具体批次定义。

| 针号 | Korvo J4 | T5 LCD 子板 CN2 | 判断 |
|---|---|---|---|
| 1 | GM_FK | 可选电阻到 GND，标 NC | 用途不同，不盲接 |
| 2 | AGND | GND | 地 |
| 3、5 | SDA、SCL | C_SDA、C_SCL | 逻辑功能一致；T5 子板有电平转换 |
| 4 | AVDD 2.8V | AVCC 2.8V | 图纸标称一致 |
| 6 | RESET，低复位 | C_RST，2.8V 上拉及电容 | T5 图纸没有直接画到 G1_DVP_RST；不能当作 GPIO51 直接复位 |
| 7、8、9 | VSYNC、PWDN、HREF | VSYNC、PWDM、HSYNC | 须核对同一信号及默认电平 |
| **10** | **DVDD 1.5V** | **VCC 1.8V** | **明确图纸供电差异，未核实模组允许范围前不继续上电试错** |
| 11 | DOVDD 2.8V | VCC 2.8V | 图纸标称一致 |
| 12、14、16、18 | Y9、Y8、Y7、Y6 | D7、D6、D5、D4 | 8 位数据高四位对应 |
| 13、17 | XCLK、PCLK | MCLK、PCLK | 时钟信号功能对应，尚无实际波形 |
| 15 | DGND | GND | 地 |
| 19、20、21、22 | Y2、Y5、Y3、Y4 | D0、D3、D1、D2 | 8 位数据低四位对应 |
| 23、24 | LED+ 3.3V、IR_CUT | 可选电阻到 GND，标 NC | 不能由排线外观推定无影响 |

额外发现：T5 子板图中 G1_DVP_RST 接两路稳压器 CE，控制相机电源；C_RST 是独立上拉/电容网络。此前通称“复位 GPIO51”的 BSP 配置不能直接解释为传感器复位脚。必须沿实物网络核实，禁止为了读 ID 随意翻转该 GPIO。

结论边界：已找到具体供电不一致证据，因此当前不能承诺“只写驱动即可直插跑通”；尚不能仅凭图纸断言已损坏，亦不能证明该相机绝对不能用于 T5。可能需要适配供电的转接方案，或实物证据证明当前模组/子板定义不同。简单翻面不会把 1.8V 改成 1.5V，还会改变供电脚对应，禁止试插两面。

下一步最小外部信息：断电后的 T5 转接板全貌及相机排线插座近照，能看清丝印、锁扣、排线金属触点朝向。用户无需测针脚或理解术语；工程侧依据照片定位准确版本和方向。若实物确为上述 CN2，继续查模组额定范围并设计 1.5V 供电适配，在电气条件确认前不启动时钟/相机探测。主会话仍持有串口/构建/刷写资源，本次没有操作。

## 2026-11-06 追加：切换 USB 摄像头 SX-C007L-V1.1

用户说明已改用 USB 摄像头，背部丝印 SX-C007L-V1.1，已插上。后续优先调查 USB/UVC，不继续把 SC101IOT DVP 供电问题作为 USB 路线阻断。当前尚待确认插在 T5 USB-A、电脑还是经转接线接 USB-C，不能仅凭“已插上”宣称 T5 已枚举。

已查官方 [T5AI-Board 概览](https://tuyaopen.ai/docs/hardware/tuya-t5/t5-ai-board/overview-t5-ai-board)：板上有 USB Host。厂商公开的是 [SX-C007L-V3.0](https://www.aneak.com/goods/sx-c007l-v3-0.html)，列出 USB UVC、MJPG/YUY2；用户实物是 V1.1，不能继承 V3.0 的分辨率、帧率、电流或 VID/PID，必须以枚举结果为准。

锁定平台源码 `/tmp/homestash-tuyaopen-t5ai`（SDK platform/T5AI 的真实指向）已核实：

- `t5_os/build/bk7258/tuya_app/bk7258_ap/config/sdkconfig.h` 启用 CONFIG_USB_HOST、CONFIG_USBH_UVC、CONFIG_USB_CAMERA；这是当前构建目录配置证据，不是设备当前运行镜像或相机识别成功证据。
- `tuyaos/tuyaos_adapter/src/driver/tkl_video_in.c` 的 UVC 分支使用 port=1、IMAGE_MJPEG；只支持 10/15/25/30 fps 的配置值。tkl_vi_init 随后调用 lcd_jdec_pipeline_open，直接调用可能影响现有 LVGL 显示，不能原样套用到小院。
- `tkl_video_enc.c` 的 tkl_venc_init 实际建立 IMAGE_H264 取帧任务，tkl_venc_get_frame 返回不支持；不是现成 JPEG 单帧接口。
- `t5_os/ap/include/driver/uvc_camera.h` 有 bk_uvc_power_on、bk_uvc_get_enum_info、bk_uvc_init/set_start/set_stop/deinit。可先调查枚举与模式，再启流。
- `t5_os/ap/components/multimedia/include/media_app.h` 有 IMAGE_MJPEG 取帧回调注册接口，但实现被 CONFIG_WIFI_TRANSFER 包围；未启用时可能返回成功却没有回调，接入须检查实际宏和返回行为，不能只看函数存在。

下一步：确认物理 USB Host 接口 → 与主会话协调串口/构建窗口 → 先枚举 VID/PID、UVC 格式/分辨率/帧率，不拍摄 → 按实际支持的 MJPEG 模式做一次明确许可的单帧测试 → 独立小院上传/预览/保存。USB 不需要 SC101IOT 的 SCCB/寄存器移植；仍需设备相机适配、超时取消、帧复制/归还和独立上传。

本次截至记录时没有串口、构建、刷写或采集；没有照片文件，没有改变 cameraReady，也没有把旧 images 接口接入小院。

### USB 接口已确认与独立枚举诊断

用户已确认摄像头插在 T5 板上的长方形 USB-A 主机口。无需再询问插接位置。

资源检查发现 UART0 正被另一 Python 进程占用，进程命令为临时目录下 flash-audio-stream.py，故没有打开串口、终止进程或启动 SDK 构建/刷写。已向用户请求协调资源或授权通知主会话，等待明确回复。

新增 `firmware/boards/tuya-t5-ai/src/hs_uvc_probe.c`：通过 bk_uvc_power_on(IMAGE_MJPEG,4000) 枚举、查询端口1的 VID/PID/MJPEG 模式，最后关闭供电生命周期。没有调用视频 init/start、LCD 解码或旧库存图片接口，没有启动时自动调用；须独占 USB 时显式运行。尚未加入 CMake/串口命令，等待主会话资源释放后接入并交叉验证。

测试替身位于 `tests/firmware/uvc-mocks` 和 `tests/firmware/uvc-probe.c`，CLI：

```sh
cc -std=c11 -Wall -Wextra -Werror -Itests/firmware/uvc-mocks tests/firmware/uvc-probe.c firmware/boards/tuya-t5-ai/src/hs_uvc_probe.c -o /tmp/homestash-uvc-probe-test
/tmp/homestash-uvc-probe-test
```

退出码0，覆盖正常枚举、上电失败、描述符缺失、关闭失败、模式数组缺失，均检查清理执行。测试 VID=1234/PID=5678、640×480 是明确的测试替身，绝非用户摄像头检测结果。SDK 模式字段 fps 的单位尚待沿描述符代码核实，诊断只报告模式尺寸与间隔数量，不误报实际帧率。

当前 USB 真机枚举仍未执行，没有真实 JPEG；串口资源协调完成后才进入实测。

### USB 真机枚举通过（2026-11-06）

主会话收到用户授权协调后表示准备交出资源；本会话确认串口与刷写/构建进程均空闲后接手。新增独立 HOMESTASH_T5_UVC_DIAGNOSTICS=1 构建开关与串口 uvc-probe，不触及 hs_display.c/yard_app.c，不启用 DVP/IMU 诊断。锁定 SDK 交叉构建成功，刷前受影响区域备份、镜像写入及逐字节回读均通过；未格式化 SD。

实际 UART0 返回 VID=0c45、PID=6367，MJPEG 五个模式：1280×720、800×600、640×480、352×288、320×240，每模式6个帧间隔项。命令结果成功。这里是真机枚举，不是替身数据；没有 init/start 视频流，没有照片。CLI 主机协议回归、默认串口配置回归与 git diff --check 通过。

镜像及私有原始日志保存在忽略目录 `data/hardware/builds/tuya-t5-ai/food-spirit-yard-1.1.0-uvc-enum/`；结构化去敏证据为 uvc-enumeration.json。QIO SHA256：`5ffb0afd28675d0a434e0919b2722b8229340dfdc4e01cc20fcfd53593be3a65`。

项目要求当次明确许可，因此已向用户请求一次单帧测试拍摄许可，未收到前不采集。仍未完成：真实 JPEG、独立设备上传、预览/重拍/放弃/保存。SDK 枚举成功不能替代这些验收。

### 单帧测试第一轮：未取得照片；用户扩大本机调试授权

用户先明确同意一次测试拍摄。新增独立 hs_uvc_shot.c（仅 UVC 诊断构建包含），串口 uvc-shot：屏幕提示和3秒等待，尝试打开640×480 MJPEG，复制第一张完整 JPEG，关闭并通过私有诊断串口传回主机；等待期间串口非空白输入可取消。同次启动只执行一次，不接库存、模型或家庭回忆；不是正式产品预览/保存流程。

首次交叉构建、刷前备份、刷写及逐字节回读通过，归档 food-spirit-yard-1.1.0-uvc-shot。实际命令返回 code=-1，无照片 BEGIN/END，未得到真实 JPEG，不算出图成功。原始日志保留在忽略目录，不将替身测试的 JPEG 当实拍。新增 tests/firmware/uvc-shot.c 的主机替身验证单帧复制、尾填充处理、关闭和重复许可拒绝通过。

已增加 open/register/unregister/closed 阶段日志及接收/无效帧计数，交叉构建通过。若回调注销失败，保留其可能仍访问的缓冲，避免释放后继续访问。当前开始刷入阶段诊断版 food-spirit-yard-1.1.0-uvc-stage，尚待实测。

用户随后明确回复：“同意 随便拍 不用再问”。此授权适用于后续本机相机调试与复测，不再逐张询问；不扩大为上传模型、库存写入、自动正式回忆或产品常驻拍摄。正式产品每次许可/预览/重拍/放弃/保存要求仍需独立接通和验收。

### 单帧第二轮与直接帧队列适配

阶段诊断版实际返回 open=0/handle=1、register=0、unregister=0，但 seen=0/invalid=0/bytes=0，最终 code=-2（等待超时）。这证明相机打开成功、通用回调没有接收到帧；尚不能仅凭此确定 USB 硬件或传感器故障。

已将取帧从 media_app_register_read_frame_callback 改为按端口1/UVC/IMAGE_MJPEG 查询准确帧队列，以 MODULE_CAPTURE 注册、限时读取、复制并归还帧，最后注销和关闭。避免通用传输任务的默认主流选择及条件编译行为影响判断；原因仍须直接取帧实测确认，不能预先声称修复成功。替身回归与交叉构建通过，food-spirit-yard-1.1.0-uvc-direct 已备份/刷写/逐字节回读通过，正等待实际照片结果。没有更改锁定 SDK 源码。

### SDK 帧间隔单位核查

直接帧队列版实测：open=0、stream found=1、register=0、unregister=0，但 seen=0，仍未取得照片。这排除了单纯“通用回调未注册”即可解决的假设。

进一步核实锁定平台源码：CherryUSB/class/video/usbh_video.c 将 dwFrameInterval 原始值写入 frame[].fps；bk_usbh_hub_multiple_classes_api.c 将该数组指针作为 all_frame.mjpeg_frame；bk_uvc.c 配置时直接把数组值当 fps；最终同一 USB API 通过 10000000/config->fps 生成帧间隔，单位发生二次反转。已在独占板级诊断内对选中640×480模式的枚举缓存作单位规范：大于1000的100ns间隔转换为四舍五入的每秒帧数，摄像头配置使用15fps而非 DVP FPS15 位标记。只改运行时枚举缓存，不修改锁定SDK源码；关闭供电后缓存生命周期结束。主机替身覆盖333333→30、666666→15、1000000→10，交叉构建通过，正在刷写 food-spirit-yard-1.1.0-uvc-fps。该缺陷是否为本次无帧的直接原因，仍待真机照片验证。

### 最终真机 JPEG 验证通过（2026-11-06）

帧间隔规范版首次真实收到一帧35,642字节，证明单位修正恢复了采集；但诊断照片串口传输被后台心跳日志逐字节交错，主机长度校验拒绝损坏文件，没有将其交付为成功照片。随后在现有 hs_runtime.c 的 UART0 hs_log 写入增加独立互斥，确保每行日志和换行完整写出；不改 UART1 禁日志设置。照片起始元数据新增 CRC32，主机提取器严格校验长度、CRC32、JPEG边界，拒绝未结束或多张混合日志。

最终运行镜像：food-spirit-yard-1.1.0-uvc-uart，刷前备份/刷写/逐字节回读通过。实际相机打开成功、准确帧队列存在、注册成功，收到1帧，注销返回0，关闭阶段返回0。真实 JPEG 为640×480、33,095字节、CRC32=2b120240，主机 CRC32 一致；SHA256=`bc80bb371eda6ebf59bdfb298559aa9c57a51a8f0176a313e6c6585c245a68c0`。macOS sips 读取尺寸并完整解码输出 PNG 成功。未把照片提交 Git、发送模型、写库存或保存为家庭回忆。

QIO SHA256=`452fe1609d898da643c77a3037e02860f3e3b09a34e0d92788cdfec29f39d50e`。结构化证据在忽略目录 camera-validation.json，照片仅在本机 `/tmp/homestash-uvc-shot/t5-usb-verified.jpg`，目录权限700、文件600。原始诊断日志含图像数据，保持私有，不复制到文档或聊天。

新增可复用 CLI：`scripts/hardware/extract-t5-camera.py 输入日志 输出JPEG`，输出文件不覆盖已有文件，权限600。主机测试覆盖正常提取、内容损坏、长度错误、缺少结束、重复照片拒绝；单帧C测试覆盖帧间隔规范、复制、尾填充处理、帧归还、关闭、重复许可拒绝，均通过。最终交叉构建及 git diff --check 通过。

当前准确结论：USB枚举、真实单帧JPEG、完整本机传输与解码已经通过。尚未完成正式小院设备照片上传协议、产品倒数取消联动、预览/重拍/放弃/保存与回忆持久化端到端；本次诊断不能替代这些产品验收。默认构建不开启 UVC 诊断，当前真机专用诊断镜像仍有 uvc-probe/uvc-shot 命令，已拍摄后同启动内拒绝再次拍摄；不会自动采集。未修改 hs_display.c/yard_app.c 或历史 migrations。
