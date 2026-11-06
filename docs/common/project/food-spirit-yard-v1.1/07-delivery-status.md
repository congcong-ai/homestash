# V1.1 当前实施与验证状态

日期：2026-11-05。此记录说明实际完成范围，不代表完整真机产品已验收。

## 可运行入口

`pnpm dev` 沿用 preparePort，先处理本项目监听者并保护其他项目。默认 `/app` 转到 `/app/yard`，旧后台 `/app/backoffice` 保留。已修复启动器对旧首页 200 状态的假设。当前检查服务使用临时数据库 `/tmp/homestash-v11-audit/ui.sqlite`，网页 http://127.0.0.1:3300/app/yard，Core 3400、设备 3401；未对用户正式数据库进行删除测试。

## 已实施

- 语音拍照邀请形成 90 秒上下文，“好／可以／拍吧”仅确认当前有效邀请；不自动采集。语音“撤销改名”恢复上个名称。
- 小院独立 app_state 命名空间、共创与命名、家庭共享角色、配置和回忆；不创建库存事件。原后台、表结构及历史 migrations 保留。
- 许可有期限、重启撤销、一次消费；预览模拟样片明确标记。预览、重拍重新确认、放弃、保存、回看和删除通过真实 HTTP/SQLite/文件链路。文件保存先落盘，缺文件拒绝保存；100 张上限不静默丢弃旧卡片。启动清理孤立临时图片和超过一天的预览。写路由串行避免多个网页操作覆盖。
- T5 单独 food-spirit-yard 产品入口，Korvo 原 FreshMate 主循环保留。T5 页面不再展示库存主线；按键录音使用原 outbox、设备鉴权和 Core，T5 语音绕开旧库存意图。未注册旧拍照识别动作。
- T5 网络/动态播报移到工作任务；停止使会话代次失效，已过期结果不播报。支持 PCM 帧间取消；在途 HTTP 不保证立刻断开。安静模式由设备鉴权设置接口同步，最长约 30 秒；非实时控制。
- Flash 内嵌固定「我在呢」PCM，16000 Hz 单声道 16 bit，macOS Tingting 预生成，不依赖 SD/模型生成。播放适配已经交叉编译，真机音质与延迟未验证。其余倒数、失败提示语音包尚未补齐。
- ASR/TTS 独立环境选择，保留百炼，增加 local-http 固定 WAV 契约。TTS 最小配置、试听与恢复默认；内容缓存包含设备、文本、Provider、endpoint、model、voice、转换版本；最多 50 条/20 MB。云端速度参数不冒充支持。
- Provider 分段日志、Core ASR/业务/TTS 日志与三类短句探针 `pnpm exec tsx scripts/voice/measure-tts.ts`。探针会真实调用当前配置，输出完整合成时长，不代表板端首音。

## 验证证据

全量 `pnpm test` 共 111 项通过；`pnpm typecheck`、`pnpm lint`、`pnpm build` 的实际日志在 `/tmp/homestash-v11-audit/`，最终 delivery 日志记录 typecheck、lint、build 均通过。旧备份曾误把 product:food-spirit-yard:v1 当作条码资料，现已明确排除此产品记录；小院照片目前不包含在旧库存备份中，需单独保留其媒体目录与数据库。lint 排除仓库忽略的第三方 SDK/toolchains，未修改第三方源码。

浏览器实际执行共创、改名、明确答应、模拟预览、确认保存、回看和删除；390/320/480 宽度无横向溢出，页面异常零。截图在 evidence；480 是浏览器宽度检查，不是 T5 画布或显示真机证据。模拟样片文字明确说明不是相机拍摄。

T5 构建命令：

```sh
HOMESTASH_TUYAOPEN_PATH=/tmp/homestash-tuyaopen-v1.5.0 HOMESTASH_TUYAOPEN_PYTHON=/tmp/homestash-tuya-venv/bin/python pnpm hardware:build:generic --board tuya-t5-ai
```

锁定 TuyaOpen/T5AI 提交由脚本校验。1.1.0 通用 QIO/UA/UG 镜像在 `data/hardware/builds/tuya-t5-ai/food-spirit-yard-1.1.0/`，摘要在 evidence/firmware-sha256.txt；未刷写，不能将旧 0.6.4 真机结果继承到新镜像。原厂链接器仍报告 RWX LOAD、newlib syscall stub 警告，镜像构建成功不代表外设通过。

## 真实阻断与未完成项

| 项目 | 已核对事实与下一步 |
|---|---|
| 门事件 | 平台无已验证门驱动。状态机主机回归覆盖冷却、7 秒超时、取消代次；尚未连接真实门输入。归档 V1.02 主板四页原理图未找到可确认的 IMU 芯片；需要用户实物扩展模块丝印、总线接线、安装方向，再读芯片 ID、标定和去抖。不能称真实开门完成。 |
| 自然接话 | 当前可用软件路径是按键采录；7 秒上限不是已验证 VAD。开门短监听、无回应不上传、自回声仲裁未完成；本地唤醒仍未移植。 |
| 摄像头 | 当前无模组，hs_camera 仍明确不支持。锁定 SDK 的 tuya_t5ai_ex_module.c 有 GC2145 DVP 注册；SDK 配置使用 I2C0 GPIO13/15、复位 GPIO51，触摸也用 GPIO13/15。候选仅限匹配原厂 V1.02 DVP 引出与 GC2145 驱动的模组；必须核对引脚顺序、连接器、模组所需各路电压、复位极性、时钟、I2C 地址与屏幕并发。当前不具备精确采购料号证据，不建议盲买通用 FPC 模组。没有采购或接线。 |
| 设备照片协议 | Web 模拟预览/保存已经通，但真实设备 JPEG 上传与拍摄倒数尚未接通；旧 images 识别接口不作为替代。缺件后仍需新增真实采集与独立上传联调。 |
| 声纹 | 现有 ASR 返回 string，当前 Core/设备协议没有真实 speaker/member ID。未录入两名成员、未验证 PID/官方授权；身份一律未知，不沿用上一人。 |
| TTS 实测 | 当前环境 ASR/TTS disabled，无 AI_API_KEY、LOCAL_TTS_URL。实际本地 HTTP fixture 验证成功、坏 WAV、超时、取消、音色 cacheKey；这是 adapter 测试，不是本地模型或云端模型性能。未下载模型，未调用收费 Provider，不能定位线上耗时占比。 |
| 流式 | Provider/Core/T5 仍整句固定 WAV，不是端到端流式；没有板端首音或动态响应优化前后对照。 |
| 其余主线 | 文化来源互动、完整固定提示包、设备 480×320 实机与位置/两人入镜验收尚未完成。 |

因此，本轮已经有可运行的增量代码和构建证据，但 V1.1 全部必做项尚未交齐。不能把外设缺件作为上述纯软件未完成项的原因。长期记忆、完整相册、原 P2、精准库存不在本次实现中。
