// 允许ASR加上的语气词，仍拒绝引用、否定和对词义的讨论。
export function isYardStop(text: string) {
  const words = text
    .trim()
    .split(/[，,。.!！?？；;\s]+/)
    .filter(Boolean);
  const command = /^(?:(?:小冰|萌小冰))?(?:请)?(?:你)?退下(?:吧)?$/;
  const filler = /^(?:好(?:的|吧)?|等(?:等|一下)?|嗯+|呃+|那个|小冰|萌小冰)$/;
  return (
    words.some((v) => command.test(v)) &&
    words.every((v) => command.test(v) || filler.test(v))
  );
}

// 只接受明确拍摄指令，避免讨论、否定或引用触发相机。
export function isYardPhoto(text: string) {
  const command = text.trim().replace(/[。！!？?～~]+$/u, "");
  return /^(?:(?:萌小冰|小冰)[，,、\s]*)?(?:请[，,\s]*)?(?:(?:你|帮我|给我|帮我们|给我们|我们)[，,\s]*){0,2}(?:现在|马上|来)?(?:拍照|拍(?:一|个)?张(?:照片|照|合影)?|拍个照|拍个合影|拍一下|照(?:一)?张相|合影|留影)(?:一下|吧|好吗|可以吗|行吗)?$/u.test(command);
}
