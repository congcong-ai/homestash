import "dotenv/config";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const queue = process.argv[2];
if (!queue) throw new Error("请传入当前串口监控使用的命令队列文件路径");
if (!process.env.DEVICE_TOKEN || !process.env.DEVICE_ID)
  throw new Error("缺少Core设备配置");
const directory = await mkdtemp(join(tmpdir(), "homestash-device-pages-"));
const records: unknown[] = [];
const state = async () => {
  const response = await fetch("http://127.0.0.1:3100/api/state");
  assert.equal(response.status, 200);
  return (await response.json()).physicalDevice;
};
try {
  for (const [index, page] of [
    "home",
    "inventory",
    "freshness",
    "recipes",
    "cooking",
    "shopping",
  ].entries()) {
    const response = await fetch(
      `http://127.0.0.1:3101/device/v1/screen?page=${page}`,
      {
        headers: {
          authorization: `Bearer ${process.env.DEVICE_TOKEN}`,
          "x-device-id": process.env.DEVICE_ID,
        },
      },
    );
    assert.equal(response.status, 200);
    const expected = await response.json();
    const before = await state();
    await appendFile(queue, `screen ${index}\n`);
    const started = Date.now();
    let actual = before;
    while (Date.now() - started < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      actual = await state();
      if (
        actual?.screen === expected.text &&
        actual?.screenRevision > before.screenRevision
      )
        break;
    }
    assert.equal(
      actual?.screen,
      expected.text,
      `${page}真实LCD上报与Core页面不一致`,
    );
    assert.ok(
      actual.screenRevision > before.screenRevision,
      `${page}未取得设备新屏幕版本`,
    );
    records.push({
      page,
      elapsedMs: Date.now() - started,
      revision: actual.screenRevision,
      matched: true,
    });
  }
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(
      {
        records,
        boundary: "串口导航与真实LCD文本上报，不代替实体触摸逐页验收",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ directory, records }, null, 2));
} finally {
  await appendFile(queue, "screen 0\n");
}
