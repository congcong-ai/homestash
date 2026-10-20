import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import {
  inspectFirmware,
  firmwareSignature,
} from "../services/kitchen-core/src/firmware";
import { pcmWav } from "@homestash/ai/speech";
function image(version = "0.3.0", chip = 32) {
  const b = Buffer.alloc(304);
  b[0] = 0xe9;
  b[1] = 1;
  b.writeUInt16LE(chip, 12);
  b[23] = 1;
  b.writeUInt32LE(256, 28);
  b.writeUInt32LE(0xabcd5432, 32);
  b.write(version, 48);
  b.write("homestash_freshmate", 80);
  let sum = 0xef;
  for (const x of b.subarray(32, 288)) sum ^= x;
  // 第一段结束288，校验位为303；摘要附加在304。
  b[303] = sum;
  return Buffer.concat([b, createHash("sha256").update(b).digest()]);
}
test("应用固件校验拒绝错芯片、坏校验、截断、错误项目和整片镜像", () => {
  const bytes = image();
  assert.equal(inspectFirmware(bytes).version, "0.3.0");
  for (const bad of [
    image("0.3.0", 9),
    bytes.subarray(0, 80),
    Buffer.alloc(5 * 1024 * 1024),
    Buffer.from(bytes),
  ]) {
    if (bad.length === bytes.length && bad.readUInt16LE(12) === 32)
      bad[100] ^= 1;
    assert.throws(() => inspectFirmware(bad));
  }
});
test("固件发布和下载鉴权、摘要签名、跨重启与坏缓存拒绝；不触碰库存", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-ota-"));
  let core = createApp(join(dir, "core.db"));
  const options = {
    token: "f".repeat(32),
    deviceId: "ota-test",
    mediaDir: join(dir, "media"),
  };
  const speech = {
    transcribe: async () => "",
    synthesize: async () => pcmWav(Buffer.alloc(3200)),
  };
  let device = createDeviceServer(core, speech, options);
  const headers = {
    authorization: `Bearer ${options.token}`,
    "x-device-id": options.deviceId,
  };
  try {
    assert.equal(
      (await device.inject({ url: "/device/v1/firmware", headers })).statusCode,
      404,
    );
    assert.equal((await device.inject("/device/v1/firmware")).statusCode, 401);
    const upload = await core.app.inject({
      method: "POST",
      url: "/api/firmware",
      headers: { "content-type": "application/octet-stream" },
      payload: image(),
    });
    assert.equal(upload.statusCode, 200, upload.body);
    const release = upload.json();
    const manifest = (
      await device.inject({ url: "/device/v1/firmware", headers })
    ).json();
    assert.equal(manifest.signature, firmwareSignature(release, options.token));
    assert.ok(!JSON.stringify(manifest).includes(options.token));
    const download = await device.inject({
      url: `/device/v1/firmware/${release.id}`,
      headers,
    });
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.rawPayload, image());
    assert.equal(
      (
        await device.inject({
          url: `/device/v1/firmware/${release.id}`,
          headers: { ...headers, origin: "http://example.com" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await core.app.inject({
          method: "POST",
          url: "/api/firmware",
          headers: { "content-type": "application/octet-stream" },
          payload: Buffer.from("bad"),
        })
      ).statusCode,
      409,
    );
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    await device.close();
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    device = createDeviceServer(core, speech, options);
    assert.equal(
      (await device.inject({ url: "/device/v1/firmware", headers })).json().id,
      release.id,
    );
    await writeFile(join(dir, "firmware", `${release.id}.bin`), "corrupt");
    assert.equal(
      (
        await device.inject({
          url: `/device/v1/firmware/${release.id}`,
          headers,
        })
      ).statusCode,
      503,
    );
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
