import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp } from "./app";
import { createDeviceServer } from "./device-server";
import { speechFromEnv } from "@homestash/ai/speech";
const path = resolve(process.env.DATABASE_PATH ?? "data/homestash.db");
mkdirSync(dirname(path), { recursive: true });
const core = createApp(path);
const { app } = core;
const deviceServer = process.env.DEVICE_TOKEN
  ? createDeviceServer(core, speechFromEnv(), {
      token: process.env.DEVICE_TOKEN,
      deviceId: process.env.DEVICE_ID ?? "freshmate-korvo-01",
      mediaDir: resolve("data/device-media"),
    })
  : null;
await app.listen({
  port: Number(process.env.CORE_PORT ?? 3100),
  host: "127.0.0.1",
});
if (deviceServer)
  await deviceServer.listen({
    port: 3101,
    host: process.env.DEVICE_HOST ?? "127.0.0.1",
  });
console.log("HomeStash Core 已启动：http://127.0.0.1:3100");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void (async () => {
      await deviceServer?.close();
      await app.close();
      process.exit(0);
    })();
  });
