/** HTTP局域网仍可用安全随机字节，统一生成符合协议的UUID v4。 */
export function createRequestId(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function")
    throw new Error("当前浏览器不支持安全随机数，请更换浏览器后重试");
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let dataEpoch: string | null = null;
let readOnly = false;
export function setReadOnly(value: boolean) {
  readOnly = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (body !== undefined && readOnly)
    throw Error("当前为离线只读，请重连并核对最新数据后再操作");
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(path === "/state" ? { signal: AbortSignal.timeout(5000) } : {}),
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            ...(dataEpoch ? { "X-HomeStash-Data-Epoch": dataEpoch } : {}),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("homestash:auth-required"));
    throw new ApiError(data.error ?? "请求失败，请重试", response.status);
  }
  if (path === "/state" && typeof data?.dataEpoch === "string")
    dataEpoch = data.dataEpoch;
  return data as T;
}
