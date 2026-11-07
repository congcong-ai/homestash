import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { recordingWorker } from "../services/kitchen-core/src/yard-background";
import {
  recordings,
  recordingsKey,
} from "../services/kitchen-core/src/yard-recordings";
test("后台转写只在空闲运行，激活中止且任务保留，重新空闲可续上", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-background-"));
  const core = createApp(join(dir, "db"));
  let worker: ReturnType<typeof recordingWorker> | undefined;
  try {
    const path = join(dir, "test.wav");
    await writeFile(path, "test");
    core.repo.write(recordingsKey, [
      {
        id: "test",
        deviceId: "board",
        path,
        sha256: "test",
        bytes: 4,
        createdAt: new Date().toISOString(),
        speakerId: null,
        analysis: "pending",
      },
    ]);
    core.repo.write("product:food-spirit-yard:recordings:settings:v1", {
      transcribe: true,
      recognizeSpeaker: false,
    });
    let started: () => void = () => {};
    const start = new Promise<void>((r) => {
      started = r;
    });
    let count = 0;
    worker = recordingWorker(core.repo, {
      transcribe: async (_wav, options) => {
        count++;
        started();
        if (count === 1)
          await new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener(
              "abort",
              () => reject(Error("cancel")),
              { once: true },
            ),
          );
        return "吃面条";
      },
      synthesize: async () => Buffer.alloc(0),
    });
    await worker.run();
    assert.equal(count, 0);
    worker.inactive("board");
    const task = worker.run();
    await start;
    worker.active("board");
    await task;
    assert.equal(recordings(core.repo)[0].analysis, "pending");
    await worker.run();
    assert.equal(count, 1);
    worker.inactive("board");
    await worker.run();
    assert.equal(recordings(core.repo)[0].text, "吃面条");
    assert.equal(count, 2);
  } finally {
    worker?.close();
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
