# Korvo BLE 配网与 USB-A 主机专项测试

本目录是一次性诊断固件，验收结束后恢复 FreshMate 0.3.5。它不向日常固件增加配网入口，也不承担库存操作。

## 代码来源

- BLE 配网：乐鑫 `idf-extra-components/network_provisioning` 1.3.1，使用官方 BLE 传输与 Security 1（X25519、AES-CTR、PoP）。上游地址：https://github.com/espressif/idf-extra-components/tree/master/network_provisioning 。本次下载归档和 SHA256 存于本机 `data/hardware/ble-usb-20261020/sources.json`。
- USB HID：`factory_demo_usb_hid.c/.h` 原样复制自 SmartBadge 只读归档的原厂 factory_demo；上游 esp-dev-kits 提交 `6f4b0f6ef304d76246325e9a9f94c1ddad8ed39c`，保留文件内 Apache-2.0 声明。原项目未修改。
- SDK：共享 ESP-IDF 提交 `ab95e70748f2eddac6f87217b0cf62533684a6ba` 只读使用。缺失的蓝牙控制器、protobuf-c 子模块仅在 HomeStash 的 data 目录补齐，不修改共享 SDK。
- 蓝牙控制器提交 `cc027ecd288b31198f82331faabb972a37d6800e`；protobuf-c 提交 `abc67a11c6db271bedbb9f58be85d6f4e2ea8389`。

## 行为与验收

首次启动不依赖内置 Wi-Fi 凭据，开启 `HS-Provision-Test` 广播；客户端验证错误 PoP 被拒绝后，使用一次性随机 PoP 建立加密会话，经 BLE 下发网络信息。官方配网管理器保存网络配置，设备获得 IP 后写入 `hs_ble_test/ready` 标记。输入串口 `reboot` 后不启动 BLE，直接验证保存配置是否能联网。

USB-A 同时运行原厂 HID Host，记录枚举、连接/断开计数和输入报告计数；不会将键盘输入解释为配置命令，也不在日志中输出键盘文本。需要在开发板 USB-A 口插入真实键盘或鼠标，并产生输入。供电正常、驱动安装成功均不能代替实际通信通过。

## 配置与构建

依赖缓存按 CMakeLists.txt 所列路径准备在 HomeStash 的忽略目录。随机 PoP 保存于 `data/hardware/ble-usb-20261020/private.json`，对应生成头文件 `probe_private.h`，二者权限为 600。不要把此文件、含它的固件镜像或配置备份提交到仓库。

```bash
export IDF_SKIP_CHECK_SUBMODULES=1
export PATH=/Users/peter/.espressif/python_env/idf6.2_py3.12_env/bin:$PATH
source /Users/peter/esp/esp-idf-smartbadge/export.sh
cd firmware/diagnostics/korvo-provision-usb
idf.py -j 4 build
```

客户端使用 `scripts/hardware/probe-provisioning.py`。Python 依赖安装到本机 `data/hardware/ble-usb-20261020/python`，包括 bleak、cryptography 和 protobuf；网络凭据从 HomeStash 自己的 `data/hardware/device.env` 读取，不从 SmartBadge 复制，不通过命令行参数传递。

## 刷写及恢复

本轮设备真实运行于 `ota_0`，偏移 `0x420000`，版本 0.3.5。刷写前已将本地发布镜像与设备应用范围 MD5 核对，保存回退副本；NVS、分区表和 OTA 选择区从设备读回并核验摘要。

实验脚本仅向当前应用槽写入，不写引导程序、分区表或 OTA 选择区。BLE 配网会由官方驱动写入 NVS；结束时先用 Wi-Fi API 恢复测试前网络配置并核对一致，仅清理 `hs_ble_test` 测试命名空间；随后恢复原应用并核对写入摘要，不原始重写或擦除 NVS 分区。禁止整片擦除、禁止覆盖原始工牌备份。实验工具及回退文件位于本机忽略目录 `data/hardware/ble-usb-20261020/`，脚本绑定 USB serial 和芯片 MAC，不能用于其它设备。

真实结果以项目 `docs/BLE_PROVISIONING_USB_HOST_TEST_REPORT.md` 为准。独立诊断通过不代表手机配网界面、Core 地址/Token 的 BLE 下发、加密配对、其它 USB 类设备或日常固件集成已验收。
