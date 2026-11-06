# 公共文档

这里保存与具体开发板无关的产品、服务端和接口说明。板级操作与验收请到 [ESP32 Korvo](../hardware/esp32-s31-korvo-1/README.md)或[涂鸦 T5 AI](../hardware/tuya-t5-ai/README.md)。

## 架构与进度

- [系统架构与实现边界](architecture.md)
- [整体功能进度与历史记录](project/build-status.md)
- [大功能交付计划](project/feature-delivery-plan.md)
- [固件复用与多板适配](firmware/portability.md)：包含现有 ESP-IDF 依赖和跨平台移植限制。

## 设备与协议

- [设备协议](devices/protocol.md)：模拟事件与真实设备媒体接口。
- [后台设备管理](devices/management.md)：设备身份、凭据、能力和按板型发布固件。

LCD、BLE 配网、分区布局与具体刷写方式见各板目录。Korvo 的 OTA 经验不能直接作为 T5 的实施方案。

## 产品功能

| 主题 | 文档 |
| --- | --- |
| 图片、条码与订单入库 | [图片入库](product/image-intake.md) · [条码入库](product/barcode-intake.md) · [订单截图](product/order-screenshot-intake.md) · [分批收货](product/order-partial-receiving.md) |
| 采购与待确认 | [采购与待确认](product/shopping-and-review.md) · [采购到入库闭环](product/purchase-to-stock.md) |
| 库存与提醒 | [批次与操作纠正](product/inventory-batches-and-corrections.md) · [位置与日期规则](product/household-locations-and-dates.md) · [家庭时区](product/household-calendar.md) |
| 做饭 | [语音烹饪模式](product/cooking-mode.md) |
| 数据与断网查询 | [数据备份与恢复](product/data-backup-and-restore.md) · [离线只读副本](product/offline-readonly.md) |

## 运行与部署

- [手机局域网访问](deployment/local-mobile-access.md)
- [服务器部署](deployment/server.md)
- [Nginx 配置模板](deployment/nginx.conf.template)：安装和发布脚本使用此文件，移动时需同步脚本路径。

## 软件验收与证据

| 报告 | 记录范围 |
| --- | --- |
| [Phase 0 验收](acceptance/phase-0.md) | 2026-10-17 的初始软件与模拟器基线 |
| [日常完整流程](acceptance/daily-workflow.md) | 采购、库存、做饭、消耗与恢复 |
| [手机 Web 模拟验收](acceptance/mobile-web.md) | 浏览器触屏与尺寸仿真，实体手机范围另列 |
| [Local Mode 阶段验收](acceptance/local-mode.md) | 2026-10-27 软件阶段收口，包括只读离线查询 |

[结构化证据](evidence/)和[截图](images/)按日期保留。报告中的“当前”“未实现”以各报告日期为准；后续增量见[整体进度](project/build-status.md)及相应功能文档。

[返回文档总入口](../README.md)
