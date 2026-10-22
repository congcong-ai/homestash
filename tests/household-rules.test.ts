import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import {
  freshnessInfo,
  ItemInput,
  InventoryService,
  LocationService,
} from "@homestash/domain";
import { SQLiteRepository } from "@homestash/database";
import { recommend } from "@homestash/recipes";
import { passwordHash } from "../services/kitchen-core/src/auth";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: unknown,
  headers = {},
) =>
  core.app.inject({ method: "POST", url, payload: payload as object, headers });

test("位置新增重放、重命名冲突与重复名校验；自定义位置可语音移动且历史引用保持", async () => {
  const core = createApp(":memory:");
  try {
    const body = {
      requestId: crypto.randomUUID(),
      action: "create",
      name: "阳台储物柜",
    };
    const first = await post(core, "/api/locations", body);
    assert.equal(first.statusCode, 200);
    const location = first.json();
    assert.deepEqual(
      (await post(core, "/api/locations", body)).json(),
      location,
    );
    assert.equal(
      (
        await post(core, "/api/locations", {
          ...body,
          requestId: crypto.randomUUID(),
        })
      ).statusCode,
      409,
    );
    const milk = core.inventory.create({
      name: "牛奶",
      quantity: 2,
      unit: "瓶",
    });
    const move = await post(core, "/api/voice", {
      requestId: crypto.randomUUID(),
      text: "把牛奶移到阳台储物柜",
    });
    assert.equal(move.statusCode, 200, move.body);
    assert.equal(core.repo.get(milk.id)?.locationId, location.id);
    const rename = {
      requestId: crypto.randomUUID(),
      action: "rename",
      id: location.id,
      expectedName: location.name,
      name: "客厅储物柜",
    };
    assert.equal((await post(core, "/api/locations", rename)).statusCode, 200);
    assert.equal(
      (
        await post(core, "/api/locations", {
          ...rename,
          requestId: crypto.randomUUID(),
          name: "过时名称",
        })
      ).statusCode,
      409,
    );
    assert.equal(core.repo.get(milk.id)?.locationId, location.id);
    assert.equal(core.repo.events().at(-1)?.after.locationId, location.id);
    const count = core.repo.locations().length;
    assert.equal(
      (
        await post(core, "/api/locations", {
          requestId: crypto.randomUUID(),
          action: "create",
          name: "客厅储物柜 ",
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await post(core, "/api/locations", { ...body, name: "不同内容" }))
        .statusCode,
      409,
    );
    assert.equal(core.repo.locations().length, count);
  } finally {
    await core.app.close();
  }
});

test("开封提醒按批次自定义、关闭及恢复默认；日期取最早，非食品不隐式套用食品规则", () => {
  const base = ItemInput.parse({
    name: "番茄",
    openedAt: "2026-10-20",
    expiresAt: "2026-11-20",
  });
  assert.equal(freshnessInfo(base, "2026-10-23").status, "expired");
  assert.equal(
    freshnessInfo({ ...base, openedReminderDays: 7 }, "2026-10-23").deadline,
    "2026-10-27",
  );
  assert.equal(
    freshnessInfo({ ...base, openedReminderDays: 7, expiresAt: "2026-10-21" })
      .deadline,
    "2026-10-21",
  );
  assert.equal(
    freshnessInfo({ ...base, openedReminderDays: null }).deadline,
    "2026-11-20",
  );
  assert.equal(
    freshnessInfo({ ...base, openedReminderDays: 0 }).deadline,
    "2026-10-20",
  );
  assert.equal(
    freshnessInfo({ ...base, openedReminderDays: "default" }).deadline,
    "2026-10-22",
  );
  assert.equal(
    freshnessInfo({ ...base, category: "cosmetic" }).deadline,
    "2026-11-20",
  );
  assert.equal(
    freshnessInfo({ ...base, category: "cosmetic", openedReminderDays: 5 })
      .deadline,
    "2026-10-25",
  );
  for (const days of [-1, 1.5, 3651])
    assert.equal(
      ItemInput.safeParse({ ...base, openedReminderDays: days }).success,
      false,
    );
  const repo = new SQLiteRepository(":memory:");
  try {
    const service = new InventoryService(repo);
    const item = service.create({ ...base, openedReminderDays: 7 });
    service.act(
      item.id,
      { type: "update", patch: { openedReminderDays: null } },
      1,
    );
    const event = repo.events().at(-1)!;
    const corrected = service.correct(item.id, {
      eventId: event.id,
      expectedVersion: 2,
      reason: "误关提醒",
    });
    assert.equal(corrected.openedReminderDays, 7);
    assert.equal(item.openedReminderDays, 7);
    const tomato = service.create({
      name: "番茄",
      quantity: 2,
      unit: "个",
      openedAt: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
    });
    assert.equal(
      recommend([repo.get(tomato.id)!])
        .find((r) => r.id === "tomato-eggs")
        ?.used.includes("番茄"),
      false,
    );
    service.act(
      tomato.id,
      { type: "update", patch: { openedReminderDays: 7 } },
      1,
    );
    assert.equal(
      recommend([repo.get(tomato.id)!])
        .find((r) => r.id === "tomato-eggs")
        ?.used.includes("番茄"),
      true,
    );
  } finally {
    repo.close();
  }
});

test("自定义位置与开封规则跨重启及备份恢复保留；旧数据不强制增加字段", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-household-"));
  let core = createApp(join(dir, "core.db"));
  try {
    const loc = new LocationService(core.repo).act({
      action: "create",
      name: "宠物用品柜",
    });
    const old = core.inventory.create({ name: "旧批次" });
    const item = core.inventory.create({
      name: "宠物粮",
      category: "pet_food",
      locationId: loc.id,
      openedAt: "2026-10-20",
      openedReminderDays: 30,
    });
    const file = (await core.app.inject("/api/backups/export")).json();
    assert.equal(
      (await post(core, "/api/backups/validate", file)).statusCode,
      200,
    );
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    assert.equal(core.repo.get(item.id)?.openedReminderDays, 30);
    assert.ok(core.repo.locations().some((l) => l.id === loc.id));
    assert.equal(
      Object.hasOwn(core.repo.get(old.id)!, "openedReminderDays"),
      false,
    );
    core.inventory.act(item.id, {
      type: "update",
      patch: { openedReminderDays: null },
    });
    const preview = (await post(core, "/api/backups/validate", file)).json();
    const restored = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: preview.currentFingerprint,
      backup: file,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(core.repo.get(item.id)?.openedReminderDays, 30);
    assert.ok(core.repo.locations().some((l) => l.id === loc.id));
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("位置管理沿用登录和来源保护", async () => {
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
    const body = {
      action: "create",
      name: "私有柜子",
      requestId: crypto.randomUUID(),
    };
    assert.equal((await post(core, "/api/locations", body)).statusCode, 401);
    const login = await post(core, "/api/auth/login", {
      username: "owner",
      password: "测试口令",
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    assert.equal(
      (
        await post(core, "/api/locations", body, {
          cookie,
          origin: "http://untrusted.invalid",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await post(core, "/api/locations", body, {
          cookie,
          origin: process.env.APP_ORIGIN!,
        })
      ).statusCode,
      200,
    );
  } finally {
    await core.app.close();
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
