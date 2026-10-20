# Korvo BLE 专项诊断固件

只提供临时 BLE GATT 服务，测试内容为固定字符串和随机测试数据。不含家庭数据、Wi-Fi 配置或模型 Key。不会擦除 NVS；仍会按 ESP-IDF 的正常行为初始化 NVS/PHY。

该固件会临时替换 FreshMate 应用，LCD 不显示 FreshMate 页面。验收后应恢复原应用；不得把它作为产品固件发布。

## 依赖准备

使用本项目已审计的 ESP-IDF `ab95e70748f2eddac6f87217b0cf62533684a6ba`。蓝牙组件复制至 HomeStash 忽略目录，补齐该 SDK 指定的控制器子模块，不修改共享 SDK：

```bash
mkdir -p data/hardware/retest-20261019/bt-components
cp -R /Users/peter/esp/esp-idf-smartbadge/components/bt data/hardware/retest-20261019/bt-components/
curl -fL --max-time 90 \
  https://codeload.github.com/espressif/esp32s31-bt-lib/tar.gz/cc027ecd288b31198f82331faabb972a37d6800e \
  -o data/hardware/retest-20261019/bt-lib.tar.gz
tar -xzf data/hardware/retest-20261019/bt-lib.tar.gz --strip-components=1 \
  -C data/hardware/retest-20261019/bt-components/bt/controller/lib_esp32s31/esp32s31-bt-lib
export IDF_SKIP_CHECK_SUBMODULES=1
export PATH=/Users/peter/.espressif/python_env/idf6.2_py3.12_env/bin:$PATH
source /Users/peter/esp/esp-idf-smartbadge/export.sh
cd firmware/diagnostics/korvo-radio
idf.py -j 4 build
```

已有缓存时不重复执行复制步骤，以免生成嵌套目录。库来自 Espressif 官方锁定提交；原厂源码许可保留于复制组件和控制器库中。蓝牙缓存不提交 Git。

## 安全刷写

先验证 USB serial 和 MAC，验证原始 16 MB 工牌备份哈希；再读回当前应用并与回退文件核对。当前分区表与 FreshMate 完全相同；只写 `0x10000` 应用区，不刷分区表、引导程序，不擦 NVS、SD 或整片 Flash。实验刷写和恢复脚本保存在本机 `data/hardware/retest-20261019/flash-probe.py`，它包含固定目标和本次回退哈希，不用于其它开发板。

必须保留当前可运行镜像，保持供电，待 esptool 完成哈希校验。具体结果见项目 `docs/KORVO_HARDWARE_TEST_STATUS.md`。

## Mac 客户端

从仓库根目录运行：

```bash
swiftc scripts/hardware/probe-ble.swift -o data/hardware/retest-20261019/probe-ble
data/hardware/retest-20261019/probe-ble
```

客户端扫描 `FFF0` 服务和 `HomeStash-Probe` 名称，连接并读取 `FFF1` 特征的初值，然后写入一次随机测试串并读回校验。超时或不一致返回非零退出码。Mac 需要蓝牙处于开启且已授权状态。

本实验不证明经典蓝牙、蓝牙音频、配网业务、加密配对、吞吐量、远距离性能或 Wi-Fi/蓝牙共存通过。
