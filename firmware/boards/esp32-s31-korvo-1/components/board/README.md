# Korvo 板级适配

本组件提供板型、硬件能力、按键映射；ESP-IDF 运行时位于平台层的 `runtime` 组件。产品主循环位于 `firmware/apps/freshmate`，公共接口位于 `firmware/shared/components/device_port`。不能在这里复制产品业务；目录和移植规则见 [固件入口](../../../../README.md)。
