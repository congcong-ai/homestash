# Korvo 摄像头复测记录

日期：2026-10-19。板卡：ESP32-S31-Korvo-1 V1.1。

## 结论

本次在没有修改或重刷 FreshMate 固件的情况下，成功探测 SC101IOT（PID `0xda4a`），取得真实帧、编码 JPEG、上传 Core，并生成待确认审核记录。JPEG 可以正常解码，画面可见桌面和实物。当前没有依据判定摄像头损坏或申请补寄。

此前两次传感器无响应的原因尚未确定。本次通过不等于间歇性问题已定位；排线接触、上电状态、供电质量等因素仍未通过电气测量排除。

## 资料和软件核对

- 先只读核对 SmartBadge 的板卡归档资料，以及原厂 `factory_demo/README.md`、`sdkconfig.defaults`、`main/main.c`、`main/factory_demo_camera.c` 和公共 BSP。
- HomeStash BSP 主文件与归档原厂文件逐字节相同，SHA256 为 `e3f41205f4d61839c6842de6685e1bc659ef932ec313cad6d97c7fab3525dd50`。未更改引脚。
- 原厂 BSP 依赖 `esp_video 2.4.1` 和 `esp_cam_sensor 2.4.*`，本项目解析的传感器组件为 `2.4.0`；传感器启用项及默认格式与工厂示例一致。
- 原厂先启动相机，再启动 LCD/触摸和音频；FreshMate 先启动 LCD/触摸和音频，再按需打开相机。这是需要关注的差异，但本次 FreshMate 原有顺序已成功采集，不能把顺序差异认定为此前故障根因。
- 相机、触摸和 Codec 沿用 BSP 共享 I2C；BSP 使用现有总线句柄，不重建第二条总线。相机外部时钟配置为 20 MHz。日志成功探测说明该次传感器控制通信成立，不代表已经用示波器测量时钟或电源。

## 真实设备证据

复测前的应用镜像长度为 2,162,816 字节，SHA256：

`7a0a55eb484b4166a2f8db7d91d080dc06582a73b8d1902fc1f1dce208e925e6`

运行：

```bash
/Users/peter/.espressif/python_env/idf6.2_py3.12_env/bin/python scripts/hardware/monitor.py --seconds 55 --status --photo
```

基线串口证据 `/tmp/homestash-retest-baseline.log`：

```text
sc101iot: Detected Camera sensor PID=0xda4a
S31-Korvo: Camera format: 640x480, fourcc=UYVY
S31-Korvo: Camera first frame: index=0, bytes=614400
hs_camera: JPEG saved id=fbbfc976-54b2-466b-813e-d85537d4683c bytes=24589
```

当时 Wi-Fi 未连接，照片保存在 SD；下一次重试上传成功，`result=3`，Core 返回 0 个候选。画面没有可识别食材，因此不能用“候选为零”判断拍摄失败。

第二张照片采集和重试日志为 `/tmp/homestash-retest-camera3.log`、`/tmp/homestash-retest-camera4.log`。Core 临时启用 `DEVICE_IMAGE_DEBUG_DIR=/tmp/homestash-retest-images` 保存 JPEG，用于真实画面验收。

- 文件：`/tmp/homestash-retest-images/d39e68d1-099f-4420-9514-23ad846d10ff.jpg`
- 大小：24,668 字节；640×480 JPEG。
- SHA256：`81c229469535f1c371220f65ee253a52d00e8831a3070b0c191cc3f2a52027ed`。
- 使用 macOS `sips` 解析，并实际打开检查画面：能看到桌面和物体，非空白、非伪造图片。
- 未确认任何候选，未执行库存入库操作。照片只保存在本机忽略目录/临时目录，不放入公开文档或提交。

蓝牙诊断结束后，已把完整读回且核验过的同一 FreshMate 应用恢复至 `0x10000`，esptool 写入哈希校验通过。恢复后的再次拍照也成功：SC101IOT、640×480、25,350 字节 JPEG，上传 `result=3`，Core 心跳持续 `ESP_OK`。该张照片 SHA256 为 `18b0d44618bfc73882412925bb88ac1220d8bba8ff4c1c4f6b49dd9d9fdec006`，日志为 `/tmp/homestash-retest-restored.log`。本次合计三次新采集成功，前两次的离线照片随后重试上传成功。

图片临时留存仅在本次诊断用的 Core 进程环境中启用，结束后已重新启动常规 `pnpm dev`，恢复默认不留存照片字节的配置。

## 如果再次无响应，可发给店家的文字

你好，我购买的是 ESP32-S31-Korvo-1 V1.1 套件，摄像头是套件自带并已安装的，镜头盖已取下。目前有间歇性初始化问题：之前多次提示读取传感器 ID 失败、I2C 无响应；后来使用同一份固件又成功识别到 SC101IOT（PID 0xda4a），并拍出了正常的 640×480 JPEG。板上的屏幕、触摸、麦克风、喇叭、Wi-Fi 和 SD 卡可以工作。我们已核对原厂 BSP 引脚及传感器配置，但还没有确定间歇性失败的原因。请帮忙确认这批套件应配什么摄像头型号、排线方向和锁扣安装要求、推荐供电规格，以及是否有对应的出厂测试固件和检测方法。如果按你们的方法仍反复失败，能否安排排线/摄像头的替换测试或售后处理？谢谢。

当前无需发送换件申请；上述文字供问题复发时咨询，不能作为摄像头已损坏的结论。
