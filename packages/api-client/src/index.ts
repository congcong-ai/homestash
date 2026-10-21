let dataEpoch: string | null = null;
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
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
  if (!response.ok) throw new Error(data.error ?? "请求失败，请重试");
  if (path === "/state" && typeof data?.dataEpoch === "string")
    dataEpoch = data.dataEpoch;
  return data as T;
}
