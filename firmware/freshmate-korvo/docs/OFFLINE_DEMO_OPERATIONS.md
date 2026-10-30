# 小冰离线演示操作卡

上电进入模式选择主页；选择“进入演示馆”为离线按键演示，无需 Wi-Fi、手机、后台或 SD 卡音频。预置语音保存在固件内；六个场景永久保留。首页按 SET 才进入正常产品，正常产品长按 PLAY 可重新打开演示（请先结束录音或上传）。

板上标为 MODE 的键就是本文的 PLAY；这是 BSP ADC 按键，不是独立 GPIO。

1. 首页点击紫色“进入演示馆”按钮，或短按 PLAY（MODE）进入。正常产品首页也支持这两种入口，打开模式选择入口，再选择离线演示；正常产品其它页面 MODE 仍为拍照。
2. 点击 LCD 场景卡选择 01–06；VOL+ / VOL−统一调节音量。
3. 按屏幕台词说话，然后轻按 PLAY 触发小冰预置回答。没有语音识别或真实唤醒。
4. 02、03 使用 SET 模拟开门，2.5 秒后生成关门事件；03 本场第 4 次开门播放吐槽。播放期间重复按键忽略；开门场景还需等待至少 2.5 秒后再按 SET。
5. 实体 VOL 在所有页面调整播放音量，播报中可用并显示百分比，重启保留。长按 PLAY 返回列表；列表再长按返回主页。
6. 完成后 PLAY 重来；触屏“重来”也可从头开始。“返回”可随时打断播放。
7. 六号是模拟电量小饼干告急，不读取真实电池电量。断电后计数清零，不更改真实库存。

所有页面标注预设脚本。语音由百炼 Qwen3-TTS 的 Momo 音色预生成，不人为升调。固件存储单声道 16 kHz IMA ADPCM，播放时解码为 16 bit PCM 并复制为双声道。原始试听 WAV 在 `firmware/freshmate-korvo/assets/audio/`，脚本和台词在组件的 `scenes.json`。重新生成：先运行 `pnpm exec tsx scripts/hardware/generate-demo-voices.ts --voice Momo`，再运行 `python3 scripts/hardware/generate-demo-audio.py --source-dir data/hardware/voice-build/Momo`，然后 `node scripts/hardware/font.mjs`。语音服务和 API Key 仅开发机生成配音时需要，固件离线播放不需要。

## 构建、刷机与恢复

仓库根目录运行 `pnpm hardware:build`。使用共享 ESP-IDF SDK，不修改 SmartBadge 工程。刷机工具核验 USB 序列号、MAC 和本地完整 Flash 备份。由于当前分区含 OTA 初始化区，明确提供完整回退备份：

```sh
~/.espressif/python_env/idf6.2_py3.12_env/bin/python scripts/hardware/flash.py \
  --backup data/hardware/backups/homestash-20261027/manifest.json \
  --migration-backup data/hardware/backups/homestash-20261027/manifest.json
```

此工具会初始化 OTA 选择区并启动 factory。备份与镜像均含本机配置，不应公开发布。恢复旧固件用 `pnpm hardware:restore`。

UART 115200 调试命令：`demo-next` 对应 PLAY，`demo-door` 对应 SET，`demo-up` / `demo-down` 对应列表选择或音量，`demo-back` 返回，`status` 查询状态。它们与按键进入相同队列，不伪造音频输出。硬件验收脚本：`scripts/hardware/test-offline-demo.py`。

本操作卡仅覆盖离线按键演示。当前固件在演示前初始化网络与本地 WakeNet/MultiNet 模型，再暂停 Wi-Fi；打开全局设置时临时恢复网络以便选网。语音演示与真实产品的当前行为及未验收范围见[路演说明](ROADSHOW.md)。
