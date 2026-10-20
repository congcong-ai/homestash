import "dotenv/config";
const response = await fetch(
  `http://127.0.0.1:${process.env.CORE_PORT ?? 3100}/api/state`,
  { signal: AbortSignal.timeout(3000) },
);
if (!response.ok) throw new Error(`Core 状态读取失败：HTTP ${response.status}`);
const { physicalDevice } = await response.json();
if (!physicalDevice) {
  console.log("尚未收到真实开发板状态。");
} else {
  const online = Date.now() - Date.parse(physicalDevice.lastSeen) < 45000;
  console.log(
    JSON.stringify(
      {
        设备: physicalDevice.id,
        固件版本: physicalDevice.firmwareVersion ?? null,
        运行分区: physicalDevice.firmwarePartition ?? null,
        OTA确认: physicalDevice.otaState ?? null,
        电源状态: physicalDevice.powerState ?? null,
        内部空闲堆字节: physicalDevice.freeHeapBytes ?? null,
        内部最小空闲堆字节: physicalDevice.minimumFreeHeapBytes ?? null,
        在线: online,
        上次上报: physicalDevice.lastSeen,
        实际屏幕文字: physicalDevice.screen ?? "此固件尚未上报屏幕文字",
        网络文字: physicalDevice.network ?? null,
        屏幕版本: physicalDevice.screenRevision ?? null,
        运行毫秒: physicalDevice.uptimeMs ?? null,
      },
      null,
      2,
    ),
  );
}
