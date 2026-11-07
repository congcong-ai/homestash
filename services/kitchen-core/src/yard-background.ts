import type { SQLiteRepository } from "@homestash/database";
import type { SpeechProvider } from "@homestash/ai/speech";
import { readFile } from "node:fs/promises";
import {
  recordings,
  recordingsKey,
  recordingSettings,
} from "./yard-recordings";
// 每个Core进程一个低优先级分析任务。元数据中的pending在重启后重新扫描。
export function recordingWorker(
  repo: SQLiteRepository,
  speech: SpeechProvider,
) {
  const idle = new Map<string, number>();
  const activeDevices = new Set<string>();
  let running = false;
  let controller: AbortController | undefined;
  let stopped = false;
  const active = (deviceId: string) => {
    idle.delete(deviceId);
    activeDevices.add(deviceId);
    controller?.abort();
  };
  const inactive = (deviceId: string) => {
    activeDevices.delete(deviceId);
    idle.set(deviceId, Date.now() + 35000);
  };
  const timer = setInterval(() => {
    if (!recordingSettings(repo).transcribe) controller?.abort();
    void run();
  }, 2000);
  timer.unref();
  async function run() {
    if (
      stopped ||
      running ||
      activeDevices.size ||
      !recordingSettings(repo).transcribe
    )
      return;
    const item = recordings(repo).find(
      (v) =>
        v.analysis === "pending" &&
        (v.retryAfter ?? 0) <= Date.now() &&
        (idle.get(v.deviceId) ?? 0) > Date.now(),
    );
    if (!item) return;
    running = true;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const bytes = await readFile(item.path);
      if (signal.aborted) return;
      const text = await speech.transcribe(bytes, { signal });
      if (signal.aborted || !recordingSettings(repo).transcribe) return;
      repo.write(
        recordingsKey,
        recordings(repo).map((v) =>
          v.id === item.id ? { ...v, text, analysis: "complete" } : v,
        ),
      );
    } catch {
      if (!signal.aborted && !stopped)
        repo.write(
          recordingsKey,
          recordings(repo).map((v) =>
            v.id === item.id
              ? { ...v, analysis: "pending", retryAfter: Date.now() + 60000 }
              : v,
          ),
        );
    } finally {
      running = false;
      controller = undefined;
    }
  }
  return {
    active,
    inactive,
    run,
    close: () => {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
    },
  };
}
