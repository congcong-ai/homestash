# 本地接话验收与云语音配置

2026-11-06。用户按主屏接话进入录音，再点击停止，明确回复“可以”；本地接话、录音退出与停止交互真机通过。用户回复未逐项区分提示音、屏幕和音量，不据此虚构录音波形质量或识别结果。

当时服务配置为ASR未配置、TTS disabled、无云端Key或local-http URL，不能把本地动作通过写成真实识别/合成通过。下一步通过本机隐藏输入框配置已有百炼Key，取消则不修改环境文件。密钥仅保存Git忽略.env且0600，不输出聊天/日志。

## 百炼Provider真实联调

用户通过本机隐藏输入框填写Key，.env验证0600且被Git忽略，未输出密钥。重启pnpm dev，独立ASR_PROVIDER/TTS_PROVIDER为bailian，小院原持久化disabled配置经正式PATCH切换为bailian。

真实TTS“我在呢。”：模型qwen3-tts-flash、音色Momo；合成540ms、下载271ms、转换111ms，总计约923ms，33324字节PCM WAV。将该合成WAV发给真实ASR，约371ms识别为“我在呢。”。这是合成样本的Provider联调，不是真机麦克风或端到端首音测量。输出暂存在/tmp/homestash-rehearsal，不作为真实家庭录音提交。下一步由用户主动按接话录入短句，验证真实麦克风、Core业务与设备播放。
