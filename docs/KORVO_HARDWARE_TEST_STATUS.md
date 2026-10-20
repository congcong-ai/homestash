# Korvo 硬件验收清单

2026-10-19，ESP32-S31-Korvo-1 V1.1。用户提供的实测结果与本次串口实测分开记录。

| 能力 | 状态和证据 |
| --- | --- |
| 麦克风 | 用户确认已测正常；未据此声称双麦每个声道均完成独立测试 |
| 外接扬声器 | 用户确认已测正常 |
| Wi-Fi | 用户确认已测；本次串口也有联网和 Core 心跳成功记录，期间存在断线重试 |
| LCD 显示 | 用户确认已测正常 |
| LCD 触摸 | 用户于本会话确认正常 |
| RGB 指示灯 | 用户于本会话确认正常 |
| microSD 卡 | 用户于本会话确认正常；本次也实际保存并恢复待上传 JPEG |
| SET、VOL+、VOL− | 用户确认已测正常 |
| MODE | 串口 photo 复用同一业务入口已实测；实体键按下尚未在本轮单独验收 |
| 两个 USB-C 口 | 用户确认已测；分别是供电口和供电/串口口 |
| USB-A 主机接口 | 2026-10-20 补测通过：真实 USB 键盘枚举成功，并收到用户按键产生的 4 次新输入；其它 USB 设备类别未验收 |
| 摄像头 | 本次 SC101IOT 抓帧、JPEG 解码和上传成功；见 CAMERA_RETEST_REPORT.md |
| BLE 蓝牙 | 独立诊断固件实测通过：Mac 扫描（RSSI −41 dBm）、连接、服务发现、初值读取、写入确认及 19 字节随机测试串读回一致 |
| BLE 配网 | 2026-10-20 独立诊断通过：错误 PoP 拒绝、正确加密会话、BLE 下发 Wi-Fi 凭据、获得 IP，重启后按保存配置自动重连 |
| 经典蓝牙、蓝牙音频 | 尚未验收；BLE 数据收发通过也不代表 A2DP 或 LE Audio 通过 |
| Flash | 固件烧录、启动已实际使用；不等于全容量压力测试 |
| PSRAM | 本次相机帧缓冲及 JPEG 编码已使用；不等于完整内存压力测试 |
| BOOT / RESET | 本轮未要求用户逐键验收；串口复位属于不同证据 |

官方资料还列有 IEEE 802.15.4 / Zigbee / Thread 等无线能力，尚未测；这些属于另外的协议栈验证。SPI NAND 默认未焊接，不列为现有板卡的必测故障项。睡眠功耗、长时间运行、USB-A 对外供电及多外设满载稳定性也不由基本功能通过推导。

因此，常用外设中的摄像头、BLE、BLE 配网和 USB-A HID 键盘通信均已有真实通过证据；仍未覆盖经典蓝牙/蓝牙音频、其它 USB 设备类别，以及上述专项或压力测试。摄像头此前间歇性问题原因未确定。配网和 USB 补测细节见 [专项报告](BLE_PROVISIONING_USB_HOST_TEST_REPORT.md)。

## BLE 实测方法和边界

本节记录 2026-10-19 的基础 BLE 读写实验；2026-10-20 追加的加密配网、重启重连与 USB-A 键盘输入均已通过，测试后恢复 FreshMate 0.3.5、原网络和 Core 配置，设备在线且首页同步正常。新增证据见 [补测报告](BLE_PROVISIONING_USB_HOST_TEST_REPORT.md)。

诊断固件位于 `firmware/diagnostics/korvo-radio/`，Mac 客户端位于 `scripts/hardware/probe-ble.swift`。使用 SDK 锁定的 Espressif 蓝牙控制器库提交 `cc027ecd288b31198f82331faabb972a37d6800e`，组件仅复制至 HomeStash 忽略目录；共享 SDK 和 SmartBadge 项目未修改。

开发板应用先从 Flash 完整读回，2,162,816 字节与 FreshMate 回退镜像逐字节相同。随后仅写应用地址 `0x10000`，esptool 哈希校验成功；未更改引导程序、分区表、NVS 或 SD。

Mac 客户端输出（`/tmp/homestash-ble-client.log`）：

```text
Mac 蓝牙状态=5，授权=3
扫描到目标：HomeStash-Probe RSSI=-41
连接成功
服务和读写特征发现成功
初值读取通过
写入收到确认
通过：BLE 扫描、连接、GATT 读取、写入和随机数据读回均成功，共 19 字节
```

本实验不验证加密配对、远距离性能、吞吐量、Wi-Fi 共存、BLE 配网业务、A2DP 或 LE Audio。恢复 FreshMate 后诊断广播会消失；本次确认蓝牙硬件和基础 BLE 协议可用，不表示日常产品固件已经提供蓝牙功能。

结构化证据：`hardware-evidence/ble-retest-20261019.json`。测试固件的准备和编译方法见其目录内的中文 README。

## 恢复验收

已恢复完整读回的原 FreshMate 应用，SHA256 为 `7a0a55eb484b4166a2f8db7d91d080dc06582a73b8d1902fc1f1dce208e925e6`，esptool 写入哈希校验通过。恢复后 LCD、存储和音频初始化完成，Core 心跳 `ESP_OK`，再次拍摄 640×480 JPEG 并上传成功。没有擦除 NVS/SD、没有覆盖原始工牌备份。恢复日志位于 `/tmp/homestash-ble-restore.log` 和 `/tmp/homestash-retest-restored.log`。

结束前设备已联网、首页已同步，设备上报的实际屏幕文字与首页内容一致（`/tmp/homestash-retest-final-network.log`）。仍观察到 Wi-Fi 间歇性连接失败，未将重新连通记为网络根因已修复。本轮全部关键串口日志另存于本机忽略目录 `data/hardware/retest-20261019/logs/`；回退镜像保存在同级 `rollback/`，未提交二进制或家庭图片。

## 设备维护增量 · 2026-10-20

已在独立FreshMate固件增加LCD网络/Core/更新设置，用户确认设置和Wi-Fi列表显示正常。串口Core配置保存、手动连接、获得IP后保存和心跳均通过；下载中断时OTA保留当前应用。本轮同一固件再次抓取SC101IOT 640×480 JPEG并成功上传，未确认入库。最终升级版本、分区和验收边界见 [维护说明](DEVICE_SETUP_AND_OTA.md)。本段不改变前述BLE仅为独立诊断通过的范围。

## 日常固件BLE集成 · 2026-10-21

0.4.3完成日常BLE加密配网、错误PoP后重连、不可用网络失败后正确配置、幂等/冲突、保存和重启恢复、180秒窗口关闭与手动关闭。0.4.2→0.4.3双槽OTA通过。相机640×480实际采集上传、真实语音查询与用户试听、Light/Deep Sleep恢复通过；240秒48次采样无意外重启和库存变化。手机配网前台和日常USB-A扫码枪仍未完成。详情见 [日常BLE验收](DEVICE_BLE_PROVISIONING.md)。
