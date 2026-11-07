// 允许ASR加上的语气词，仍拒绝引用、否定和对词义的讨论。
export function isYardStop(text: string) {
  const words = text
    .trim()
    .split(/[，,。.!！?？；;\s]+/)
    .filter(Boolean);
  const command = /^(?:(?:小冰|萌小冰))?(?:请)?退下(?:吧)?$/;
  const filler = /^(?:好(?:的|吧)?|等(?:等|一下)?|嗯+|呃+|那个|小冰|萌小冰)$/;
  return (
    words.some((v) => command.test(v)) &&
    words.every((v) => command.test(v) || filler.test(v))
  );
}
