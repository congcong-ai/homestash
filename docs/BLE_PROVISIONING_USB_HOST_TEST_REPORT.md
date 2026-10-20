# BLE 配网与 USB-A 主机通信实测

日期：2026-10-20。开发板：ESP32-S31-Korvo-1 V1.1。

## BLE 配网

使用独立诊断固件，采用乐鑫官方 network_provisioning 1.3.1 的 BLE 传输和 Security 1。没有把普通 BLE 字符串读写当成配网成功。

实际通过的链路：

1. Mac 扫描到当前配网广播并建立连接。
2. 错误 PoP 被拒绝，设备记录 `Key mismatch`，客户端收到 ATT `0x85`，未下发网络凭据。
3. 正确随机 PoP 建立 Security 1 加密会话。
4. Mac 从 HomeStash 自己的本地配置读取 Wi-Fi SSID/密码，经 BLE 加密下发，设备确认接收；没有在编译时嵌入该网络凭据。
5. 配网管理器确认成功，串口记录获得 IP，客户端也通过 BLE 读到 `connected`。
6. 经串口 `reboot` 重启后，设备读取配网成功标记，不启动 BLE，直接使用保存配置，约 4.6 秒取得 IP。由此证明配置已持久化并可以在重启后使用。

关键状态日志：

```text
Security 1 加密会话建立成功
已通过 BLE 收到 Wi-Fi 凭据（不回显内容）
BLE 配网后，已获得IP
配网管理器确认联网成功
读取到配网成功标记；不启动BLE，验证已保存网络
重启后按保存配置重连，已获得IP
```

Mac 缓存了本硬件先前的 `HomeStash-Probe` 名称，初次按系统缓存名称匹配时未找到设备。客户端现按当前广播名称 `HS-Provision-Test` 匹配，再复用官方加密配网协议；修改后已实际完成上述链路。

本次使用 Mac CLI，未验收手机 App 的扫码/配网界面，也未实现日常 FreshMate 的 BLE 配网入口。Core 地址/Token 的 BLE 下发、企业 Wi-Fi、长距离、吞吐、蓝牙音频和长期 Wi-Fi/BLE 共存不在本次通过范围。

## USB-A 主机

用户已把 USB 键盘插入开发板 USB-A。独立固件原样复用原厂 factory_demo 的 HID Host 驱动，已记录：

```text
USB host installed
USB HID host initialized
HID Device, protocol 'KEYBOARD' CONNECTED
HID Device, protocol 'NONE' CONNECTED
```

同一键盘出现键盘和通用 HID 两个接口是复合设备枚举结果，不代表接了两把键盘。用户在持续监听正常期间按 A、B、C、Enter 后，设备累计记录到 4 次新按键输入：

```text
USB-A 类型=Keyboard 连接=2 断开=0 输入报告=1
USB-A 类型=Keyboard 连接=2 断开=0 输入报告=3
USB-A 类型=Keyboard 连接=2 断开=0 输入报告=4
```

因此 USB-A 的 HID 键盘枚举和实际输入通信通过。本次没有测试鼠标、U盘、USB音频、热插拔耐久或对外供电负载上限。

第一次按键时串口监听中断，未取得输入证据；用户说明中途离开并误触过键盘，因此重新安排了一次在监听稳定、设备不重启时的明确按键操作，并取得上述计数。没有将用户口头确认替代设备日志，也未记录键盘文本。

## 软件、配置与恢复

- 测试前实际设备运行 FreshMate 0.3.5，`ota_0`，应用偏移 `0x420000`。本地发布镜像与该 Flash 范围的设备 MD5 相同；回退副本 SHA256 为 `6352472bc5766f65b4095a1df6ce3d7cafa08f660825613026cdafa628165797`。
- NVS、分区表和 OTA 选择区均从设备读回并核对摘要。测试只替换当前应用槽，不改引导程序、分区表或 OTA 选择区。
- 诊断固件 1,697,840 字节，SHA256 为 `2445da935c4c19e58729809cdca264495690b823cc312c824ae34950f485da48`，写入后独立 `verify-flash` 摘要匹配。
- 初次恢复校验使用整块 `wifi_config_t` 的 `memcmp`，驱动回读时比较失败并触发一次断言重启。改为核对实际 SSID、密码和 BSSID 绑定字段后，恢复配置并校验一致、清理测试命名空间的真机日志已通过。没有把诊断程序的断言当成板卡故障。
- 修正后诊断固件 1,698,016 字节，SHA256 为 `727a062fb742edadadfdbfa4a059c078eeb9a5b5f7c139cc8df7ad52a638a4e0`，同样通过独立 Flash 摘要校验。USB 的 4 次按键输入和最终配置恢复在此固件上验收；它也再次用保存配置自动获得 IP。修正同时关闭了上游 Security 1 的信息级协议字节日志。
- 测试前保存 Wi-Fi 驱动配置；结束时通过 Wi-Fi API 恢复并核对，仅清理 `hs_ble_test` 测试命名空间，不原始擦写整个 NVS。FreshMate 的 `hs_wifi` 和 `hs_device` 已通过测试前后实际读取的 NVS 内容比对。
- 源码位于 `firmware/diagnostics/korvo-provision-usb`；Mac 客户端位于 `scripts/hardware/probe-provisioning.py`。依赖、来源和编译方法见诊断固件中文 README。SmartBadge 项目和共享 SDK 均只读使用。

恢复已完成：原 FreshMate 0.3.5 应用写回 `ota_0` 并通过独立 `verify-flash` 摘要校验；实际启动版本为 0.3.5、运行分区 `ota_0`、OTA 状态 `valid`。设备在线，首页同步正常，连续 Core 心跳 `ESP_OK`。

测试后实际读回的 NVS 经官方解析器比对，`hs_wifi`、`hs_device` 的有效键值逐项一致，测试命名空间没有残留有效数据；分区表和 OTA 选择区的设备摘要与测试前相同。没有整片擦除或原始重写 NVS，没有改动 SD 或原始工牌备份。

配网和 USB-A HID 均实测通过。本次完成独立诊断，不向日常固件增加 BLE 配网入口或 USB 键盘业务。

## 证据保管

本机实验目录为 `data/hardware/ble-usb-20261020/`，包含回退镜像、来源摘要、随机 PoP 和客户端结果，处于 Git 忽略目录。原始协议日志仅保存在本机受限目录，公开报告只摘录状态，不复制协议调试字节或网络凭据。

主要日志：`/tmp/homestash-provision-usb-flash.log`、`/tmp/homestash-provision-client.log`、`/tmp/homestash-provision-usb-device-reconnect.log`。原厂方案参考：[乐鑫 network_provisioning 示例](https://components.espressif.com/components/espressif/network_provisioning/versions/1.3.1/examples/wifi_prov?language=en)。

键盘输入及最终配置恢复日志：`/tmp/homestash-provision-usb-final-device.log`。原应用恢复和回归日志：`/tmp/homestash-provision-usb-restore.log`、`/tmp/homestash-provision-usb-restored-device.log`。关键日志另存于本机 `data/hardware/ble-usb-20261020/logs/`。可公开的结构化结果位于 `hardware-evidence/ble-provisioning-usb-host-20261020.json`，其中没有网络凭据或协议调试字节。
