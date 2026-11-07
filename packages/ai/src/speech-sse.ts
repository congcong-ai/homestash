// 百炼Qwen-TTS的SSE音频为24kHz、单声道s16le；完整终止事件前不交付缓存。
export async function collectTtsSse(
  response: Response,
  onFirst: () => void = () => {},
) {
  if (!response.ok || !response.body) throw Error("TTS流响应失败");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    wire = 0,
    size = 0,
    done = false;
  const audio: Buffer[] = [];
  const line = (value: string) => {
    if (!value.startsWith("data:")) return;
    const data = value.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (event.code || (event.status_code && event.status_code !== 200))
      throw Error("TTS流返回错误");
    const chunk = event.output?.audio?.data;
    if (chunk) {
      if (typeof chunk !== "string" || !/^[-A-Za-z0-9+/]*={0,2}$/.test(chunk))
        throw Error("TTS音频数据无效");
      const bytes = Buffer.from(chunk, "base64");
      if (!audio.length) onFirst();
      size += bytes.length;
      if (size > 2880000) throw Error("TTS音频超过60秒");
      audio.push(bytes);
    }
    if (event.output?.finish_reason === "stop") done = true;
  };
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      wire += part.value.length;
      if (wire > 8000000) throw Error("TTS流超出上限");
      pending += decoder.decode(part.value, { stream: true });
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, at).replace(/\r$/, ""));
        pending = pending.slice(at + 1);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) line(pending);
    if (!done || !size || size % 2) throw Error("TTS流未完整结束");
    return Buffer.concat(audio, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export function spokenText(text: string) {
  return text
    .replace(
      /（[^）\n]{0,50}(?:眨眼|托腮|门缝|眼睛|清清嗓|被子|白雾)[^）\n]{0,50}）/g,
      "",
    )
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\*\*|__|^#{1,6}\s*/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
