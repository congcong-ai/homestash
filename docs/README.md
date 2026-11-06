# HomeStash 文档

按开发板查硬件资料，按公共主题查产品、协议和部署说明。

| 入口 | 内容 | 当前状态 |
| --- | --- | --- |
| [ESP32-S31-Korvo-1 V1.1](hardware/esp32-s31-korvo-1/README.md) | 固件操作、屏幕与相机、BLE、路演、真机验收、来源审计 | 已有跑通的原型及真机记录，具体范围见板级索引 |
| [涂鸦 T5 AI 开发板](hardware/tuya-t5-ai/README.md) | 原厂数据手册、引脚图、原理图、三维模型，以及后续板级适配文档 | 已完成实验固件适配和镜像构建，真机待验 |
| [公共文档](common/README.md) | 系统架构、产品功能、设备协议、固件复用、部署和软件验收 | 两块板共用的业务与接口说明 |

## 目录约定

```text
docs/
  README.md                          文档总入口
  common/
    architecture.md                  系统架构
    project/                         整体进度与交付计划
    product/                         产品功能与使用说明
    devices/                         设备协议与后台设备管理
    firmware/                        公共固件架构与移植边界
    deployment/                      本地访问、服务器部署与配置模板
    acceptance/                      软件与产品流程验收
    evidence/                        软件验收证据
    images/                          产品与软件截图
  hardware/
    esp32-s31-korvo-1/                ESP32 原型板专属文档
      roadshow/                      路演与离线演示
      validation/                    真机测试与验收报告
      evidence/                      板级验收证据
      provenance/                    驱动来源审计与导入清单
      archive/                       早期设计与暂停记录
    tuya-t5-ai/                       涂鸦 T5 AI 板专属文档
      reference/                     原厂资料，按用途细分
```

## 阅读与维护

- 初次开发：先看[项目快速上手](../README.md#快速上手)和[公共架构](common/architecture.md)，再进入目标板目录。
- 移植 T5：先看 [T5 资料与适配状态](hardware/tuya-t5-ai/README.md)及[固件复用边界](common/firmware/portability.md)。公共接口与产品队列已分离，ESP-IDF 和 TuyaOpen 分别实现平台适配；目录入口见 [固件开发](../firmware/README.md)。
- 新增文档：板级引脚、驱动、构建、烧录和真机结果放对应板目录；产品规则、服务端和跨板协议放 `common/`。文件名统一使用英文小写与连字符，正文使用中文。
- 固件工程内的 `README.md` 继续就近说明源码和构建命令，板级文档通过链接引用；路演等独立说明已集中到对应板目录。
- 验收报告保留日期、版本、失败过程和证据。早期设计及暂停记录放在 `archive/`，其中的旧计划和旧操作状态不代表当前要求；真机结论只适用于受测板型。

本次整理于 2026-11-05。旧文档、截图和原厂附件已分类迁移；未发现内容完全相同的文件，历史报告保留独立记录。
