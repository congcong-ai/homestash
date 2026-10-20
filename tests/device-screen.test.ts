import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { devicePages } from "../services/kitchen-core/src/device-screen";
import { pcmWav } from "@homestash/ai/speech";

test("设备页面读取最新库存与 Web 烹饪任务；已过期食品不进入今天先吃", async () => {
  const core = createApp(":memory:");
  const token = "s".repeat(32),
    deviceId = "screen-test";
  const device = createDeviceServer(
    core,
    {
      transcribe: async () => "",
      synthesize: async () => pcmWav(Buffer.alloc(3200)),
    },
    { token, deviceId, mediaDir: "/tmp/homestash-unused-screen" },
  );
  const headers = { authorization: `Bearer ${token}`, "x-device-id": deviceId };
  const read = (page: string) =>
    device.inject({
      method: "GET",
      url: `/device/v1/screen?page=${page}`,
      headers,
    });
  try {
    assert.equal((await device.inject("/device/v1/screen")).statusCode, 401);
    assert.equal((await read("unknown")).statusCode, 400);
    const before = (await read("inventory")).json();
    const today = new Date().toISOString().slice(0, 10);
    for (const item of [
      { name: "番茄", quantity: 2, bestBeforeAt: today },
      { name: "鸡蛋", quantity: 6 },
      { name: "过期牛奶", quantity: 1, expiresAt: "2000-01-01" },
    ]) {
      const reply = await core.app.inject({
        method: "POST",
        url: "/api/items",
        payload: item,
      });
      assert.equal(reply.statusCode, 200, reply.body);
    }
    const inventory = (await read("inventory")).json();
    assert.match(inventory.text, /番茄 2个/);
    assert.notEqual(inventory.revision, before.revision);
    const home = (await read("home")).json();
    assert.match(home.text, /番茄/);
    assert.doesNotMatch(home.text, /过期牛奶/);
    assert.match((await read("freshness")).json().text, /已过期：过期牛奶/);
    const start = await core.app.inject({
      method: "POST",
      url: "/api/cooking",
      payload: { action: "start", recipeId: "tomato-eggs" },
    });
    assert.equal(start.statusCode, 200, start.body);
    assert.match((await read("cooking")).json().text, /第1步/);
    const next = await core.app.inject({
      method: "POST",
      url: "/api/cooking",
      payload: { action: "next" },
    });
    assert.equal(next.statusCode, 200, next.body);
    assert.match((await read("cooking")).json().text, /第2步/);
    for (const page of devicePages) {
      const reply = await read(page);
      assert.equal(reply.statusCode, 200, reply.body);
      assert.ok(Buffer.byteLength(JSON.stringify(reply.json())) < 2048);
      assert.ok(Buffer.byteLength(reply.json().text) < 1024);
      assert.equal(reply.json().revision, (await read(page)).json().revision);
      assert.ok(!("settings" in reply.json()));
    }
    assert.equal(core.repo.list().length, 3);
    assert.equal(core.repo.events().length, 3);
  } finally {
    await device.close();
    await core.app.close();
  }
});
