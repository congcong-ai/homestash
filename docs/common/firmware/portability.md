# 固件复用与多板适配

2026-11-05：共用产品应用已增加独立运行时与文件系统接口，构建目标包含 ESP32 Korvo 和实验性的涂鸦 T5。T5 的编译与真机状态分别记录在 [T5 适配说明](../../hardware/tuya-t5-ai/bring-up.md)。

## 设计原则

业务流程只维护一份。换固件平台或开发板时，实现同一组接口，并为目标单独构建镜像。平台差异收进适配层，库存、AI、食谱、烹饪和设备管理继续由 Kitchen Core 提供。

```text
Kitchen Core / Web
        │ HomeStash 通用设备协议
        ▼
apps/freshmate                     一份产品主循环
        │
shared/components/device_port      运行时、网络、配置、音频、显示等契约
shared/components/outbox           录音队列和断电恢复逻辑
        │
        ├── platforms/esp-idf      ESP 任务、HTTP、NVS、配网、OTA 等
        └── platforms/tuyaopen     TAL 任务、HTTP、KV、Wi-Fi、VFS 等
                    │
boards/esp32-s31-korvo-1            Korvo BSP、音频、LCD、相机、输入
boards/tuya-t5-ai                   T5 BSP、音频、LCD、输入
```

完整目录规则与构建入口见 [firmware/README.md](../../../firmware/README.md)。能力缺失或尚未移植时明确拒绝相关操作，不复制主应用，也不把缺失功能伪装成成功。

## 适配边界

- 产品应用只依赖 `hs_*` 契约：任务队列、优先插队、线程、计时、随机数、启动初始化、日志、网络、配置、媒体、显示和升级等。不再直接引用 ESP-IDF、FreeRTOS、BSP 或 LVGL。
- `hs_runtime.h` 规定毫秒超时、永远等待及队列前插语义。ESP 与 Tuya 分别实现，不在应用里判断芯片。
- 录音队列通过 `hs_fs.h` 执行读写、同步、重命名和目录遍历。ESP 使用 POSIX 文件实现；T5 使用其 VFS 文件描述符。ID、WAV 校验、重试和恢复策略由同一份 `hs_outbox.c` 提供。
- 设备协议公共头不再暴露 ESP HTTP 客户端句柄。ESP 专用的 `hs_transport_esp.h` 留在平台实现中。
- 音频以 16kHz、16 位、单声道 PCM WAV 与 Core 交换；图片入口使用 JPEG。新板需遵守同一边界，不能借用另一块板的采集算法验收。
- 共用字库位于 `shared/assets`。页面渲染、触摸输入、尺寸和刷新属于板级实现；T5 没有复制 Korvo 的固定界面与路演工程。
- 存储不可用时继续联网与同步页面，禁止创建新录音。T5 仅在 SD 挂载成功后上报持久化存储能力，不自动格式化或降级成易失存储。

## 构建目标与当前限制

```sh
pnpm hardware:targets
pnpm hardware:build:generic --board korvo-s31
pnpm hardware:build:generic --board tuya-t5-ai
```

`targets.json` 维护稳定板型 ID、工程位置、平台名和 SDK 提交。未知目标直接失败，不退回 Korvo。各工程独立存放构建缓存；SDK 与口令保存在 Git 忽略目录。

T5 目前按原厂 V1.02 主板和 3.5 英寸触摸屏配置；屏幕型号、SD 和真机状态还需核对。Wi-Fi、屏幕、按键录音、上传及播放已有源码实现，真机功能不能仅由编译推断。T5 的相机、本地唤醒、离线演示馆、BLE 配网、休眠和 HomeStash OTA 尚未移植。尚未适配的能力不继承 Korvo 的成功记录。

平台和板型接口通过构建时链接选择，增加一块板无需引入遍布业务代码的板型判断。当前基于原厂 SDK 的组织方式，可参考 [ESP-IDF 组件构建](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/build-system.html)及 [TuyaOpen 编译流程](https://tuyaopen.ai/zh/docs/quick-start/project-compilation)。

## 后台与固件发布

Core按设备ID维护身份、状态、能力和独立凭据。旧0.4.x固件没有上报能力时显示“尚未上报”，不会凭空标成全部支持。

新版镜像必须包含且只包含一个`HS_TARGET_V1:<boardId>`标记；它和应用段一起受镜像校验及摘要保护。发布时核对所选板型，按板型保存最新版本；设备取manifest或直接取bin都检查登记板型。**同一芯片不等于固件可以互刷。**

旧0.0–0.4系列无标记镜像只按历史Korvo兼容处理。0.5及以后缺少标记时拒绝发布。当前镜像解析器仍只支持已验证的ESP32-S31格式；选用其他芯片后，应先增加其真实镜像校验和对应测试，不因设备已登记就开放下载。

OTA仍使用应用镜像校验和Token HMAC；板型匹配是防误刷机制，不是硬件安全启动或供应链签名。新增manifest含boardId，升级新固件前先升级Core；旧0.4.3设备可继续使用新版Core。

## 2026-10-21 历史验证与边界

以下“未刷入”“设备保留 0.4.3”均为当日状态。后续 0.5.0 路演增量的刷入与回归记录见 [Korvo 路演说明](../../hardware/esp32-s31-korvo-1/roadshow/guide.md)，不能将当日状态作为当前板上版本。

- 0.5.0通用镜像构建及真实镜像解析通过；板型标记为Korvo，未刷入设备，也未设置为日常OTA发布版本。
- 38项软件测试通过，覆盖多设备认证/状态/音频隔离、撤销和重新签发、按板型选择固件、拒绝跨板下载及旧固件兼容。
- ASAN/UBSAN主机检查覆盖公共能力策略、Wi-Fi恢复、配置校验和电源状态；不代替第二块物理板测试。
- 网页临时数据库完成第二台设备登记、一次性凭据关闭和按板型选择，日常库存未用于验收写操作。
- lint、typecheck、Web build与固件build结果见本轮结构化证据。设备保留上次实测的0.4.3，0.5.0硬件回归留到用户重新连接时。

结构化证据：[后台与固件复用验收](../evidence/device-management-portability-20261021.json)。网页截图使用隔离测试设备，不代表新增物理板卡。
