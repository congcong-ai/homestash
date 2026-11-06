# 涂鸦 T5 AI 板卡工程

目标名 `tuya-t5-ai`，板型 ID `tuya-t5-ai-board-v1.02`。使用 TuyaOpen，复用 `apps/freshmate` 主循环及公共录音队列。当前配置面向原厂 V1.02 主板和 3.5 英寸 320×480 RGB565 触摸屏；用户已确认接有屏幕，屏幕具体型号仍需与实物核对。其他型号需单独增加配置，不能仅因都叫 T5 就烧录。

## SDK 准备

锁定版本在 [targets.json](../../targets.json)。推荐将 SDK 放到仓库 Git 忽略的 `data/hardware/sdk/tuyaopen`，不要加入 `vendor`。在仓库根目录执行：

```sh
mkdir -p data/hardware/sdk
git clone --branch v1.5.0 https://github.com/tuya/TuyaOpen.git data/hardware/sdk/tuyaopen
git -C data/hardware/sdk/tuyaopen checkout e92da87549fa1a2e079584fb12a4493e6bbbd863
git -C data/hardware/sdk/tuyaopen submodule update --init
```

按 [TuyaOpen 官方环境说明](https://tuyaopen.ai/zh/docs/quick-start/enviroment-setup) 安装 Python 虚拟环境。首次配置时可运行 SDK 的 `export.sh`。平台代码应位于 SDK 的 `platform/T5AI`：

```sh
git clone https://github.com/tuya/TuyaOpen-T5AI.git data/hardware/sdk/tuyaopen/platform/T5AI
git -C data/hardware/sdk/tuyaopen/platform/T5AI checkout 046792bf3443b62994b6d4bc795fcbf42b305eb5
export HOMESTASH_TUYAOPEN_PATH="$PWD/data/hardware/sdk/tuyaopen"
# 如果使用其他虚拟环境，可显式指定其中的 Python。
# export HOMESTASH_TUYAOPEN_PYTHON="/绝对路径/venv/bin/python"
pnpm hardware:build:generic --board tuya-t5-ai
```

构建脚本核对两个 SDK 提交，再调用原厂 `tos.py build`。原厂工具会按宿主系统准备交叉工具链；首次缺少原生配置时会先编译 `diagnostics/tuya-t5-bsp`，再构建产品工程。本地开发不使用 Docker。产物位于本目录 `.build/bin/`，实际命名由 TuyaOpen 配置决定。

## 配置与联网

复制 `config.example.json` 为同目录 `config.local.json`，填写 Core 的设备接口地址、在设备管理中登记的设备 ID/独立 Token、Wi-Fi 名称和密码。设备登记时板型须填写上述 T5 ID。配置文件已被 Git 忽略。

```sh
pnpm hardware:build --board tuya-t5-ai
```

普通构建会将配置嵌入镜像；通用构建始终忽略本地凭据。HTTPS 需在 JSON 中增加 `caCertificate` 字段并填写 PEM CA，适配器不跳过证书验证。开发时可使用可信局域网中的 HTTP Core 地址，默认端口 3101。

串口命令沿用共用应用协议：`wifi-connect {"ssid":"网络名称","password":"密码","remember":true}`、`core-config {"url":"http://电脑地址:3101","deviceId":"t5-kitchen","token":"设备Token"}`、`wifi-status`、`record`、`screen 0` 至 `screen 5`。应用不将密码和 Token 写入日志。当前实物 UART0 对应双串口的 `...1191`（115200 8N1 产品命令），原厂 UART1 日志对应 `...1193`（460800）；序列号和端口名会随板卡变化。从 0.6.4 起默认横放：物理 320×480 屏幕通过原厂旋转缓冲区以 480×320 显示，触摸同步转换；布局仍按逻辑分辨率生成。

## 功能范围

- 已实现源码适配：Wi-Fi、Core 鉴权/心跳、六类页面拉取、屏幕触摸导航、按键录音、WAV 上传及回复播放、SD 录音队列。
- 麦克风、扬声器和按键使用锁定版本的原厂接口；按键 GPIO12，功放 GPIO28，来自原厂 BSP。
- 从 0.6.1 起，SD 数据位于 `/sdcard/homestash-t5`，与 ESP32 的 `/sdcard/homestash` 隔离。保留原卡上的 `badge` 和 `homestash`，不要用旧 T5 0.6.0 在共用卡上启动。
- 未确认存储卡时仅运行联网和屏幕。只有成功挂载 SD 后才开放录音；不格式化存储，不自动改用不明容量的 Flash。
- 相机、HomeStash BLE 配网、OTA、休眠实验、本地唤醒词和 Korvo 路演演示馆尚未移植，操作明确拒绝或不启用。屏幕设置暂使用串口配置入口。
- 当前 Core 固件发布校验仅支持 ESP 镜像；T5 不上报 OTA 能力，也不能上传到现有 ESP 发布流程。

烧录使用 [TuyaOpen 原厂工具](https://tuyaopen.ai/zh/docs/quick-start/firmware-burning)。本项目 `flash.py`、`restore.py` 及 Korvo 备份仅适用于 ESP32；不要用于 T5。真机测试与实际状态见 [适配记录](../../../docs/hardware/tuya-t5-ai/bring-up.md)。

## 当前基础真机版本

2026-11-05，0.6.4 通用镜像已实际烧录并逐字节回读核对。用户确认横屏中文显示、六个导航按钮与触摸切页正常；CLI 确认串口状态命令、未联网状态和无卡禁止录音。Wi-Fi、Core 业务、板端 SD 及音频闭环未验，按用户要求留到后续。归档见仓库 `data/hardware/builds/tuya-t5-ai/tuya-t5-ai-0.6.4-20261105`，原始代码快照、固件、日志和清单均已保存。
