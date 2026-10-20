# 条码入库

2026-10-20。补齐通用家庭物品录入入口，不依赖 Korvo、微信或新增硬件。商品查询与 AI Provider 分离，模型不编造条码商品，也不直接修改数据库。

## 使用

1. 在本地厨房打开“条码入库”，输入包装上的数字，或使用键盘式扫码枪。
2. 点击“查询商品”。先查本地已确认的商品记录；默认不访问外部商品服务。
3. 核对名称、七类物品分类、数量、单位、位置和日期。查不到也可以手动填写，或改用拍照入库。
4. 点击“确认添加这件物品”后才经 Inventory Service 创建库存与事件。取消不会改变库存。
5. 下次查询同一条码会预填本地确认过的名称与分类；数量、单位、位置和日期仍按本次实物核对，不继承旧批次日期或剩余数量。“再添加一批同款”会建立新的确认流程，不覆盖旧批次。

支持带校验位的 GTIN-8、UPC-A/GTIN-12、EAN-13、GTIN-14，保留前导零。等价的 UPC/EAN 用统一14位键查询本地商品；输入不是商品条码、校验错误或二维码链接时拒绝查询。

“拍条码照片”使用浏览器原生 `BarcodeDetector` 在本机读码，照片不上传给商品库或模型。这是渐进增强，浏览器不支持或未读到有效条码时会提示手动输入；没有宣称所有手机浏览器都能拍照扫码。

## 可选外部商品库

默认配置：

```env
PRODUCT_LOOKUP_PROVIDER=local
```

如需启用 Open Food Facts，在 Core 的 `.env` 中显式设置并重启服务：

```env
PRODUCT_LOOKUP_PROVIDER=open-food-facts
```

本地未命中时才请求固定的 Open Food Facts HTTPS 地址；仅发送条码和应用标识，不发送家庭库存、图片、录音或模型 Key。每实例请求间隔至少1秒，连接超时8秒。外部库不是国内全品类商品库；只返回食品候选，不根据条码推断药品用法、健康状况或保存期限。

外部响应缺失可手动填写；网络失败、限流、返回错码或非法结构不会伪造成功，也不会改变库存。查询失败可重试，或将 Provider 改回 `local` 后使用本地流程。包装规格只作文字参考，不自动换算本次购买数量。

适配器依据 [Open Food Facts 官方查询接口](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v2/products/get-product-by-code/)，保留来源链接。外部数据遵循 [Open Food Facts 的 ODbL 使用条件](https://support.openfoodfacts.org/help/en-gb/12-donnees-api/94-y-a-t-il-des-conditions-pour-utiliser-l-api)，不将第三方数据宣称为本项目 MIT 自有数据。

## 接口与持久化

- `GET /api/intake/barcodes`：当前外部查询模式和最近20次查询。
- `POST /api/intake/barcodes`：`requestId`、`barcode`，保存待确认结果；不创建库存。
- `POST /api/intake/barcodes/:id/confirm`：`requestId`、明确的 `item`，数量必须大于0且单位必填。
- `POST /api/intake/barcodes/:id/cancel`：取消待确认记录。

复用现有 SQLite Repository 的 `app_state` 保存查询、商品基础资料和幂等回执，无需改表或修改历史 migration。确认、库存事件、本地商品记录和回执在同一事务内提交；同请求重放、同查询重复确认不会重复入库，改内容重放会拒绝。新批次必须建立新查询。

入库来源为 `barcode`，metadata 记录条码、查询ID和候选来源。用户不能通过提交自定义 metadata 覆盖真实的条码来源记录。原包装规格不作为保质期依据，不自动设置日期。

## 本轮验证

- 自动检查35项通过，其中条码专项3项：校验位与前导零、查询/确认/取消/幂等/跨重启/事务失败、外部接口返回缺失/错码/429/网络失败。
- lint、typecheck、生产构建通过。测试使用临时数据库，不改日常库存。
- 真实外部适配器查询一个公开示例条码成功；该单样本仅验证接口联通，不代表商品资料准确或国内覆盖率。
- 隔离的3001/3103浏览器测试：查无商品、手动填写日用品“测试纸巾”2包、明确确认入库、再次查询预填名称/分类且数量留空均通过。
- 手机实物照片读码、实体扫码枪输入尚未验收；输入路径已实现，不以桌面数字输入代替这些硬件结果。
- 没有重刷开发板，没有修改 SmartBadge，也没有重启另一会话正在使用的正常 Core。
