import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  validateLanAuth,
  isPrivateAddress,
} from "../../../scripts/lib/local-network.mjs";
import { createApp } from "./app";
import { createDeviceServer } from "./device-server";
import { speechFromEnv } from "@homestash/ai/speech";
const path = resolve(process.env.DATABASE_PATH ?? "data/homestash.db");
mkdirSync(dirname(path), { recursive: true });
if (process.env.HOMESTASH_LAN_ENABLED === "true") {
  if (process.env.INTERNAL_LOGIN_ENABLED === "true")
    validateLanAuth(process.env);
  const origin = new URL(process.env.APP_ORIGIN ?? "");
  if (
    process.env.NODE_ENV === "production" ||
    origin.protocol !== "http:" ||
    !isPrivateAddress(origin.hostname) ||
    origin.hostname !== process.env.HOMESTASH_LAN_ADDRESS
  )
    throw Error("局域网试用配置不匹配，未启动Core");
}
const core = createApp(path);
const { app } = core;
const deviceServer = createDeviceServer(core, speechFromEnv(), {
  token: process.env.DEVICE_TOKEN,
  deviceId: process.env.DEVICE_ID ?? "freshmate-korvo-01",
  mediaDir: resolve("data/device-media"),
  debugImageDir: process.env.DEVICE_IMAGE_DEBUG_DIR,
});
await app.listen({
  port: Number(process.env.CORE_PORT ?? 3100),
  host: "127.0.0.1",
});
if (deviceServer)
  await deviceServer.listen({
    port: Number(process.env.DEVICE_PORT ?? 3101),
    host: process.env.DEVICE_HOST ?? "127.0.0.1",
  });
console.log(`HomeStash Core 已启动：${app.listeningOrigin}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void (async () => {
      await deviceServer?.close();
      await app.close();
      process.exit(0);
    })();
  });
