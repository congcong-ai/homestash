import "dotenv/config";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// 只读验收：不会向设备发送录音、重启、升级或库存修改指令。
const seconds = Number(process.argv[2] ?? 300);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600)
  throw new Error("观察时长必须为60至3600秒");
const directory = await mkdtemp(join(tmpdir(), "homestash-phase1-observe-"));
const database = new Database(
  resolve(process.env.DATABASE_PATH ?? "data/homestash.db"),
  { readonly: true },
);
const snapshot = () => {
  const values = ["inventory_items", "inventory_events"].map((table) =>
    database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  );
  return {
    sha256: createHash("sha256").update(JSON.stringify(values)).digest("hex"),
    counts: values.map((rows) => rows.length),
  };
};
const before = snapshot();
const samples: Record<string, unknown>[] = [];
const failures: string[] = [];
let previousUptime = -1;
const started = Date.now();
console.log(`开始只读观察${seconds}秒，证据目录：${directory}`);
try {
  while (Date.now() - started < seconds * 1000) {
    const at = new Date().toISOString();
    try {
      const response = await fetch("http://127.0.0.1:3100/api/state", {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`状态接口HTTP ${response.status}`);
      const { physicalDevice: device } = await response.json();
      if (!device || !Number.isFinite(Date.parse(device.lastSeen)))
        throw new Error("尚无有效真实设备心跳");
      const ageMs = Date.now() - Date.parse(device.lastSeen);
      if (ageMs > 45000) failures.push(`${at} 心跳超过45秒`);
      if (device.uptimeMs < previousUptime)
        failures.push(`${at} 观察期间发生设备重启`);
      previousUptime = device.uptimeMs;
      samples.push({
        at,
        ageMs,
        uptimeMs: device.uptimeMs,
        version: device.firmwareVersion,
        partition: device.firmwarePartition,
        otaState: device.otaState,
        powerState: device.powerState,
        freeHeapBytes: device.freeHeapBytes,
        minimumFreeHeapBytes: device.minimumFreeHeapBytes,
      });
    } catch (error) {
      failures.push(
        `${at} ${error instanceof Error ? error.message : "状态读取失败"}`,
      );
    }
    await new Promise((done) => setTimeout(done, 5000));
  }
  const after = snapshot();
  if (before.sha256 !== after.sha256)
    failures.push("观察期间库存或事件数据发生变化");
  const result = {
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    requestedSeconds: seconds,
    samples,
    failures,
    inventoryUnchanged: before.sha256 === after.sha256,
    counts: after.counts,
    passed: failures.length === 0 && samples.length > 0,
    boundary: "短时连接和运行观察；不等同于长期压力、物理麦克风/试听或电流测量",
  };
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        directory,
        passed: result.passed,
        samples: samples.length,
        failures,
        inventoryUnchanged: result.inventoryUnchanged,
      },
      null,
      2,
    ),
  );
  if (!result.passed) process.exitCode = 1;
} finally {
  database.close();
}
