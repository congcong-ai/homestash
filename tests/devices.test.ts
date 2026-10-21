import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { KORVO_BOARD_ID } from "@homestash/protocol";
import { pcmWav } from "@homestash/ai/speech";
test("多设备独立认证、状态和音频缓存；撤销与重新签发跨重启保留，旧环境凭据不能复活", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-devices-")),
    path = join(dir, "core.db");
  let core = createApp(path);
  let syntheses = 0;
  const speech = {
    transcribe: async () => "家里有什么",
    synthesize: async () => {
      syntheses++;
      return pcmWav(Buffer.alloc(3200));
    },
  };
  const options = {
    token: "l".repeat(32),
    deviceId: "legacy",
    mediaDir: join(dir, "media"),
  };
  let server = createDeviceServer(core, speech, options);
  const post = (url: string, payload: unknown) =>
    core.app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  const headers = (id: string, token: string) => ({
    "x-device-id": id,
    authorization: `Bearer ${token}`,
  });
  try {
    assert.equal(
      (
        await core.app.inject({
          method: "POST",
          url: "/api/devices",
          headers: { origin: "https://untrusted.example" },
          payload: { id: "blocked", name: "不应创建", boardId: KORVO_BOARD_ID },
        })
      ).statusCode,
      403,
    );
    const registered = await post("/api/devices", {
      id: "kitchen-02",
      name: "厨房设备",
      boardId: KORVO_BOARD_ID,
    });
    assert.equal(registered.statusCode, 200, registered.body);
    const { token } = registered.json();
    const a = headers("legacy", options.token),
      b = headers("kitchen-02", token);
    assert.equal(
      (
        await server.inject({
          url: "/device/v1/screen",
          headers: headers("legacy", token),
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/device/v1/heartbeat",
          headers: a,
          payload: {
            screen: "屏幕A",
            hardware: {
              boardId: KORVO_BOARD_ID,
              chip: "esp32s31",
              capabilities: ["wifi", "audio_input"],
            },
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/device/v1/heartbeat",
          headers: b,
          payload: { screen: "屏幕B" },
        })
      ).statusCode,
      200,
    );
    let devices = (await core.app.inject("/api/devices")).json();
    assert.equal(
      devices.find((d: { id: string }) => d.id === "legacy").report.screen,
      "屏幕A",
    );
    assert.equal(
      devices.find((d: { id: string }) => d.id === "kitchen-02").report.screen,
      "屏幕B",
    );
    assert.ok(!JSON.stringify(devices).includes(token));
    assert.ok(!JSON.stringify(devices).includes("tokenHash"));
    assert.ok(
      !JSON.stringify(core.repo.read("managed-devices", [])).includes(token),
    );
    const mismatch = await server.inject({
      method: "POST",
      url: "/device/v1/heartbeat",
      headers: b,
      payload: {
        hardware: {
          boardId: "other-board",
          chip: "esp32s3",
          capabilities: ["wifi"],
        },
      },
    });
    assert.equal(mismatch.statusCode, 409);
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/device/v1/heartbeat",
          headers: b,
          payload: {
            hardware: {
              boardId: KORVO_BOARD_ID,
              chip: "esp32s3",
              capabilities: [],
            },
          },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await post("/api/devices", {
          id: "kitchen-02",
          name: "重复",
          boardId: KORVO_BOARD_ID,
        })
      ).statusCode,
      409,
    );
    const id = randomUUID(),
      wav = pcmWav(Buffer.alloc(3200));
    for (const h of [a, b]) {
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: `/device/v1/captures/${id}`,
            headers: { ...h, "content-type": "audio/wav" },
            payload: wav,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await server.inject({
            url: `/device/v1/captures/${id}/audio`,
            headers: h,
          })
        ).statusCode,
        200,
      );
    }
    assert.equal(syntheses, 2, "不同设备相同采集ID不得串用音频缓存");
    await post("/api/devices/legacy/revoke", {});
    assert.equal(
      (await server.inject({ url: "/device/v1/screen", headers: a }))
        .statusCode,
      401,
    );
    await server.close();
    await core.app.close();
    core = createApp(path);
    server = createDeviceServer(core, speech, options);
    assert.equal(
      (await server.inject({ url: "/device/v1/screen", headers: a }))
        .statusCode,
      401,
    );
    const rotated = (await post("/api/devices/legacy/rotate-token", {})).json()
      .token;
    assert.equal(
      (await server.inject({ url: "/device/v1/screen", headers: a }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await server.inject({
          url: "/device/v1/screen",
          headers: headers("legacy", rotated),
        })
      ).statusCode,
      200,
    );
    await server.close();
    await core.app.close();
    core = createApp(path);
    server = createDeviceServer(core, speech, options);
    assert.equal(
      (
        await server.inject({
          url: "/device/v1/screen",
          headers: headers("legacy", rotated),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await server.inject({ url: "/device/v1/screen", headers: a }))
        .statusCode,
      401,
    );
    devices = (await core.app.inject("/api/devices")).json();
    assert.equal(devices.length, 2);
    await server.close();
    await core.app.close();
    core = createApp(path);
    server = createDeviceServer(core, speech, { mediaDir: join(dir, "media") });
    assert.equal(
      (
        await server.inject({
          url: "/device/v1/screen",
          headers: headers("legacy", rotated),
        })
      ).statusCode,
      200,
      "无环境预置Token也可使用已登记设备",
    );

    assert.equal(core.repo.events().length, 0, "查询验收不修改库存");
  } finally {
    await server.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("设备登记遵守后台登录和来源限制，凭据不对匿名调用开放", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-device-auth-"));
  const keys = [
    "INTERNAL_LOGIN_ENABLED",
    "INTERNAL_LOGIN_USERNAME",
    "INTERNAL_LOGIN_PASSWORD_HASH",
    "INTERNAL_SESSION_SECRET",
  ] as const;
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.INTERNAL_LOGIN_ENABLED = "true";
  process.env.INTERNAL_LOGIN_USERNAME = "owner";
  process.env.INTERNAL_LOGIN_PASSWORD_HASH = "test-salt:test-hash";
  process.env.INTERNAL_SESSION_SECRET = "s".repeat(32);
  const core = createApp(join(dir, "core.db"));
  try {
    assert.equal((await core.app.inject("/api/devices")).statusCode, 401);
    assert.equal(
      (
        await core.app.inject({
          method: "POST",
          url: "/api/devices",
          payload: { id: "blocked", name: "不应创建", boardId: KORVO_BOARD_ID },
        })
      ).statusCode,
      401,
    );
    assert.equal(core.devices.list().length, 0);
  } finally {
    await core.app.close();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
