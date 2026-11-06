/** 按当前服务端配置测量整句合成；不声称该值是板端首音。会真实调用已配置的 Provider。 */
import "dotenv/config";
import { speechFromEnv, validateWav } from "@homestash/ai/speech";
import { randomUUID } from "node:crypto";
const provider =
  process.env.TTS_PROVIDER ?? process.env.SPEECH_PROVIDER ?? "disabled";
if (provider === "disabled")
  throw Error("未配置 TTS_PROVIDER，未发起外部调用。");
const speech = speechFromEnv();
for (const text of [
  "我在呢。",
  "以后就叫莓老板啦。",
  "要不要和莓老板留张合影？",
]) {
  const start = performance.now(),
    requestId = randomUUID();
  try {
    const wav = await speech.synthesize(text, { requestId });
    validateWav(wav);
    console.log(
      JSON.stringify({
        requestId,
        provider,
        characters: text.length,
        cache: "未使用设备缓存",
        completeMs: Math.round(performance.now() - start),
        bytes: wav.length,
        deviceFirstSound: "未测",
        streaming: false,
      }),
    );
  } catch {
    console.log(
      JSON.stringify({
        requestId,
        provider,
        status: "合成失败",
        elapsedMs: Math.round(performance.now() - start),
      }),
    );
    process.exitCode = 1;
  }
}
