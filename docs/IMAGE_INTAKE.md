# 图片识别与确认入库

2026-10-19。已完成 Web 图片入口和可审核入库流程；Korvo 二进制拍照入口见 [相机说明](KORVO_CAMERA.md)，真机验收边界单独记录。

## 操作

运行 `pnpm dev`，访问 http://127.0.0.1:3000/app ，选择“拍照入库”。

1. 选择 JPEG、PNG 或 WebP 的物品照片、包装图或购物小票。
2. 点击“识别图片”。图片会发送至用户配置的 AI 服务，库存保持不变。
3. 对照原图检查候选及识别依据，可以修改名称、类别、数量、单位、位置、建议日期和到期日期；不需要的候选取消勾选。
4. 点击“确认添加所选物品”，只有被选中的条目才进入 InventoryService 和 SQLite，并创建库存事件。
5. 不准备入库时点击“取消这次识别”，库存不变。

数量或单位不明确时不会用“1个”填补未知信息。模型自评较明确且数量/单位齐全的候选默认勾选；不确定项默认不勾选，选中后必须补齐数量和单位。日期没有明确依据时保持空白，不用照片中的生产日期推算到期日期。模型的把握程度不是准确率保证。

最近20次识别结果可从页面重新读取，待确认结果可以继续核对。**未提交的编辑只在当前页面保存**；离开页面后恢复原始识别候选。默认不在服务器保留原图（显式硬件调试留样除外），因此恢复候选时需对照用户自己保留的图片。

## 模型配置

沿用 Core 的 `AI_BASE_URL` 和 `AI_API_KEY`；在 `.env` 设置 `AI_VISION_MODEL=qwen3-vl-plus`。设置页须选择外部 OpenAI-compatible Provider。视觉模型与文本模型分别配置，Key 只在 Core 使用，不传给浏览器或固件。

Mock 模式没有虚构的图片识别结果；会明确提示需要配置视觉模型。云端失败或返回非法结构时不写入库存。依据为百炼官方 [视觉兼容接口](https://help.aliyun.com/en/model-studio/qwen-vl-compatible-with-openai) 与 [JSON 结构化输出](https://help.aliyun.com/en/model-studio/qwen-structured-output)，具体配置已通过真实调用验证。

## 数据和协议

浏览器接受最大20 MB源图片；超过3 MB时在浏览器压缩，上传内容限制3 MB。Core 校验允许的 MIME、文件头、大小及 PNG 尺寸，只接收上传内容，不抓取用户提供的远程图片 URL。

- `POST /api/intake/images`：`requestId` 和 `dataUrl`；返回 `pending` 候选。
- `GET /api/intake/images`：最近20次识别记录。
- `POST /api/intake/images/:id/confirm`：`requestId`、所选 `candidateId` 与用户确认后的 `ItemInput`。
- `POST /api/intake/images/:id/cancel`：取消未入库的识别。

Web 上传使用有上限的 Base64 JSON；Korvo 使用独立认证的 JPEG 二进制端点，复用同一候选和确认逻辑。按 MODE 拍照后，可在本页点击“刷新设备照片”读取候选。

SQLite 现有 `app_state` 保存候选、依据、图片摘要与确认结果；不保存图片字节，没有修改历史 migration。图片和小票当前统一使用 `camera` 来源，并通过 `metadata.imageIntake` 关联识别记录、原候选、依据和模型自评；尚未实现 SKU、价格和订单对账。

确认操作将新库存、库存事件、确认状态及回执原子提交。相同内容重试、换请求 ID 重复确认或重启后重放不会重复入库；已确认记录不能改成另一份内容再次提交。批量任何一项失败则全部回滚，原候选保留供重试。

## 验证边界

- 新增自动测试覆盖：仅识别不入库、编辑后确认、候选 ID 校验、取消、跨重启与并发重放、批量失败回滚、无效图片、Mock 拒绝及真实 HTTP 视觉协议。
- 真实百炼使用**合成测试小票**，识别出番茄2个、鸡蛋10个、草莓1盒；临时数据库完成确认，重试后仍只保留三项库存。
- 浏览器实际验证上传、真实识别、数量修改、取消勾选、离开后恢复原始候选和取消。浏览器验收没有点击日常库入库；日常库存及事件完整数据保持不变。
- Korvo SC101IOT 已真实抓图、JPEG解码并上传成功，见 CAMERA_RETEST_REPORT.md；手机相机、复杂真实购物小票及真实食品识别准确性仍未全面验收，不以合成小票或零候选照片替代这些场景。

可复验命令：`pnpm exec tsx scripts/hardware/probe-image-intake.ts /绝对路径/图片.png`。它会真实发送指定图片到配置的视觉模型，结果与临时数据库位于系统临时目录；不写日常库存，会产生模型调用量。

证据见 `product-evidence/image-intake-20261019.json`。
