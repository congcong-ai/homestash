# Korvo板级适配

hs_board.c提供真实板型、能力和按键映射。SET/MODE映射为通用业务事件；引脚、GPIO、I²C/I²S及驱动创建仍由只读原厂BSP提供，不凭网络资料猜测。

产品循环在../../../apps/freshmate_app，公共契约在../../../common/components/device_port。新增板型应实现同一契约和独立构建目标，不能复制产品循环。完整路径与边界见仓库docs/FIRMWARE_PORTABILITY.md。
