import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createApp } from "../services/kitchen-core/src/app";
import { canonical } from "../services/kitchen-core/src/backups";

const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: object,
) => core.app.inject({ method: "POST", url, payload });
async function exported(core: ReturnType<typeof createApp>) {
  const r = await core.app.inject("/api/backups/export");
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.headers["content-disposition"] as string, /attachment/);
  return r.json();
}
async function preview(core: ReturnType<typeof createApp>, file: object) {
  const r = await post(core, "/api/backups/validate", file);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const sign = (file: Record<string, unknown>) => ({
  ...file,
  sha256: createHash("sha256").update(canonical(file.payload)).digest("hex"),
});

test("家庭备份往返完整事件、购物、候选与烹饪；设备和AI配置不导出不覆盖，恢复前快照可再恢复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-backup-"));
  let core = createApp(join(dir, "core.db"));
  try {
    const item = core.inventory.create({ name: "番茄", quantity: 4 });
    core.inventory.act(item.id, { type: "consume", quantity: 1 });
    const event = core.repo.events().at(-1)!;
    core.inventory.correct(item.id, {
      eventId: event.id,
      expectedVersion: 2,
      reason: "误点",
    });
    const shopping = (
      await post(core, "/api/shopping", {
        requestId: crypto.randomUUID(),
        action: "add",
        item: { name: "鸡蛋", quantity: 3, unit: "个" },
      })
    ).json()[0];
    await post(core, "/api/shopping", {
      requestId: crypto.randomUUID(),
      action: "check",
      id: shopping.id,
    });
    const receive = {
      requestId: crypto.randomUUID(),
      item: { name: "鸡蛋", quantity: 5, unit: "个" },
    };
    assert.equal(
      (await post(core, `/api/shopping/${shopping.id}/receive`, receive))
        .statusCode,
      200,
    );
    await post(core, "/api/intake/barcodes", {
      requestId: crypto.randomUUID(),
      barcode: "036000291452",
    });
    const cook = await post(core, "/api/cooking", {
      action: "start",
      recipeId: "tomato-eggs",
      people: 2,
      requestId: crypto.randomUUID(),
    });
    assert.equal(cook.statusCode, 200, cook.body);
    core.repo.write("settings", { private: "private-ai-config" });
    core.repo.write("managed-devices", [{ tokenHash: "private-token-hash" }]);
    core.repo.write("firmware-latest", { private: "firmware-marker" });
    await core.once("backup-device:retained", {}, async () => () => ({
      ok: true,
    }));
    const oldEpoch = (await core.app.inject("/api/state")).json().dataEpoch;
    const file = await exported(core);
    assert.equal(file.payload.items.length, 2);
    assert.ok(
      file.payload.state.some(
        (r: { id: string }) => r.id === "request:backup-device:retained",
      ),
    );
    assert.equal(file.payload.events.length, 4);
    assert.equal(JSON.stringify(file).includes("private-token-hash"), false);
    assert.equal(JSON.stringify(file).includes("private-ai-config"), false);
    assert.equal(JSON.stringify(file).includes("firmware-marker"), false);
    core.inventory.create({ name: "备份后的草莓", quantity: 1 });
    core.repo.write("settings", { private: "current-ai" });
    const p = await preview(core, file);
    assert.equal(p.items, 2);
    assert.equal(p.current.items, 3);
    const restore = {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: p.currentFingerprint,
      backup: file,
    };
    const r = await post(core, "/api/backups/restore", restore);
    assert.equal(r.statusCode, 200, r.body);
    const result = r.json();
    assert.equal(core.repo.list().length, 2);
    assert.equal(core.repo.events().length, 4);
    const epoch = (await core.app.inject("/api/state")).json().dataEpoch;
    assert.notEqual(epoch, oldEpoch);
    assert.equal(
      (
        await core.app.inject({
          method: "POST",
          url: `/api/items/${item.id}/actions`,
          headers: { "x-homestash-data-epoch": oldEpoch },
          payload: { type: "consume", quantity: "all", expectedVersion: 3 },
        })
      ).statusCode,
      409,
    );
    assert.equal(core.repo.events().length, 4);

    assert.equal(
      core.repo.read<{ private: string }>("settings", { private: "" }).private,
      "current-ai",
    );
    assert.equal(
      core.repo.read<{ tokenHash: string }[]>("managed-devices", [])[0]
        .tokenHash,
      "private-token-hash",
    );
    assert.equal(
      core.repo.read<{ receivedItem: { quantity: number } }[]>(
        "shopping",
        [],
      )[0].receivedItem.quantity,
      5,
    );
    assert.equal(
      core.repo.read<{ recipe: { id: string } }>("cooking", {
        recipe: { id: "" },
      }).recipe.id,
      "tomato-eggs",
    );
    const snapshot = await core.app.inject(
      `/api/backups/snapshots/${result.snapshotId}`,
    );
    assert.equal(snapshot.statusCode, 200);
    assert.equal(snapshot.json().payload.items.length, 3);
    assert.equal(
      (await core.app.inject("/api/backups/snapshots")).json().length,
      1,
    );
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    assert.equal(
      (await post(core, "/api/backups/restore", restore)).statusCode,
      200,
    );
    assert.equal((await readdir(join(dir, "backups"))).length, 1);
    assert.equal(
      (
        await post(core, `/api/shopping/${shopping.id}/receive`, {
          ...receive,
          requestId: crypto.randomUUID(),
        })
      ).statusCode,
      200,
    );
    assert.equal(core.repo.list().length, 2);
    const before = snapshot.json();
    const next = await preview(core, before);
    assert.equal(
      (
        await post(core, "/api/backups/restore", {
          requestId: crypto.randomUUID(),
          confirmation: "覆盖恢复",
          currentFingerprint: next.currentFingerprint,
          backup: before,
        })
      ).statusCode,
      200,
    );
    assert.equal(core.repo.list().length, 3);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("恢复拒绝损坏、未来版本、非法系统状态、断裂事件链和过时预览，不产生半次覆盖", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-backup-validation-"));
  const core = createApp(join(dir, "core.db"));
  try {
    core.inventory.create({ name: "牛奶", quantity: 2 });
    const file = await exported(core);
    const broken = structuredClone(file);
    broken.payload.items[0].quantity = 900;
    assert.equal(
      (await post(core, "/api/backups/validate", broken)).statusCode,
      409,
    );
    assert.equal(
      (await post(core, "/api/backups/validate", { ...file, version: 2 }))
        .statusCode,
      400,
    );
    assert.equal(
      (await post(core, "/api/backups/validate", sign(broken))).statusCode,
      409,
    );
    const unsafe = structuredClone(file);
    unsafe.payload.state.push({
      id: "settings",
      data: { provider: { baseUrl: "http://untrusted" } },
    });
    assert.equal(
      (await post(core, "/api/backups/validate", sign(unsafe))).statusCode,
      409,
    );
    const badRef = structuredClone(file);
    badRef.payload.events[0].itemId = crypto.randomUUID();
    assert.equal(
      (await post(core, "/api/backups/validate", sign(badRef))).statusCode,
      409,
    );
    const p = await preview(core, file);
    core.inventory.create({ name: "新买的纸巾", quantity: 1 });
    const request = {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: p.currentFingerprint,
      backup: file,
    };
    assert.equal(
      (await post(core, "/api/backups/restore", request)).statusCode,
      409,
    );
    assert.equal(core.repo.list().length, 2);
    assert.equal(
      (
        await post(core, "/api/backups/restore", {
          ...request,
          confirmation: "确认",
        })
      ).statusCode,
      400,
    );
    const valid = await preview(core, file);
    const write = core.repo.write.bind(core.repo);
    core.repo.write = (key, value) => {
      if (key === "backup-blocked-requests") throw Error("模拟恢复中断");
      write(key, value);
    };
    assert.equal(
      (
        await post(core, "/api/backups/restore", {
          ...request,
          currentFingerprint: valid.currentFingerprint,
        })
      ).statusCode,
      502,
    );
    assert.equal(core.repo.list().length, 2);
    assert.equal(core.repo.events().length, 2);
    core.repo.write = write;
    assert.equal(
      (await core.app.inject("/api/backups/snapshots")).json().length,
      1,
    );
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("恢复旧备份后拒绝旧请求再次入库，拦截恢复时排队的写入，跨重启仍有效", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hs-backup-replays-"));
  let core = createApp(join(dir, "core.db"));
  try {
    const file = await exported(core);
    const voice = { requestId: crypto.randomUUID(), text: "买了两个番茄" };
    assert.equal((await post(core, "/api/voice", voice)).statusCode, 200);
    const p = await preview(core, file);
    let queued: Promise<boolean> | undefined;
    const write = core.repo.write.bind(core.repo);
    core.repo.write = (key, value) => {
      write(key, value);
      if (key === "backup-blocked-requests")
        queued = core
          .once(
            "queued-before-restore-completes",
            {},
            async () => () => core.inventory.create({ name: "过时任务" }),
          )
          .then(
            () => false,
            () => true,
          );
    };
    const restoring = await post(core, "/api/backups/restore", {
      requestId: crypto.randomUUID(),
      confirmation: "覆盖恢复",
      currentFingerprint: p.currentFingerprint,
      backup: file,
    });
    assert.equal(restoring.statusCode, 200, restoring.body);
    assert.ok(queued);
    assert.equal(await queued, true);
    core.repo.write = write;
    assert.equal(core.repo.list().length, 0);
    assert.equal((await post(core, "/api/voice", voice)).statusCode, 409);
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    assert.equal((await post(core, "/api/voice", voice)).statusCode, 409);
    assert.equal(
      (
        await post(core, "/api/voice", {
          ...voice,
          requestId: crypto.randomUUID(),
        })
      ).statusCode,
      200,
    );
    assert.equal(core.repo.list().length, 1);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("备份接口遵守登录与同源限制；跨库恢复待确认图片，不导入设备绑定", async () => {
  const { passwordHash } = await import("../services/kitchen-core/src/auth");
  const previous = {
    enabled: process.env.INTERNAL_LOGIN_ENABLED,
    username: process.env.INTERNAL_LOGIN_USERNAME,
    hash: process.env.INTERNAL_LOGIN_PASSWORD_HASH,
    secret: process.env.INTERNAL_SESSION_SECRET,
  };
  const dir = await mkdtemp(join(tmpdir(), "hs-backup-auth-"));
  const mock = new (await import("@homestash/ai")).MockAIProvider();
  const source = createApp(join(dir, "source.db"), {
    kind: "test",
    structuredOutput: mock.structuredOutput.bind(mock),
    recognizeImage: async () => ({
      notes: "小票待确认",
      candidates: [
        {
          name: "牛奶",
          category: "food",
          quantity: 1,
          unit: "瓶",
          evidence: "小票1瓶",
          confidence: "high",
          bestBeforeAt: null,
          expiresAt: null,
        },
      ],
    }),
  });
  let target: ReturnType<typeof createApp> | undefined;
  try {
    const recognition = await post(source, "/api/intake/images", {
      requestId: crypto.randomUUID(),
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VBkAAAAASUVORK5CYII=",
    });
    assert.equal(recognition.statusCode, 200, recognition.body);
    const file = await exported(source);
    process.env.INTERNAL_LOGIN_ENABLED = "true";
    process.env.INTERNAL_LOGIN_USERNAME = "测试账户";
    process.env.INTERNAL_LOGIN_PASSWORD_HASH = passwordHash("测试口令");
    process.env.INTERNAL_SESSION_SECRET = "x".repeat(40);
    target = createApp(join(dir, "target.db"));
    assert.equal(
      (await target.app.inject("/api/backups/export")).statusCode,
      401,
    );
    assert.equal(
      (await post(target, "/api/backups/restore", {})).statusCode,
      401,
    );
    assert.equal(
      (await post(target, "/api/backups/validate", file)).statusCode,
      401,
    );
    const login = await post(target, "/api/auth/login", {
      username: "测试账户",
      password: "测试口令",
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    assert.equal(
      (
        await target.app.inject({
          url: "/api/backups/export",
          headers: { cookie, origin: "https://unknown.example" },
        })
      ).statusCode,
      403,
    );
    const validated = await target.app.inject({
      method: "POST",
      url: "/api/backups/validate",
      headers: { cookie },
      payload: file,
    });
    assert.equal(validated.statusCode, 200);
    const restored = await target.app.inject({
      method: "POST",
      url: "/api/backups/restore",
      headers: { cookie },
      payload: {
        requestId: crypto.randomUUID(),
        confirmation: "覆盖恢复",
        currentFingerprint: validated.json().currentFingerprint,
        backup: file,
      },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    const reviews = await target.app.inject({
      url: "/api/intake/reviews",
      headers: { cookie },
    });
    assert.equal(reviews.json()[0].title, "牛奶");
    assert.equal(reviews.json()[0].status, "pending");
    assert.deepEqual(target.devices.list(), []);
  } finally {
    await target?.app.close();
    await source.app.close();
    await rm(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      INTERNAL_LOGIN_ENABLED: previous.enabled,
      INTERNAL_LOGIN_USERNAME: previous.username,
      INTERNAL_LOGIN_PASSWORD_HASH: previous.hash,
      INTERNAL_SESSION_SECRET: previous.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
