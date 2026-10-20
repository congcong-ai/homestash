# 开发暂停与恢复记录

> 2026-10-21 已按用户要求恢复开发。下文为前一晚暂停快照，不代表当前固件和服务状态；本轮结果见 [BLE日常固件记录](DEVICE_BLE_PROVISIONING.md)。

暂停日期：2026-10-20（北京时间）。用户明确要求暂停，开发板可以断电，等待用户明天接通并要求继续后再恢复。已收到用户最新工作约定，后续以其替代此前AGENTS约定。

## 安全状态

- 已停止本轮固件构建及子进程、串口监控；已清空本轮串口命令队列和一次性配网信息。
- 暂停前开发板运行 **0.4.1 / ota_0 / valid**，无录音、待处理录音或照片、无上传任务、无进行中的OTA。可以断开全部供电。
- **0.4.2仍是未完成构建和验证的源码，不在开发板上。** 不得把build目录中的旧bin当成0.4.2。
- 本轮本机调试服务已停止，不安排后台测试或自动继续。
- 日常SQLite仍为4项库存、4条事件；未为BLE验收改变库存。
- 工作保留在当前工作树，尚未提交或推送本轮BLE集成。此前README及条码功能已推送main，最新已发布提交为 `fb4df1d`。

## 已取得的结果

1. 独立专项：BLE错误PoP拒绝、正确加密配网、重启自动重连、USB-A键盘实际4次输入均通过，见 [专项报告](BLE_PROVISIONING_USB_HOST_TEST_REPORT.md)。这不等于日常固件BLE集成已通过。
2. 日常固件新增独立provisioning组件、LCD蓝牙页、主动开启的180秒窗口、随机一次性PoP、官方protocomm BLE/Security 1、Wi-Fi与Core配置校验及提交、请求重放/冲突保护、关闭与清理。沿用既有Wi-Fi管理器，不让官方诊断network_provisioning管理器同时接管Wi-Fi。
3. 新增锁定BLE依赖准备脚本，原样复用官方Python Security 1客户端；共享SDK和SmartBadge保持未修改。
4. 主机ASAN/UBSAN检查通过：真实配置处理代码的字段校验、空字符拒绝、幂等/旧请求保护、仅联网后保存Core、连接失败和取消边界。加密/无线是主机桩，不代替真机。
5. Wi-Fi主机检查（含取消恢复已保存网络）通过；35项软件测试、lint、typecheck、Web build通过。
6. 0.4.0和0.4.1通用固件构建、实际OTA与启动valid确认均成功。但**两版日常固件中的BLE启动均失败，不能宣称产品配网通过**。

## 实际失败与当前修正方向

- 0.4.0：空闲内部堆约21KB，最低仅约1.2KB；BLE控制器 `ble_controller_init failed 257`，底层记录 `ble ll env init error code:-10`。没有成功开启产品配网窗口。
- 0.4.1：启用蓝牙动态环境内存与PSRAM优先、限制单连接后，空闲内部堆约35KB，启动最低约17KB；仍出现 `btdm_osal_elem_mempool_init failed: -1`。没有完成真实配置下发。
- 既有LVGL builtin内存池 `work_mem_int.0` 固定占用64KiB内部BSS，这是完整LCD固件与无LCD诊断的内存差异之一。
- 当前0.4.2源码：启用SDK `CONFIG_SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY`，通过LVGL官方 `LV_ATTRIBUTE_LARGE_RAM_ARRAY` 将界面堆放入PSRAM；配置位于 `sdkconfig.defaults`、CMake及 `components/display/include/hs_lvgl_memory.h`，不修改板级驱动。**构建被用户暂停中止，尚未得到新镜像或真机结果。**
- 设备到Core仍观察到间歇性 `ESP_ERR_HTTP_EAGAIN` /连接超时，后来也有 `ESP_OK`；网络根因未解决。

## 明天的恢复顺序

1. 用户重新连接UART供电后，按USB serial确认唯一目标，先读当前0.4.1的状态。不要重跑独立诊断或误刷factory分区。
2. 根据用户最新启动端口约定检查现有进程和占用；恢复本项目Core/Web，核对设备LAN端点。不要误停其他项目服务。
3. 完成0.4.2通用构建并检查ELF中LVGL内存池的实际位置、应用大小、配置摘要、无本机secrets。
4. 启用前确认内部内存余量充分；通过现有双槽OTA安装并等待新槽valid。最新0.3.5稳定回退镜像仍保留，见下方资产；不使用未经核对的build产物。
5. 保持**唯一一个**串口监控。先前出现过两个监听同时读取，导致日志被拆分和重复连接；这不能当成新的物理断电证据。监控支持 `--ble-private-file`，一次性信息只写权限600文件，普通日志隐藏。
6. 使用产品客户端验证错误PoP、非法Core、正确Wi-Fi/Core加密配置、相同ID重放/冲突、真实NVS保存、关闭和重开窗口、超时、重启恢复。未通过时保留失败并修复，不以独立诊断通过代替。
7. 重点回归LCD配置键盘、语音录音/播报、相机和Light/Deep Sleep；外部BSS配置改变了内存位置，必须以真机结果确认，不凭构建下结论。
8. 更新README、BUILD_STATUS、审计和专门的产品BLE验收报告，再按既有授权提交/推送；不进入微信、PCB或消费版功耗承诺。

## 工具与证据

- `scripts/hardware/prepare-ble.py`：SDK组件本地副本及锁定归档；缓存 `data/hardware/esp-idf-ble-components/`。
- `scripts/hardware/check-provisioning.py`、`check-wifi-profiles.py`：主机检查。
- `scripts/hardware/provision-freshmate.py`：产品BLE客户端，官方Security 1实现位于 `vendor/espressif/protocomm-client/`。客户端目前单帧480字节限制，超长配置应明确拒绝并使用LCD；手机配网界面尚未实现。
- `scripts/hardware/monitor.py --command-file ... --ble-private-file data/hardware/freshmate-ble/private.json`：受限本机调试。PoP不可写入心跳或公开文档。
- SDK `/Users/peter/esp/esp-idf-smartbadge`，提交 `ab95e70748f2eddac6f87217b0cf62533684a6ba`；Python `/Users/peter/.espressif/python_env/idf6.2_py3.12_env/bin/python`。
- USB serial `e475ee17b9bcf011ae28107148e9de0f`，设备MAC `1c:29:04:d0:54:a8`；最近串口 `/dev/cu.usbserial-1410`，恢复时重新按身份匹配。
- 本机证据 `data/hardware/freshmate-ble/logs/`、暂停状态 `data/hardware/freshmate-ble/pause-state-20261020.json`；原始日志 `/tmp/homestash-ble-product/` 与 `/tmp/homestash-ble-product-build-042.log`。
- 已冻结0.4.0、0.4.1镜像、ELF、manifest：`data/hardware/freshmate-ble/release-0.4.0/`、`release-0.4.1/`。0.4.1 SHA256 `3646267fa08db5b8e18c70d1acc33cf2ed6b03849b08247a79385a9f6891be9b`，2,928,704字节。
- 稳定0.3.5回退：`data/hardware/phase1-acceptance-20261020/release-0.3.5/homestash-freshmate-0.3.5.bin`，SHA256 `6352472bc5766f65b4095a1df6ce3d7cafa08f660825613026cdafa628165797`。
- 不触碰SmartBadge原始备份，不擦除NVS/SD。临时Core固件发布指针目前可能指向0.4.1，恢复后先检查再发布新镜像。
