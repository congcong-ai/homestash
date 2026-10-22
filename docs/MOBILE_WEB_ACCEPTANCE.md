# 手机 Web 模拟验收

2026-10-22，按用户要求跳过手持真机，使用本机 Chrome 155.0.8059.85、Playwright 1.64.1 的移动视口与触屏模拟，访问真实 HTTP 局域网入口。全部写入都在独立临时 SQLite、Mock Provider 和测试凭据中完成，没有修改日常库存或固件。

## 发现与修复

- HTTP 私有IP页面不是安全上下文，浏览器没有 `crypto.randomUUID()`。实际操作复现加入清单报错，库存调整、入库、烹饪等多个入口也直接依赖它。客户端现在统一使用 `createRequestId`：优先原生UUID，否则用 `crypto.getRandomValues` 生成UUID v4；没有安全随机数时明确拒绝，不使用弱随机数。不改服务端协议、幂等键或重试规则。
- 320像素库存筛选与操作行不换行，按钮挤成竖排，并曾把页面撑至354像素。窄屏操作行改为换行、按钮文字保持横排，标题可折行。
- 文件选择框的固有最小宽度把拍照、条码和设置页撑至351像素。显式限制文件输入宽度，上传区使用可收缩网格；没有通过隐藏页面溢出来遮挡内容。
- 晚餐想法误用了人数输入框的65像素宽度；现在分别设置人数与文字输入宽度。

校验不能只比较 `scrollWidth` 和 `innerWidth`：模拟手机可能在内容溢出时自动扩大布局视口并缩放。脚本现在等待页面标题、网络请求、字体和渲染稳定，同时要求布局视口和页面宽度都不超过实际设定的屏幕宽度。

## 验收范围与结果

- 320、360、390、430、768、1280像素下，今日、库存、添加、待确认、图片、条码、食谱、购物、模拟设备和设置共60个页面宽度组合。
- 4种手机宽度登录页；320/390下实际入库和库存操作表单；390下烹饪状态。
- 错误密码被拒，正确登录成功；退出后API匿名401，密码不预填。
- 加入2瓶牛奶、标记已买、按实际3瓶核对入库、设置日期并在临期筛选中找到新批次。
- 消耗1瓶变为2瓶，填写原因纠正后恢复3瓶并保留事件。
- HTTP文字录入番茄和鸡蛋，开始番茄炒蛋、下一步、刷新后仍保留第2步。

最终74项浏览器检查通过，57项软件测试、lint、typecheck与build均通过；未发生页面脚本异常。逐项测量以 [浏览器结构化记录](product-evidence/mobile-web-browser-20261022.json) 为准。截图在 [手机截图目录](images/mobile-web-20261022/)。软件回归57项、lint、typecheck和build的最终检查结果也记录于该文件。

这证明了Chrome中的手机尺寸交互与HTTP软件链路，不代表iOS Safari、Android厂商浏览器、软键盘遮挡、实体摄像头或手持真机验收。未开启浏览器麦克风、不做PWA离线写入承诺，未调用真实外部模型。

## 重复执行

仓库提供 `pnpm test:mobile`，需要本机安装Chrome及 `pnpm install --frozen-lockfile`。脚本只接受系统临时目录里的测试凭据；登录后检查库存、购物和烹饪均为空，且Provider为Mock，满足后才写测试数据。不要将日常服务和日常凭据用于此脚本；每次完整验收建立新的临时库。

先检查3380、3381、3382端口，再在第一终端启动：

```sh
HOMESTASH_MOBILE_TEST_DIR=$(mktemp -d)
DATABASE_PATH="$HOMESTASH_MOBILE_TEST_DIR/core.db" \
HOMESTASH_LAN_DIR="$HOMESTASH_MOBILE_TEST_DIR/lan" \
HOMESTASH_NEXT_DIST_DIR=.next/mobile-validation \
INTERNAL_LOGIN_ENABLED=false NODE_ENV=development \
WEB_PORT=3380 CORE_PORT=3381 DEVICE_PORT=3382 \
DEVICE_HOST=127.0.0.1 DEVICE_TOKEN= AI_API_KEY= \
AI_PROVIDER=mock SPEECH_PROVIDER= pnpm dev:lan
```

第二终端使用启动日志中的实际地址和临时目录，替换下列参数：

```sh
pnpm test:mobile \
  --url http://实际私有IP:实际网页端口 \
  --credentials /系统临时目录/lan/access.txt \
  --output /系统临时目录/artifacts
```

输出为逐项JSON与截图，不记录密码、会话Cookie或包含登录请求的网络trace。完成后Ctrl+C停止临时服务；Next自动追加的临时类型目录不应提交Git。日常手机入口仍为 `pnpm dev:lan`，电脑换网络后重新启动，使用新的实际地址。
