# SmartBadge 固件复用审计

审计日期：2026-10-17。只读来源：`/Users/peter/code/congcongai/fde-moregy/SmartBadge`。审计基于当前工作区源码，包含用户未提交改动；本次没有修改、编译或烧录 SmartBadge，没有复制凭据。历史真板结果来自该项目验收文档，本次不声称重新实测。

## 来源与开发环境

主要阅读范围：`firmware/esp32-s31-korvo/main/` 的 main、wifi_profiles、wav、recordings、audio_gain、audio_volume、status_ui 及头文件/CMake/Kconfig；vendor BSP 的实现、ADC 校准和全部公开头文件；sdkconfig/defaults、分区与 dependencies.lock；hardware 构建脚本；development-board-firmware-guide、firmware-playback-and-debugging、firmware-flashing-and-recovery 文档。生成字体为 LVGL 字形数据，不属于业务或驱动实现。

- ESP-IDF：锁文件 6.2.0；构建脚本锁定提交 `ab95e70748f2eddac6f87217b0cf62533684a6ba`，是 6.2 开发基线，不能称为稳定正式版。本地 SDK `/Users/peter/esp/esp-idf-smartbadge`，Python 3.12 环境。主 manifest 要求 >=6.1.0。
- BSP：`vendor/espressif/esp32-s31-korvo/components/esp32_s31_korvo`，来源提交 `6f4b0f6ef304d76246325e9a9f94c1ddad8ed39c`，保留 Apache-2.0 头和来源清单。升级前核验 vendor hash。
- 实际锁定组件：esp_codec_dev 1.6.2、button 4.2.1、cJSON 1.7.19~2、esp_video 2.4.1、esp_cam_sensor 2.4.0、esp_sccb_intf 0.0.9、esp_lvgl_adapter 0.7.3、LVGL 9.6.0~1、GT1151 1.1.1、led_strip 3.1.0~1。未使用 ESP-ADF 应用流水线。
- CMake 3.16，ESP-IDF project.cmake、MINIMAL_BUILD，EXTRA_COMPONENT_DIRS 指向 vendor；main 注册 C 源文件和依赖。构建入口 `scripts/hardware/build-firmware.sh` 校验 SDK/vendor、配置后调用 `idf.py build`。
- target esp32s31；16MB Flash、DIO、80MHz、no-stub；主任务栈 16384；PSRAM Octal 250MHz、启动初始化/测试、malloc 集成，内部保留 32768 字节。
- 分区：NVS 0x9000/0x6000、PHY 0xf000/0x1000、factory 0x10000/4MB。bootloader 0x2000、分区表 0x8000。没有 OTA 双槽。

## Board 与真实 GPIO 来源

以下全部来自 vendor `include/bsp/esp32_s31_korvo.h` 与 `esp32_s31_korvo.c`，未根据网络猜测。

| 能力 | 源码配置 |
| --- | --- |
| I2C0 | SDA 0、SCL 1；Codec、Touch、Camera SCCB 共享，内部上拉 |
| I2S0 | MCLK 2、BCLK 3、LRCLK 4、DOUT 5、DIN 6、PA 7；Philips standard stereo，非 TDM |
| LCD RGB 数据 | D0..15 = 8,9,10,11,12,13,14,15,16,17,18,19,33,34,35,36 |
| LCD 同步 | PCLK 40、DE 43、HSYNC 44、VSYNC 45；800×480，26MHz，RGB565 |
| LCD 预留控制 | CS 38、MOSI 60、SCK 61；实际 RGB 驱动未使用这些 SPI 控制线；背光/使能 NC |
| Camera DVP | D0..7 = 46..53、PCLK 54、XCLK 55、VSYNC 56、HSYNC 57；reset/pwdn NC，GM_FK 38 定义但未驱动 |
| SDMMC | D0..3 = 20..23、CLK 24、CMD 25、控制 39 低有效；4bit FAT |
| 按键/LED | ADC GPIO42，中心电压 380/820/1340/1870mV 对应 VOL+/VOL-/MODE/SET；S31 软件 ADC 校准；WS2812 GPIO37 |
| UART/USB | sdkconfig UART0 115200 默认控制台，USB Serial/JTAG 辅助控制台；应用没有自定义 UART pin、USB 音频/存储协议；不猜引脚 |

app_main 初始化 NVS、LCD/Touch、SD、Wi-Fi、mic/speaker、按键与 LED。LCD 失败仍继续录音；SD 挂载失败会退出。未实现独立统一 board lifecycle，Phase 1 应用初始化需抽离。

## Audio

BSP 使用 esp_codec_dev 的 ES8389，I2C 默认地址，master_mode=false、use_mclk=false、digital_mic=false；ADC 与 DAC 分别创建 handle，共享 I2S 数据接口。BSP 默认 48k stereo，但 main 显式打开 16kHz/16bit/2ch。不能把默认值当作实际录音格式。

录音每次读取 stereo[1024]（2048字节），两个声道平均为 mono[512]（1024字节）；analog/digital gain、削顶/峰值检测已实现。单声道 PCM WAV 32000 字节/秒，上限 600 秒，无 Opus/AAC。WAV 文件头由 wav.c 写入，recordings.c 严格校验格式和真实长度。

录音以 .wav.part 写 SD，定期 fflush/fsync，结束补头 rename；启动恢复中断文件；元数据 .tmp/.bak 保存。网络同步 2048 字节分块，SHA256/MD5 校验、临时 COS HTTPS PUT、后端回执与重试。此处和工牌 API 强耦合，不能整体移植。

本地 speaker 回放：打开单声道 WAV、复制为 stereo 输出；暂停/继续/停止，11 档音量与独立 NVS，静音调用 codec mute；录音和回放互斥，回放后重新打开 mic。TTS 下载及播放未实现；可复用 PCM 播放通路，但需要格式归一化和下载缓存。

录音/上传/回放主循环串行；Wi-Fi 独立 FreeRTOS task 8192 栈，debug task 4096，LVGL adapter 自己调度。已有同步网络请求会阻塞按键处理，应抽离 transport worker。AEC、NS、VAD、唤醒词、TDM、多麦波束成形未实现，双声道混音不能等同于上述能力。

## Camera

BSP 有 esp_video DVP 初始化、V4L2 S_FMT、双 MMAP buffer、STREAMON、DQBUF/QBUF、停止释放与翻转。默认 1280×720 JPEG、20MHz XCLK、10kHz SCCB；支持 RGB565/BE、UYVY/JPEG 枚举，真实尺寸以协商返回为准；set_jpeg_quality 直接返回 NOT_SUPPORTED。没有 Bayer RAW 专用业务。

SmartBadge main 没调用 camera：应用抓图、预览、上传均未实现；不能把 BSP 存在视为工牌真板 Camera 验收。Phase 1 先保留 BSP 并实际抓图验证，不重写驱动。

## Display

LCD、GT1151 Touch、LVGL、中文字体、录音/播放/网络页面已实现；RGB framebuffer 位于 PSRAM，数量由 adapter 防撕裂模式决定。UI 每200ms刷新，共享状态用临界区保护，初始化用 LVGL lock。字体和控件渲染已用；图片 decoder 依赖存在，但工牌应用图片/Camera 渲染未实现。不能复制工牌页面为 FreshMate 页面。

## Connectivity 与服务

- Wi-Fi STA 已实现：扫描、默认网络/手动网络、企业 PEAP/TTLS、NVS 保存手选网络、失败冷却30秒、周期扫描与重连。wifi_profiles 直接调用 badge_ui 且引用编译凭据，需抽离配置和状态回调。
- Provisioning：LCD 输入 Wi-Fi；编译时默认配置。BLE、BLE provisioning 未实现。Wi-Fi 关闭省电，不能宣称低功耗。
- HTTP/HTTPS 已实现、证书 bundle 验证、禁自动跳转；设备 Bearer token，不使用 Web Cookie。WebSocket、MQTT、独立 heartbeat 未实现；周期请求不等于心跳协议。
- NVS 音量与网络配置、SD FAT、串口日志及调试控制已实现。NVS init 错误会 erase，FreshMate 需明确避免无提示丢配置。
- watchdog 为 SDK task WDT 5s、idle CPU0/1，panic 打印重启；未实现应用 crash 上报/专用 core dump 恢复服务。
- 录音 UUID 是 capture ID，不是完整独立设备证书身份。工牌归属通过 token 与服务器冻结员工/模板；不能带进家庭 Domain。
- OTA 未实现，分区不支持双槽；设备私有证书签发/轮换未实现。USB/UART 工具支持烧录/备份/身份核对，但本次没有执行。

## 复用分类

| 模块 | 分类 | 迁移方式 |
| --- | --- | --- |
| vendor BSP ES8389/I2S、LCD/Touch、ADC按键、LED、SD | REUSE_AS_IS | 保留原始组件与许可证/固定版本，不为命名改底层 |
| vendor Camera | REUSE_AS_IS | 保留实现；必须补真板抓图验收，不能承诺已稳定 |
| wav.c、audio_gain、audio_volume 的算法 | REUSE_AS_IS | 函数逻辑可直接用，封装公开 capability 接口 |
| recordings、SD恢复/元数据 | REFACTOR_AND_REUSE | 抽掉 badge 路径、上传状态和录音列表产品限制 |
| wifi_profiles | REFACTOR_AND_REUSE | 去 UI 依赖、注入配置、事件回调；保留重连策略 |
| main 中录音/播放/按键队列 | REFACTOR_AND_REUSE | 独立 audio worker 与 app 状态机 |
| HTTP TLS、send_all、hash/receipt 思路 | REFACTOR_AND_REUSE | 本地 Core endpoint、请求ID、错误/超时；不依赖 COS |
| build/flash/诊断脚本模式 | REFACTOR_AND_REUSE | 新路径/新配置/来源清单，不能调用旧项目配置生成器 |
| 员工归属、模板、capture reservation、COS grant contract | BADGE_ONLY | 禁止进入 HomeStash Domain |
| status_ui 页面、字体字集、badge状态、后台 prompts | BADGE_ONLY | 仅保留 LVGL 使用经验，FreshMate 另建交互 |
| 工牌 App 流程 | REWRITE | 产品状态与归属约束不同；仅重写 app，保留底层 |
| BLE/OTA/TTS/heartbeat | 不存在，新增 | 不属于重写已有功能 |

## Secrets 与来源边界

board.env、sdkconfig、生成的 local-network-config.h、BIN/ELF、NVS/Flash 备份可能包含 secret，需要通过配置注入。这里只记录位置和风险，不复制值。云密钥不下发固件；HomeStash 使用 .env.example，真实配置和数据库忽略。未来复制代码须记录来源提交/工作区摘要、许可证和修改；本阶段没有复制 SmartBadge 驱动。

## Phase 0 协议影响与 Phase 1 增量

使用版本化 HTTP JSON 事件、requestId 幂等、设备状态/心跳；音频契约预留 16kHz/16bit/mono WAV，图片契约预留 JPEG 与实际宽高、文件哈希。媒体经独立上传再引用 mediaId，不将大文件 base64 塞心跳。Phase 0 仅文本模拟与 Camera 元数据事件，不声称 STT/Vision/TTS 已接通。

Phase 1 新增 HomeStash 设备认证/配对、WAV 接收与校验、STT/TTS provider、PTT app、独立网络工作任务、LCD view model、音频下载播放、可选 camera upload。BLE 与 OTA 是独立后续任务，OTA 要新增双槽/回滚设计。第一条按键→录音→Core→库存→speaker/LCD 闭环无需购买另一块 ESP32 或 E-Ink；现有 LCD 若不在手头，用 Web/串口先验收。主要风险为开发版 SDK、共享 I2S 切换、同步网络阻塞、供电和内存压力；本阶段不承诺续航。

## 2026-10-18 实施补充

用户随后授权进入第一条 Phase 1 链路，并明确允许在 SmartBadge 忽略目录新增原开发板 Flash 备份后改刷 HomeStash。此例外不修改 SmartBadge 源码或配置。

已将 BSP、增益/音量/WAV 工具和公开锁文件复制到 HomeStash，逐文件来源和哈希见 `FIRMWARE_IMPORT_MANIFEST.json`。Wi-Fi 管理器改用 `hs_wifi` 符号/NVS 命名空间并注入 HomeStash 独立配置。FreshMate 新增显示、录放音、认证 HTTP、暂存重试及任务装配；没有复制原有企业 CA、Wi-Fi 或 AI 凭据。

原审计是 Phase 0 时点记录；后续实测状态以 `PHASE_1_PROGRESS.md` 为准。
