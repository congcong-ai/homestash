import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../services/kitchen-core/src/app";
import { ItemInput, freshness } from "@homestash/domain";
import { MockAIProvider, OpenAICompatibleProvider } from "@homestash/ai";
const post = (
  app: ReturnType<typeof createApp>["app"],
  url: string,
  payload: unknown,
) =>
  app.inject({
    method: "POST",
    url,
    payload: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
const event = (payload: unknown) => ({
  version: 1,
  eventId: crypto.randomUUID(),
  deviceId: "korvo-simulator",
  at: new Date().toISOString(),
  payload,
});
test("完整 Demo：文字入库、今天先吃、三道菜、烹饪与 LCD 同步、持久化", async () => {
  const dir = mkdtempSync(join(tmpdir(), "homestash-test-"));
  let core = createApp(join(dir, "test.db"));
  try {
    const r = await post(core.app, "/api/voice", {
      requestId: crypto.randomUUID(),
      text: "买了两个西红柿、一盒草莓和十个鸡蛋。",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(
      core.repo.list().map((i) => [i.name, i.quantity]),
      [
        ["番茄", 2],
        ["草莓", 1],
        ["鸡蛋", 10],
      ],
    );
    const state = (await core.app.inject("/api/state")).json();
    assert.equal(state.todayFirst[0].name, "草莓");
    assert.equal(state.recipes.length, 3);
    const dinner = (
      await post(core.app, "/api/voice", {
        requestId: crypto.randomUUID(),
        text: "今晚两个人吃什么？",
      })
    ).json();
    assert.equal(dinner.recipes.length, 3);
    assert.ok(dinner.recipes[0].used.length > 0);
    const start = await post(core.app, "/api/cooking", {
      action: "start",
      recipeId: "tomato-eggs",
    });
    assert.equal(start.statusCode, 200);
    await post(
      core.app,
      "/api/device/events",
      event({ type: "HEARTBEAT", battery: 80, wifi: true, online: true }),
    );
    const next = await post(
      core.app,
      "/api/device/events",
      event({ type: "BUTTON_PRESSED", button: "NEXT" }),
    );
    assert.equal(next.statusCode, 200);
    assert.match(next.json().device.screen, /第2步/);
    const previous = await post(core.app, "/api/cooking", {
      action: "previous",
    });
    assert.equal(previous.json().step, 0);
    const ask = await post(core.app, "/api/cooking", {
      action: "ask",
      question: "放多少？",
    });
    assert.match(ask.json().answer, /鸡蛋3个/);
    await core.app.close();
    core = createApp(join(dir, "test.db"));
    assert.equal(core.repo.list().length, 3);
    assert.equal(core.repo.events().length, 3);
    assert.equal(
      (await core.app.inject("/api/state")).json().cooking.recipe.id,
      "tomato-eggs",
    );
  } finally {
    await core.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("库存全部动作、负数和超量拒绝、独立家庭/位置及非 Food 类别", async () => {
  const { app, repo, inventory } = createApp(":memory:");
  try {
    const i = inventory.create({
      name: "维生素",
      category: "supplement",
      quantity: 10,
      unit: "粒",
      locationId: "medicine",
    });
    inventory.act(i.id, { type: "update", patch: { name: "维生素片" } });
    inventory.act(i.id, { type: "consume", quantity: 2 });
    inventory.act(i.id, { type: "move", locationId: "pantry" });
    inventory.act(i.id, { type: "open", date: "2026-10-17" });
    inventory.act(i.id, { type: "expire", date: "2026-10-16" });
    inventory.act(i.id, { type: "restock", quantity: 3 });
    assert.equal(repo.get(i.id)?.quantity, 11);
    assert.throws(() => inventory.act(i.id, { type: "consume", quantity: 12 }));
    assert.throws(() => inventory.act(i.id, { type: "consume", quantity: -1 }));
    assert.throws(() =>
      inventory.act(i.id, { type: "move", locationId: "missing" }),
    );
    inventory.act(i.id, { type: "discard", quantity: "all" });
    assert.equal(repo.get(i.id)?.quantity, 0);
    assert.equal(repo.events().length, 8);
    assert.equal((await app.inject("/api/state")).json().todayFirst.length, 0);
  } finally {
    await app.close();
  }
});
test("新鲜度边界与开封规则，过期食品不进入食谱", async () => {
  const { app, inventory } = createApp(":memory:");
  try {
    const i = inventory.create({ name: "番茄", expiresAt: "2026-10-16" });
    assert.equal(freshness(i, "2026-10-17"), "expired");
    assert.equal(
      freshness({ ...i, expiresAt: "2026-10-17" }, "2026-10-17"),
      "urgent",
    );
    assert.equal(
      freshness({ ...i, expiresAt: "2026-10-20" }, "2026-10-17"),
      "eat_soon",
    );
    assert.equal(
      freshness(
        { ...i, expiresAt: null, openedAt: "2026-10-15" },
        "2026-10-17",
      ),
      "urgent",
    );
    assert.equal(
      freshness(
        { ...i, category: "medicine", expiresAt: null, openedAt: "2026-10-15" },
        "2026-10-17",
      ),
      "fresh",
    );
    const r = (await app.inject("/api/state")).json().recipes;
    assert.ok(r.every((r: { used: string[] }) => !r.used.includes("番茄")));
  } finally {
    await app.close();
  }
});
test("意图幂等并发、重复 ID 冲突、批量异常全部回滚", async () => {
  const core = createApp(":memory:");
  try {
    const b = { requestId: crypto.randomUUID(), text: "买了两个番茄" };
    const results = await Promise.all([
      post(core.app, "/api/voice", b),
      post(core.app, "/api/voice", b),
    ]);
    assert.equal(results[0].body, results[1].body);
    assert.equal(core.repo.list().length, 1);
    assert.equal(
      (await post(core.app, "/api/voice", { ...b, text: "买了十个鸡蛋" }))
        .statusCode,
      409,
    );
  } finally {
    await core.app.close();
  }
  const failing = createApp(":memory:", {
    kind: "mock",
    async structuredOutput() {
      return {
        intent: "add_items",
        items: [
          ItemInput.parse({ name: "番茄" }),
          ItemInput.parse({ name: "鸡蛋", locationId: "invalid" }),
        ],
      };
    },
  });
  try {
    assert.equal(
      (
        await post(failing.app, "/api/voice", {
          requestId: crypto.randomUUID(),
          text: "任意输入",
        })
      ).statusCode,
      409,
    );
    assert.equal(failing.repo.list().length, 0);
    assert.equal(failing.repo.events().length, 0);
  } finally {
    await failing.app.close();
  }
});
test("模拟器离线、Wi-Fi、电量、Camera 不伪造库存、心跳过期和深睡眠", async () => {
  const { app, repo } = createApp(":memory:");
  try {
    assert.equal(
      (
        await post(
          app,
          "/api/device/events",
          event({ type: "BUTTON_PRESSED", button: "SET" }),
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await post(
          app,
          "/api/device/events",
          event({ type: "HEARTBEAT", battery: 101, wifi: true, online: true }),
        )
      ).statusCode,
      400,
    );
    await post(
      app,
      "/api/device/events",
      event({ type: "HEARTBEAT", battery: 50, wifi: true, online: true }),
    );
    const camera = event({
      type: "CAMERA_CAPTURED",
      simulated: true,
      width: 1280,
      height: 720,
      mime: "image/jpeg",
    });
    await post(app, "/api/device/events", camera);
    await post(app, "/api/device/events", camera);
    assert.equal((await app.inject("/api/state")).json().device.cameraCount, 1);
    assert.equal(repo.list().length, 0);
    await post(
      app,
      "/api/device/events",
      event({ type: "POWER_CHANGED", mode: "deep_sleep" }),
    );
    assert.equal(
      (
        await post(
          app,
          "/api/device/events",
          event({
            type: "VOICE_CAPTURED",
            text: "买了两个番茄",
            simulated: true,
          }),
        )
      ).statusCode,
      409,
    );
    assert.equal(repo.list().length, 0);
    const state = (await app.inject("/api/state")).json();
    repo.write("device", { ...state.device, lastSeen: "2000-01-01T00:00:00Z" });
    assert.equal((await app.inject("/api/state")).json().device.online, false);
  } finally {
    await app.close();
  }
});
test("Mock 解析与人格、同名批次歧义、未知输入不写库", async () => {
  const parser = new MockAIProvider();
  assert.equal(
    (await parser.structuredOutput("牛奶喝完了。")).intent,
    "consume_item",
  );
  assert.equal(
    (await parser.structuredOutput("给我开什么药")).intent,
    "unknown",
  );
  const { app, repo, inventory } = createApp(":memory:");
  try {
    const s = (await app.inject("/api/state")).json().settings;
    await post(app, "/api/settings", { persona: "cat", provider: s.provider });
    const r = await post(app, "/api/voice", {
      requestId: crypto.randomUUID(),
      text: "买了十个鸡蛋",
    });
    assert.match(r.json().message, /喵/);
    inventory.create({ name: "鸡蛋" });
    assert.equal(
      (
        await post(app, "/api/voice", {
          requestId: crypto.randomUUID(),
          text: "鸡蛋吃完了",
        })
      ).statusCode,
      409,
    );
    assert.equal(repo.list().length, 2);
    assert.equal(
      (
        await app.inject({
          url: "/api/state",
          headers: { origin: "https://evil.example" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});
test("真实 HTTP OpenAI-compatible adapter：结构化输出和错误拒绝", async () => {
  let bad = false;
  let received = "";
  const server = createServer((req, res) => {
    req.on("data", (c) => (received += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: bad
                  ? "invalid"
                  : JSON.stringify({
                      intent: "consume_item",
                      name: "牛奶",
                      quantity: "all",
                    }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const provider = new OpenAICompatibleProvider(
      {
        mode: "openai-compatible",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test",
      },
      "",
    );
    assert.equal(
      (await provider.structuredOutput("牛奶喝完了", "gentle")).intent,
      "consume_item",
    );
    assert.match(received, /温柔/);
    bad = true;
    await assert.rejects(provider.structuredOutput("买了鸡蛋", "default"));
  } finally {
    server.close();
  }
});

test("幂等回执与库存原子提交：模拟回执写失败必须回滚，重启重放不重复", async () => {
  const dir = mkdtempSync(join(tmpdir(), "homestash-atomic-"));
  let core = createApp(join(dir, "test.db"));
  const payload = { requestId: crypto.randomUUID(), text: "买了两个番茄" };
  try {
    const original = core.repo.write.bind(core.repo);
    core.repo.write = (id, value) => {
      if (id.startsWith("request:")) throw new Error("模拟磁盘提交失败");
      original(id, value);
    };
    assert.equal((await post(core.app, "/api/voice", payload)).statusCode, 502);
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    core.repo.write = original;
    const success = await post(core.app, "/api/voice", payload);
    assert.equal(success.statusCode, 200);
    await core.app.close();
    core = createApp(join(dir, "test.db"));
    assert.equal(
      (await post(core.app, "/api/voice", payload)).body,
      success.body,
    );
    assert.equal(core.repo.list().length, 1);
    assert.equal(core.repo.events().length, 1);
  } finally {
    await core.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
