# 参与 HomeStash 开发

- 所有产品文案和文档使用中文；平台称 HomeStash、目录 homestash，首款产品称 FreshMate。
- 从[文档总入口](docs/README.md)阅读[公共架构](docs/common/architecture.md)，再看目标板文档。早期 Korvo V2 设计保存在 ESP32 板目录的 archive/ 中；用户最新补充优先。
- SmartBadge 始终只读。固件代码迁移先记录审计、来源、许可证、版本和改动，不能复制凭据。
- 使用 pnpm；通过根目录 pnpm dev 先清端口后启动。不要引入本地 Docker。
- Domain 不能依赖 UI、SQL、板型或 AI 厂商。AI 输出必须通过 schema 和 Domain 校验。
- 数据库变更新增 migration，不修改已经执行的历史迁移；同步更新 runner。
- 真实密钥只存忽略配置。不要提交 .env、数据库、设备备份、BIN/ELF 或含凭据的 sdkconfig。
- 变更后运行 lint、typecheck、test、build。测试数据放临时目录；明确 Mock、软件验证和真板验证的区别。
- 当前已有 Korvo 真机原型，T5 处于资料准备阶段；进度以各板索引和验收日期为准。按用户指定范围推进，不自动创建 GitHub PR；GitHub 写操作仅允许用户约定的 git push。

## 固件恢复测试依赖

`pnpm test` 会用系统 `cc` 直接编译并执行录音 outbox 的实际 C 代码。macOS 需要 Xcode Command Line Tools；Linux 需要 C11/POSIX 工具链。测试文件和可执行文件都放在系统临时目录，结束后清理。ESP-IDF 构建仍通过 `pnpm hardware:build` 独立验证。
