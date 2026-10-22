import { canonical } from "../services/kitchen-core/src/backups";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calendarDate,
  addCalendarDays,
  TimeZone,
  freshnessInfo,
} from "@homestash/domain";
import { MockAIProvider } from "@homestash/ai";
import { createApp } from "../services/kitchen-core/src/app";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
const setZone = (
  core: ReturnType<typeof createApp>,
  timeZone: string,
  expectedRevision = 1,
) =>
  post(core, "/api/calendar", {
    requestId: crypto.randomUUID(),
    timeZone,
    expectedRevision,
  });

test("家庭日期按IANA时区计算，跨年、闰日与夏令时保持日历天语义", () => {
  const instant = new Date("2026-10-22T16:30:00Z");
  assert.equal(calendarDate("UTC", instant), "2026-10-22");
  assert.equal(calendarDate("Asia/Shanghai", instant), "2026-10-23");
  assert.equal(calendarDate("America/Los_Angeles", instant), "2026-10-22");
  for (const [from, to] of [
    ["2026-03-08", "2026-03-09"],
    ["2026-11-01", "2026-11-02"],
    ["2024-02-28", "2024-02-29"],
    ["2026-12-31", "2027-01-01"],
  ])
    assert.equal(addCalendarDays(from, 1), to);
  assert.equal(
    calendarDate("America/Los_Angeles", new Date("2026-03-09T06:59:59Z")),
    "2026-03-08",
  );
  assert.equal(
    calendarDate("America/Los_Angeles", new Date("2026-03-09T07:00:00Z")),
    "2026-03-09",
  );
  assert.equal(TimeZone.safeParse("Invalid/Zone").success, false);
  assert.equal(
    freshnessInfo(
      {
        name: "牛奶",
        category: "food",
        openedAt: "2026-03-08",
        openedReminderDays: 1,
      } as never,
      "2026-03-09",
    ).deadline,
    "2026-03-09",
  );
});

test("时区设置持久化、乐观锁与幂等重放不改写库存日期", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-calendar-"));
  let core = createApp(join(dir, "core.db"), undefined, {
    now: () => new Date("2026-10-22T16:30:00Z"),
  });
  try {
    const item = core.inventory.create({
      name: "牛奶",
      purchasedAt: "2026-10-20",
      expiresAt: "2026-10-22",
    });
    assert.equal(
      (await core.app.inject("/api/state")).json().calendar.timeZone,
      "UTC",
    );
    assert.equal(core.repo.read("household-calendar", null), null);
    const body = {
      requestId: crypto.randomUUID(),
      timeZone: "Asia/Shanghai",
      expectedRevision: 1,
    };
    assert.equal((await post(core, "/api/calendar", body)).statusCode, 200);
    assert.equal((await post(core, "/api/calendar", body)).json().revision, 2);
    assert.equal((await setZone(core, "UTC")).statusCode, 409);
    assert.equal((await setZone(core, "Invalid/Zone", 2)).statusCode, 400);
    const state = (await core.app.inject("/api/state")).json();
    assert.equal(state.calendar.date, "2026-10-23");
    assert.equal(state.todayFirst.length, 0);
    assert.deepEqual(core.repo.get(item.id), item);
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    assert.equal(
      (await core.app.inject("/api/state")).json().calendar.timeZone,
      "Asia/Shanghai",
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("语音新增和开封使用家庭日期，跨日重放不重复入库", async () => {
  let instant = new Date("2026-10-22T16:30:00Z");
  const core = createApp(":memory:", undefined, { now: () => instant });
  try {
    await setZone(core, "Asia/Shanghai");
    const body = { requestId: crypto.randomUUID(), text: "买了两个番茄" };
    const first = await post(core, "/api/voice", body);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(core.repo.list()[0].purchasedAt, "2026-10-23");
    const opened = await post(core, "/api/voice", {
      requestId: crypto.randomUUID(),
      text: "番茄开封了",
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(core.repo.list()[0].openedAt, "2026-10-23");
    instant = new Date("2026-10-23T16:30:00Z");
    assert.deepEqual(
      (await post(core, "/api/voice", body)).json(),
      first.json(),
    );
    assert.equal(core.repo.list().length, 1);
    assert.equal(
      (await core.app.inject("/api/state")).json().calendar.date,
      "2026-10-24",
    );
  } finally {
    await core.app.close();
  }
});

test("异步意图跨家庭午夜禁止提交，重试需新确认", async () => {
  let instant = new Date("2026-10-22T23:59:59Z");
  const core = createApp(":memory:", new MockAIProvider(), {
    now: () => instant,
  });
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = core.once("midnight", { text: "新增" }, async () => {
      started();
      await gate;
      return () => core.inventory.create({ name: "番茄" });
    });
    await ready;
    instant = new Date("2026-10-23T00:00:00Z");
    release();
    await assert.rejects(pending, /家庭日期或时区已变化/);
    assert.equal(core.repo.list().length, 0);
    await core.once(
      "midnight-new",
      {},
      async () => () => core.inventory.create({ name: "番茄" }),
    );
    assert.equal(core.repo.list().length, 1);
  } finally {
    await core.app.close();
  }
});

test("备份保存并恢复家庭时区，导出文件名使用家庭日期", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-calendar-backup-"));
  const core = createApp(join(dir, "core.db"), undefined, {
    now: () => new Date("2026-10-22T16:30:00Z"),
  });
  try {
    await setZone(core, "Asia/Shanghai");
    const exported = await core.app.inject("/api/backups/export");
    assert.match(String(exported.headers["content-disposition"]), /2026-10-23/);
    const backup = exported.json();
    await setZone(core, "UTC", 2);
    const preview = await post(core, "/api/backups/validate", backup);
    assert.equal(preview.statusCode, 200, preview.body);
    const restored = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: preview.json().currentFingerprint,
      backup,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(
      (await core.app.inject("/api/state")).json().calendar.timeZone,
      "Asia/Shanghai",
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("同一家庭日界线同步首页、食谱与设备投影，跨日排除过期食物", async () => {
  let instant = new Date("2026-10-22T15:59:59Z");
  const core = createApp(":memory:", undefined, { now: () => instant });
  try {
    await setZone(core, "Asia/Shanghai");
    const item = core.inventory.create({
      name: "番茄",
      quantity: 2,
      unit: "个",
      expiresAt: "2026-10-22",
    });
    const before = (await core.app.inject("/api/state")).json();
    assert.equal(before.todayFirst.length, 1);
    assert.ok(
      before.recipes
        .find((r: { id: string }) => r.id === "tomato-eggs")
        .used.includes("番茄"),
    );
    assert.match(JSON.stringify(core.deviceScreen("home")), /番茄 2个/);
    instant = new Date("2026-10-22T16:00:00Z");
    const after = (await core.app.inject("/api/state")).json();
    assert.equal(after.todayFirst.length, 0);
    assert.ok(
      !after.recipes
        .find((r: { id: string }) => r.id === "tomato-eggs")
        .used.includes("番茄"),
    );
    assert.doesNotMatch(JSON.stringify(core.deviceScreen("home")), /番茄 2个/);
    assert.match(JSON.stringify(core.deviceScreen("freshness")), /番茄/);
    assert.deepEqual(core.repo.get(item.id), item);
  } finally {
    await core.app.close();
  }
});

test("旧备份缺少家庭时区恢复UTC；无效时区即使重新签名也拒绝", async () => {
  const { createHash } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "hs-calendar-legacy-"));
  const core = createApp(join(dir, "core.db"));
  try {
    const legacy = (await core.app.inject("/api/backups/export")).json();
    await setZone(core, "Asia/Shanghai");
    const bad = (await core.app.inject("/api/backups/export")).json();
    bad.payload.state.find(
      (r: { id: string }) => r.id === "household-calendar",
    ).data.timeZone = "Bad/Zone";
    bad.sha256 = createHash("sha256")
      .update(canonical(bad.payload))
      .digest("hex");
    assert.equal(
      (await post(core, "/api/backups/validate", bad)).statusCode,
      400,
    );
    const preview = (await post(core, "/api/backups/validate", legacy)).json();
    const result = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: preview.currentFingerprint,
      backup: legacy,
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(
      (await core.app.inject("/api/state")).json().calendar.timeZone,
      "UTC",
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("家庭时区沿用登录和来源保护", async () => {
  const { passwordHash } = await import("../services/kitchen-core/src/auth");
  const keys = [
    "INTERNAL_LOGIN_ENABLED",
    "INTERNAL_LOGIN_USERNAME",
    "INTERNAL_LOGIN_PASSWORD_HASH",
    "INTERNAL_SESSION_SECRET",
    "APP_ORIGIN",
  ];
  const previous = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    INTERNAL_LOGIN_ENABLED: "true",
    INTERNAL_LOGIN_USERNAME: "owner",
    INTERNAL_LOGIN_PASSWORD_HASH: passwordHash("测试口令"),
    INTERNAL_SESSION_SECRET: "a".repeat(64),
    APP_ORIGIN: "http://192.168.1.20:3000",
  });
  const core = createApp(":memory:");
  try {
    const payload = {
      requestId: crypto.randomUUID(),
      timeZone: "Asia/Shanghai",
      expectedRevision: 1,
    };
    assert.equal((await post(core, "/api/calendar", payload)).statusCode, 401);
    const login = await post(core, "/api/auth/login", {
      username: "owner",
      password: "测试口令",
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const request = (origin: string) =>
      core.app.inject({
        method: "POST",
        url: "/api/calendar",
        payload,
        headers: { cookie, origin },
      });
    assert.equal((await request("http://untrusted.invalid")).statusCode, 403);
    assert.equal((await request(process.env.APP_ORIGIN!)).statusCode, 200);
  } finally {
    await core.app.close();
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});

test("烹饪待确认用量跨家庭午夜后重新校验，过期批次不扣减", async () => {
  let instant = new Date("2026-10-22T15:59:59Z");
  const core = createApp(":memory:", undefined, { now: () => instant });
  const cooking = (payload: object) =>
    post(core, "/api/cooking", { requestId: crypto.randomUUID(), ...payload });
  try {
    await setZone(core, "Asia/Shanghai");
    core.inventory.create({
      name: "番茄",
      quantity: 2,
      unit: "个",
      expiresAt: "2026-10-22",
    });
    core.inventory.create({ name: "鸡蛋", quantity: 3, unit: "个" });
    const start = await cooking({ action: "start", recipeId: "tomato-eggs" });
    assert.equal(start.statusCode, 200, start.body);
    const finish = await cooking({
      action: "finish",
      sessionId: start.json().id,
      revision: start.json().revision,
    });
    assert.equal(finish.statusCode, 200, finish.body);
    assert.equal(finish.json().consumption.missing.length, 0);
    const before = core.repo.list();
    instant = new Date("2026-10-22T16:00:00Z");
    const confirmed = await cooking({
      action: "confirm_consumption",
      sessionId: finish.json().id,
      revision: finish.json().revision,
    });
    assert.equal(confirmed.statusCode, 409, confirmed.body);
    assert.deepEqual(core.repo.list(), before);
  } finally {
    await core.app.close();
  }
});
