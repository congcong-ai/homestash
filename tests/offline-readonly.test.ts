import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../services/kitchen-core/src/app";
import { passwordHash } from "../services/kitchen-core/src/auth";
import { offlineSnapshot } from "../apps/web/lib/offline-snapshot";
import {
  clearOffline,
  enableOffline,
  offlineEnabled,
  pendingLogout,
  beginLogout,
  flushLogout,
  readSnapshot,
  saveSnapshot,
  validSnapshot,
} from "../apps/web/public/offline-storage.js";
import { api, setReadOnly } from "../packages/api-client/src/index";
class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const sample = (now = Date.now()) => ({
  version: 1 as const,
  scope: "test-scope",
  savedAt: now,
  expiresAt: now + 3600000,
  timeZone: "Asia/Shanghai",
  date: "2026-10-27",
  items: [
    {
      name: "牛奶",
      category: "food",
      quantity: 2,
      unit: "瓶",
      location: "冷藏室",
      status: "urgent",
      deadline: "2026-10-27",
    },
  ],
  shopping: [{ name: "鸡蛋", quantity: 3, unit: "个", checked: false }],
  recipes: [{ name: "番茄炒蛋", steps: ["打散鸡蛋。"] }],
  cooking: { name: "番茄炒蛋", step: "打散鸡蛋。" },
});
function withStorage(work: (s: MemoryStorage) => Promise<void> | void) {
  return async () => {
    const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
    try {
      await work(storage);
    } finally {
      if (old) Object.defineProperty(globalThis, "localStorage", old);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  };
}

test(
  "默认不缓存，主动开启后才保存；过期、损坏及非法时区副本不显示",
  withStorage((storage) => {
    const value = sample();
    assert.equal(saveSnapshot(value), false);
    assert.equal(storage.data.size, 0);
    enableOffline();
    assert.equal(saveSnapshot(value), true);
    assert.equal(readSnapshot()?.items[0].quantity, 2);
    assert.equal(readSnapshot(value.expiresAt), null);
    assert.equal(storage.getItem("homestash.offline.v1.snapshot"), null);
    for (const invalid of [
      { ...value, timeZone: "Bad/Zone" },
      { ...value, expiresAt: value.savedAt + 13 * 3600000 },
      { ...value, savedAt: Date.now() + 120000 },
      "{损坏",
    ]) {
      storage.setItem(
        "homestash.offline.v1.snapshot",
        typeof invalid === "string" ? invalid : JSON.stringify(invalid),
      );
      assert.equal(readSnapshot(), null);
    }
    assert.equal(
      validSnapshot({
        ...value,
        items: [{ ...value.items[0], quantity: NaN }],
      }),
      false,
    );
  }),
);

test("库存副本按允许字段投影，不保存模型配置、设备令牌、事件或原始图片", async () => {
  const core = createApp(":memory:");
  try {
    core.inventory.create({
      name: "牛奶",
      quantity: 2,
      metadata: { secret: "sk-secret", image: "data:image/png;base64,private" },
    });
    const state = (await core.app.inject("/api/state")).json();
    state.settings.provider.secret = "provider-secret";
    state.physicalDevices = [{ token: "device-token" }];
    const snapshot = offlineSnapshot(state);
    assert.ok(validSnapshot(snapshot));
    const raw = JSON.stringify(snapshot);
    for (const secret of [
      "sk-secret",
      "provider-secret",
      "device-token",
      "data:image",
      "metadata",
      "physicalDevices",
      "events",
      "settings",
    ])
      assert.ok(!raw.includes(secret));
    assert.equal(snapshot.items[0].quantity, 2);
    assert.equal(snapshot.scope, "local");
    assert.deepEqual((await core.app.inject("/api/auth/session")).json(), {
      enabled: false,
    });
    const logout = await core.app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
  } finally {
    await core.app.close();
  }
});

test("已登录会话的副本授权使用稳定匿名分区及真实会话到期时间", async () => {
  const keys = [
    "INTERNAL_LOGIN_ENABLED",
    "INTERNAL_LOGIN_USERNAME",
    "INTERNAL_LOGIN_PASSWORD_HASH",
    "INTERNAL_SESSION_SECRET",
  ];
  const previous = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    INTERNAL_LOGIN_ENABLED: "true",
    INTERNAL_LOGIN_USERNAME: "owner",
    INTERNAL_LOGIN_PASSWORD_HASH: passwordHash("测试口令"),
    INTERNAL_SESSION_SECRET: "a".repeat(64),
  });
  const core = createApp(":memory:");
  try {
    assert.equal((await core.app.inject("/api/state")).statusCode, 401);
    const login = async () => {
      const r = await core.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "owner", password: "测试口令" },
      });
      return String(r.headers["set-cookie"]).split(";")[0];
    };
    const cookie = await login();
    const first = (
      await core.app.inject({ url: "/api/state", headers: { cookie } })
    ).json().offlineAccess;
    const second = (
      await core.app.inject({ url: "/api/state", headers: { cookie } })
    ).json().offlineAccess;
    assert.deepEqual(first, second);
    assert.match(first.scope, /^[a-f0-9]{64}$/);
    assert.equal(first.expiresAt, Number(cookie.split("=")[1].split(".")[0]));
    assert.ok(!JSON.stringify(first).includes(cookie));
    const another = (
      await core.app.inject({
        url: "/api/state",
        headers: { cookie: await login() },
      })
    ).json().offlineAccess;
    assert.notEqual(another.scope, first.scope);
  } finally {
    await core.app.close();
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});

test(
  "断线退出立即清除副本，退出未确认前禁止读取或重新保存；重连完成远端退出",
  withStorage(async () => {
    enableOffline();
    saveSnapshot(sample());
    beginLogout();
    assert.equal(offlineEnabled(), false);
    assert.equal(readSnapshot(), null);
    assert.equal(pendingLogout(), true);
    enableOffline();
    assert.equal(saveSnapshot(sample()), false);
    const fetchBefore = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw Error("Core断线");
      };
      await assert.rejects(flushLogout(), /Core断线/);
      assert.equal(pendingLogout(), true);
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response(null, { status: 204 });
      };
      await Promise.all([flushLogout(), flushLogout()]);
      assert.equal(calls, 1);
      assert.equal(pendingLogout(), false);
      clearOffline();
      assert.equal(readSnapshot(), null);
    } finally {
      globalThis.fetch = fetchBefore;
    }
  }),
);

test("离线只读在发起网络调用前拒绝所有写请求，仍允许重连状态查询", async () => {
  const fetchBefore = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ dataEpoch: "test" });
    };
    setReadOnly(true);
    await assert.rejects(api("/voice", { text: "买牛奶" }), /离线只读/);
    assert.equal(calls, 0);
    await api("/state");
    assert.equal(calls, 1);
    setReadOnly(false);
    await api("/shopping", { action: "check" });
    assert.equal(calls, 2);
  } finally {
    setReadOnly(false);
    globalThis.fetch = fetchBefore;
  }
});

test(
  "浏览器空间不足时保存失败不伪报成功，清除不影响其他应用存储",
  withStorage((storage) => {
    storage.setItem("other-app", "保留");
    enableOffline();
    const save = storage.setItem.bind(storage);
    storage.setItem = () => {
      throw Error("quota");
    };
    assert.equal(saveSnapshot(sample()), false);
    storage.setItem = save;
    clearOffline();
    assert.equal(storage.getItem("other-app"), "保留");
    assert.equal(readSnapshot(), null);
  }),
);
