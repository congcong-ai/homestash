# 固件复用与多板适配

更新：2026-10-21。用户已明确调整优先级：先完善后台和可复用固件，暂停手机BLE入口、原型板专项优化和长期功耗实验。Korvo是验证产品的原型载体，不是必须保留的消费版硬件清单。

## 采用的方式

采用“同一份产品应用 + 公共ESP-IDF服务 + 编译时选择板级适配器”。每种板型分别构建镜像，不追求一个二进制跨芯片、跨接线直接运行。这样既能复用成熟驱动，也不会为了换一个按键或Codec重写库存交互、上传、重试和设备协议。

这是基于本项目现有资产作出的工程选择：ESP-IDF允许通过组件和EXTRA_COMPONENT_DIRS组织共享代码，原厂BSP负责硬件封装。参见 [ESP-IDF构建与组件](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/build-system.html) 和 [ESP-BSP](https://github.com/espressif/esp-bsp)。

```text
Kitchen Core（库存、AI、食谱、烹饪、设备管理）
            │ 通用设备协议
            ▼
firmware/apps/freshmate_app          产品流程，单一来源
firmware/common/components/          公共ESP-IDF服务、能力契约
            │ 链接时选择实现
            ▼
firmware/freshmate-korvo/components/  当前Korvo适配器
未来独立构建目标/components/           新板适配器
            │
            ▼
原厂BSP / Codec / Camera / LCD / GPIO
```

## 已完成的边界

- `firmware/apps/freshmate_app`：录音状态、异步上传、失败重试、页面同步、照片处理、OTA和休眠动作编排。不引用Korvo BSP、GPIO或LVGL。
- `firmware/common/components/device_port`：音频、相机、显示、设置界面、存储及板型能力接口。物理SET/MODE由适配器转成语音切换/拍照等语义动作；精简板可以使用另一种按钮或输入方式。
- 公共服务：`network`、`device_config`、`outbox`、`protocol`、`ota`、`provisioning`、`power`。其中Wi-Fi/BLE、HTTP、NVS和睡眠目前仍依赖ESP-IDF，不能据此声称已经跨所有MCU平台。
- Korvo工程保留Codec、Camera、LCD/触摸、存储挂载及按键实现；原厂BSP和已验证的采集/播放算法未重写。
- 持久化根目录由目标工程指定，公共录音队列不再写死SD卡挂载点。新板可以挂载自己的文件系统，但需满足原子替换和断电恢复要求。
- 能力策略统一检查。没有相机、蓝牙或语音硬件时明确拒绝对应操作，使用Web补齐入口，不把缺失能力伪装成成功。

驱动API在构建时链接，而不是在运行时维护一套庞大的板型判断或函数表。适配器必须实现相同契约；缺少实现会构建失败。可选能力的禁用实现需明确返回不支持，不能复制一份FreshMate主程序再修改。

## 构建目标

`firmware/targets.json`记录目标工程、板型ID、锁定SDK提交和当前S31依赖准备要求：

```sh
pnpm hardware:targets
pnpm hardware:build:generic --board korvo-s31
```

未知目标直接失败，不自动回退Korvo。每个工程有独立的build、sdkconfig、分区和依赖锁；SDK不同可通过HOMESTASH_IDF_PATH和HOMESTASH_IDF_PYTHON_BIN指定，构建仍核对该目标的锁定提交。

当前仅Korvo是真实硬件适配器；主机上的全能力/精简语音配置只验证公共策略，**不是第二块开发板已经适配**。

## 后台与固件发布

Core按设备ID维护身份、状态、能力和独立凭据。旧0.4.x固件没有上报能力时显示“尚未上报”，不会凭空标成全部支持。

新版镜像必须包含且只包含一个`HS_TARGET_V1:<boardId>`标记；它和应用段一起受镜像校验及摘要保护。发布时核对所选板型，按板型保存最新版本；设备取manifest或直接取bin都检查登记板型。**同一芯片不等于固件可以互刷。**

旧0.0–0.4系列无标记镜像只按历史Korvo兼容处理。0.5及以后缺少标记时拒绝发布。当前镜像解析器仍只支持已验证的ESP32-S31格式；选用其他芯片后，应先增加其真实镜像校验和对应测试，不因设备已登记就开放下载。

OTA仍使用应用镜像校验和Token HMAC；板型匹配是防误刷机制，不是硬件安全启动或供应链签名。新增manifest含boardId，升级新固件前先升级Core；旧0.4.3设备可继续使用新版Core。

## 新板接入时要做什么

1. 新建独立目标工程，登记真实boardId、SDK和分区，不猜引脚。
2. 复用公共组件和同一个freshmate_app，实现device_port与board适配；优先采用该板已验证的原厂BSP。相同外设驱动可以直接复用。
3. 将麦克风、扬声器、Camera格式转换封装在适配器，保持当前协议的16kHz单声道PCM WAV和JPEG边界。
4. 明确能力、内存、文件系统、显示尺寸与刷新方式；没有LCD、Camera或BLE时选择对应禁用/替代实现，不能引入Korvo的固定布局和硬件依赖。
5. 新板能力齐全时复用同样的业务流程；能力缺失时由Web补齐相应入口，不承诺仅靠软件实现不存在的硬件功能。
6. 编译和主机测试后，只做必要的真机回归：录音到Core到播报、存储恢复、显示/输入及适用的OTA。电流、休眠、供电和板级时序必须重新验证，不能继承Korvo结论。

不必现在购买另一块板，也不需要先设计Rev.A。待成本、尺寸和必要能力确定后，再选择真实目标并实现第二个适配器。

## 本轮验证与边界

- 0.5.0通用镜像构建及真实镜像解析通过；板型标记为Korvo，未刷入设备，也未设置为日常OTA发布版本。
- 38项软件测试通过，覆盖多设备认证/状态/音频隔离、撤销和重新签发、按板型选择固件、拒绝跨板下载及旧固件兼容。
- ASAN/UBSAN主机检查覆盖公共能力策略、Wi-Fi恢复、配置校验和电源状态；不代替第二块物理板测试。
- 网页临时数据库完成第二台设备登记、一次性凭据关闭和按板型选择，日常库存未用于验收写操作。
- lint、typecheck、Web build与固件build结果见本轮结构化证据。设备保留上次实测的0.4.3，0.5.0硬件回归留到用户重新连接时。

结构化证据：[后台与固件复用验收](product-evidence/device-management-portability-20261021.json)。网页截图使用隔离测试设备，不代表新增物理板卡。
