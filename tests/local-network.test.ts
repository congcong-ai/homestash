import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createApp } from "../services/kitchen-core/src/app";
import {
  isPrivateAddress,
  lanAddresses,
  selectLanAddress,
  ensureLanAuth,
  validateLanAuth,
  preparePort,
  portAvailable,
} from "../scripts/lib/local-network.mjs";

test("局域网地址仅选择已连接的家庭IPv4，排除公网、回环和VPN接口", () => {
  for (const address of [
    "192.168.3.85",
    "10.2.3.4",
    "172.16.0.1",
    "172.31.255.254",
  ])
    assert.equal(isPrivateAddress(address), true);
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "8.8.8.8",
    "172.32.0.1",
    "100.79.50.84",
    "192.168.999.1",
    "192.168.03.1",
    "::1",
  ])
    assert.equal(isPrivateAddress(address), false);
  const net = (address: string, internal = false) => ({
    family: "IPv4" as const,
    address,
    internal,
    netmask: "255.255.255.0",
    mac: "00:00:00:00:00:00",
    cidr: `${address}/24`,
  });
  const addresses = lanAddresses({
    lo0: [net("127.0.0.1", true)],
    utun1: [net("10.99.0.1")],
    en0: [net("192.168.3.85")],
    eth0: [net("172.16.1.2")],
  });
  assert.deepEqual(
    addresses.map((a) => a.name),
    ["en0", "eth0"],
  );
  assert.equal(selectLanAddress(undefined, addresses), "192.168.3.85");
  assert.equal(selectLanAddress("172.16.1.2", addresses), "172.16.1.2");
  assert.throws(() => selectLanAddress("8.8.8.8", addresses));
  assert.throws(() => selectLanAddress(undefined, []));
});

test("局域网凭据自动生成、权限受限且重启复用；已有登录不被替换，无效配置拒绝启动", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-lan-auth-"));
  try {
    const result = ensureLanAuth(join(dir, "private"), {});
    validateLanAuth(result.config);
    assert.equal(result.config.INTERNAL_LOGIN_USERNAME, "home");
    assert.ok(result.accessPath);
    const access = await readFile(result.accessPath, "utf8");
    const password = access.match(/密码：(.+)/)?.[1];
    assert.ok(password && password.length >= 20);
    assert.equal(
      result.config.INTERNAL_LOGIN_PASSWORD_HASH.includes(password),
      false,
    );
    assert.deepEqual(ensureLanAuth(join(dir, "private"), {}), result);
    if (process.platform !== "win32") {
      assert.equal((await stat(result.accessPath)).mode & 0o777, 0o600);
      assert.equal(
        (await stat(join(dir, "private", "auth.env"))).mode & 0o777,
        0o600,
      );
    }
    const reused = ensureLanAuth(join(dir, "other"), result.config);
    assert.deepEqual(reused.config, result.config);
    assert.equal(reused.accessPath, null);
    assert.throws(() =>
      ensureLanAuth(join(dir, "other"), { INTERNAL_LOGIN_ENABLED: "true" }),
    );
    assert.throws(() =>
      validateLanAuth({ ...result.config, INTERNAL_LOGIN_ENABLED: "false" }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function listener(cwd: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)));`,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  const [chunk] = await once(child.stdout, "data");
  return { child, port: Number(String(chunk)) };
}
test("启动端口检查保留其他项目进程，选择空闲端口；仅终止本项目端口上的旧服务", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-foreign-listener-"));
  const foreign = await listener(dir);
  try {
    const port = await preparePort(foreign.port, "127.0.0.1", process.cwd());
    assert.notEqual(port, foreign.port);
    assert.equal(await portAvailable(foreign.port, "127.0.0.1"), false);
    assert.equal(foreign.child.exitCode, null);
    if (!spawnSync("lsof", ["-v"], { stdio: "ignore" }).error) {
      const owned = await listener(process.cwd());
      const exit = once(owned.child, "exit");
      try {
        assert.equal(
          await preparePort(owned.port, "127.0.0.1", process.cwd()),
          owned.port,
        );
        await exit;
        assert.equal(await portAvailable(owned.port, "127.0.0.1"), true);
      } finally {
        owned.child.kill();
      }
    }
    await assert.rejects(preparePort(0, "127.0.0.1", process.cwd()));
  } finally {
    foreign.child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("生成的家庭账号可登录Core，跨重启会话有效，未知来源和篡改Cookie被拒绝", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-lan-core-"));
  const keys = [
    "INTERNAL_LOGIN_ENABLED",
    "INTERNAL_LOGIN_USERNAME",
    "INTERNAL_LOGIN_PASSWORD_HASH",
    "INTERNAL_SESSION_SECRET",
    "APP_ORIGIN",
    "HOMESTASH_INSTANCE_ID",
    "NODE_ENV",
    "AI_PROVIDER",
  ];
  const previous = keys.map((key) => process.env[key]);
  const auth = ensureLanAuth(join(dir, "lan"), {});
  const access = await readFile(auth.accessPath!, "utf8");
  const password = access.match(/密码：(.+)/)![1];
  const origin = "http://192.168.1.20:3002";
  Object.assign(process.env, auth.config, {
    APP_ORIGIN: origin,
    HOMESTASH_INSTANCE_ID: "本次测试实例",
    NODE_ENV: "development",
    AI_PROVIDER: "mock",
  });
  let core: ReturnType<typeof createApp> | undefined;
  try {
    core = createApp(join(dir, "core.db"));
    assert.equal((await core.app.inject("/api/state")).statusCode, 401);
    assert.equal(
      (await core.app.inject("/api/health")).json().instanceId,
      "本次测试实例",
    );
    const login = {
      method: "POST" as const,
      url: "/api/auth/login",
      payload: { username: auth.config.INTERNAL_LOGIN_USERNAME, password },
    };
    assert.equal(
      (
        await core.app.inject({
          ...login,
          headers: { origin: "http://unknown.invalid" },
        })
      ).statusCode,
      403,
    );
    const response = await core.app.inject({ ...login, headers: { origin } });
    assert.equal(response.statusCode, 200);
    const cookie = String(response.headers["set-cookie"]).split(";")[0];
    assert.equal(
      (
        await core.app.inject({
          url: "/api/state",
          headers: { origin, cookie },
        })
      ).statusCode,
      200,
    );
    await core.app.close();
    core = undefined;
    Object.assign(process.env, ensureLanAuth(join(dir, "lan"), {}).config);
    core = createApp(join(dir, "core.db"));
    assert.equal(
      (
        await core.app.inject({
          url: "/api/state",
          headers: { origin, cookie },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await core.app.inject({
          url: "/api/state",
          headers: { origin, cookie: cookie.slice(0, -1) + "x" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await core?.app.close();
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(dir, { recursive: true, force: true });
  }
});
