# Korvo 拍照入库

2026-10-19。FreshMate 新增独立 Camera 能力，沿用 HomeStash 图片候选和确认服务。开发板型号为 ESP32-S31-Korvo-1 V1.1。

## 使用

1. 运行 `pnpm dev`，保持设备能访问 Core 的认证监听器 3101。
2. 将食材或包装放入镜头视野，按一下 **MODE**。SET 仍负责开始/停止录音；录音、上传或播报期间不会启动相机。
3. 设备显示照片识别完成后，在 Web 的“拍照入库”点击“刷新设备照片”。
4. 对照实物核对数量、单位和日期，点击确认才入库；不需要的识别可以取消。没有识别出物品时不会凭空添加。
5. 拍照或上传失败时按 MODE 重试。已经保存的 JPEG 沿用原 ID，不会重新拍摄覆盖。重启后会发现待上传照片。

串口调试可输入 `photo`、`status`；也可运行 `scripts/hardware/monitor.py --seconds 120 --photo --status`，自动等待启动后触发一次拍照。无需人工抄写屏幕文字。

## 复用依据

BSP 完全沿用已导入的 Espressif Korvo 组件，不修改引脚。来源和哈希见 `FIRMWARE_IMPORT_MANIFEST.json`。Camera 在 SmartBadge 应用中没有真实抓图证据，因此本次属于首次集成验证，不能声称是工牌已经验收的能力。

传感器启用项来自只读 SmartBadge 归档的原厂 `docs/ESP32-S31-Korvo-1/upstream/examples/esp32-s31-korvo/examples/factory_demo/sdkconfig.defaults`：OV3660 默认 RGB565 大端 240×240；SC101IOT 默认 UYVY 640×480。相机打开时接受实际探测到的默认格式；不强行使用 BSP 的默认 JPEG 分辨率。方向处理参考同目录 `main/factory_demo_camera.c`。没有复制工牌业务代码或配置凭据。

`components/camera/hs_camera.c` 调用 BSP 初始化、设置取帧超时、跳过启动帧，复制有效行并调用现成 `esp_new_jpeg` 编码器。每次拍照后归还帧、停止流、关闭 Camera 并释放缓冲，不长期占用摄像头。传感器不支持、超时、编码失败或存储失败都会报错，不返回伪造照片。

## 协议与保存

- `POST /device/v1/images/:id`，UUID 采集 ID、设备 ID / Bearer Token，正文为 `image/jpeg` 二进制，最大3 MiB。
- 设备不携带模型 Key，也不向心跳塞入 Base64。Core 内部转换图像后调用视觉 Provider。
- Core 按设备、采集 ID 和图片摘要去重；同 ID 换内容会拒绝。返回较小的 `id / reviewId / message`，Web 从既有图片接口读取完整候选。
- 照片存于设备 SD 的 `/sdcard/homestash/photos/<UUID>.jpg`。写入先使用 `.part`，刷新到存储后重命名；成功收到 Core 识别回执才删除完整照片。未完成的 `.part` 不伪装成可上传照片，也不保证恢复半张图片。
- 库存和事件只有通过审核确认才修改。重复上传、响应丢失或重复确认不会重复入库。
- 默认不在 Core 保存照片字节。仅硬件调试时可显式设置 `DEVICE_IMAGE_DEBUG_DIR=/绝对临时目录`，把收到的 JPEG 留在本机作画质验证，文件权限600；没有公开图片 URL。调试结束可删除目录并取消该变量。用户启用外部 AI 时，图像会发送至其配置的视觉模型服务。

## 验证范围

自动测试覆盖设备鉴权、浏览器 Origin 拒绝、图片格式、大小限制、并发重传、内容冲突、跨重启和候选确认。此前探测记录保留于 `hardware-evidence/camera-20261019.json`；后续独立真机复测已成功识别 SC101IOT、抓取 640×480 图像并生成可解码 JPEG，最新结果见 `CAMERA_RETEST_REPORT.md` 和 `hardware-evidence/camera-retest-20261019.json`。此前间歇性无响应的原因尚未确定；不把软件测试或编译成功称为真机抓图成功。

这次不实现常开视频、扫码、自动库存写入、复杂多图离线队列或最终相机硬件设计。

实际二进制协议与百炼探针：`pnpm exec tsx scripts/hardware/probe-device-image.ts /绝对路径/图片.jpg`。它监听临时本地端口、使用临时数据库和临时设备 Token，上传真实 JPEG 至已配置视觉模型，重复上传核对同一审核记录且不修改库存。输入文件不代表 Korvo 实际拍摄。2026-10-19 的合成小票联调返回3个候选，结果位于硬件证据记录的系统临时目录。
