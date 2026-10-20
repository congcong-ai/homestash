import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { MockAIProvider } from "@homestash/ai";
import { pcmWav } from "@homestash/ai/speech";
const post = (
  core: ReturnType<typeof createApp>,
  url: string,
  payload: unknown,
) => core.app.inject({ method: "POST", url, payload: payload as object });
const voice = (
  core: ReturnType<typeof createApp>,
  text: string,
  requestId = crypto.randomUUID(),
) => post(core, "/api/voice", { text, requestId });
test("语音查询库存、临期和数量位置只读数据库，不把已过期物品推荐食用", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  try {
    core.inventory.create({ name: "番茄", quantity: 3, unit: "个" });
    core.inventory.create({
      name: "草莓",
      quantity: 1,
      unit: "盒",
      bestBeforeAt: new Date().toISOString().slice(0, 10),
    });
    core.inventory.create({
      name: "牛奶",
      quantity: 1,
      unit: "瓶",
      expiresAt: "2000-01-01",
    });
    const items = core.repo.list(),
      events = core.repo.events();
    const all = await voice(core, "家里有什么");
    assert.equal(all.statusCode, 200);
    assert.equal(all.json().items.length, 3);
    const urgent = (await voice(core, "今天先吃什么")).json();
    assert.equal(urgent.items.length, 1);
    assert.equal(urgent.items[0].name, "草莓");
    assert.match(urgent.message, /另有1批日期已过/);
    assert.equal(
      (await voice(core, "什么过期了")).json().items[0].name,
      "牛奶",
    );
    assert.match(
      (await voice(core, "西红柿还有多少")).json().message,
      /番茄3个/,
    );
    assert.match((await voice(core, "菠菜还有吗")).json().message, /没有找到/);
    assert.deepEqual(core.repo.list(), items);
    assert.deepEqual(core.repo.events(), events);
  } finally {
    await core.app.close();
  }
});
test("语音开封、移动、定量消耗和丢弃复用库存事件，歧义、单位不符及超量不修改", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  try {
    const milk = core.inventory.create({
      name: "牛奶",
      quantity: 1,
      unit: "瓶",
    });
    const tomato = core.inventory.create({
      name: "番茄",
      quantity: 5,
      unit: "个",
    });
    assert.match((await voice(core, "牛奶开封了")).json().message, /已记录/);
    assert.ok(core.repo.get(milk.id)?.openedAt);
    const id = crypto.randomUUID();
    await voice(core, "把牛奶放到冷冻室", id);
    await voice(core, "把牛奶放到冷冻室", id);
    assert.equal(core.repo.get(milk.id)?.locationId, "freezer");
    assert.equal(core.repo.get(milk.id)?.version, 3);
    await voice(core, "吃了两个番茄");
    assert.equal(core.repo.get(tomato.id)?.quantity, 3);
    const baseline = core.repo.list(),
      events = core.repo.events();
    assert.match(
      (await voice(core, "吃了十个番茄")).json().message,
      /数量超过/,
    );
    assert.match((await voice(core, "用了十克番茄")).json().message, /单位/);
    assert.deepEqual(core.repo.list(), baseline);
    assert.deepEqual(core.repo.events(), events);
    core.inventory.create({ name: "牛奶", quantity: 1, unit: "瓶" });
    const before = core.repo.events().length;
    assert.match((await voice(core, "牛奶扔掉了")).json().message, /具体批次/);
    assert.equal(core.repo.events().length, before);
    await voice(core, "番茄扔掉了");
    assert.equal(core.repo.get(tomato.id)?.quantity, 0);
    assert.equal(core.repo.events().at(-1)?.type, "ITEM_DISCARDED");
  } finally {
    await core.app.close();
  }
});
test("食谱缺货先查询再加入购物清单，重放不重复、买到不自动入库、跨重启持久化", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-shopping-"));
  const path = join(dir, "core.db");
  let core = createApp(path, new MockAIProvider());
  try {
    core.inventory.create({ name: "番茄", quantity: 1, unit: "个" });
    core.inventory.create({ name: "鸡蛋", quantity: 1, unit: "个" });
    const baseline = core.repo.list();
    const missing = await voice(core, "做番茄炒蛋缺什么");
    assert.match(missing.json().message, /番茄1个、鸡蛋2个/);
    assert.equal((await core.app.inject("/api/shopping")).json().length, 0);
    const payload = {
      action: "from_recipe",
      recipeId: "tomato-eggs",
      people: 2,
      requestId: crypto.randomUUID(),
    };
    const first = (await post(core, "/api/shopping", payload)).json();
    assert.equal(first.length, 2);
    assert.deepEqual(
      (await post(core, "/api/shopping", payload)).json(),
      first,
    );
    assert.equal(
      (
        await post(core, "/api/shopping", {
          ...payload,
          requestId: crypto.randomUUID(),
        })
      ).json().length,
      2,
    );
    const manualId = crypto.randomUUID();
    await voice(core, "购物清单加一瓶牛奶", manualId);
    await voice(core, "购物清单加一瓶牛奶", manualId);
    assert.match((await voice(core, "看看购物清单")).json().message, /牛奶1瓶/);
    await voice(core, "牛奶买到了");
    assert.doesNotMatch(
      (await voice(core, "看看购物清单")).json().message,
      /牛奶/,
    );
    assert.deepEqual(core.repo.list(), baseline);
    await core.app.close();
    core = createApp(path, new MockAIProvider());
    const shopping = (await core.app.inject("/api/shopping")).json();
    assert.equal(shopping.length, 3);
    assert.equal(
      shopping.find((i: { name: string }) => i.name === "牛奶").checked,
      true,
    );
    await post(core, "/api/shopping", {
      action: "remove",
      id: shopping[0].id,
      requestId: crypto.randomUUID(),
    });
    assert.equal((await core.app.inject("/api/shopping")).json().length, 2);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("新库存入口沿用真实设备鉴权、录音去重与回复音频接口", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  let text = "家里有什么",
    stt = 0;
  const wav = pcmWav(Buffer.alloc(32000));
  const dir = await mkdtemp(join(tmpdir(), "homestash-query-device-"));
  const device = createDeviceServer(
    core,
    {
      async transcribe() {
        stt++;
        return text;
      },
      async synthesize() {
        return wav;
      },
    },
    { token: "i".repeat(32), deviceId: "inventory-korvo", mediaDir: dir },
  );
  const headers = {
    authorization: `Bearer ${"i".repeat(32)}`,
    "x-device-id": "inventory-korvo",
    "content-type": "audio/wav",
  };
  const upload = (id: string) =>
    device.inject({
      method: "POST",
      url: `/device/v1/captures/${id}`,
      headers,
      payload: wav,
    });
  try {
    const item = core.inventory.create({
      name: "牛奶",
      quantity: 1,
      unit: "瓶",
    });
    let id = crypto.randomUUID();
    assert.match((await upload(id)).json().message, /牛奶1瓶/);
    text = "牛奶开封了";
    id = crypto.randomUUID();
    await upload(id);
    const result = await upload(id);
    assert.equal(stt, 2);
    assert.equal(core.repo.get(item.id)?.version, 2);
    assert.match(result.json().message, /开封/);
    assert.equal(
      (
        await device.inject({
          method: "GET",
          url: `/device/v1/captures/${id}/audio`,
          headers,
        })
      ).statusCode,
      200,
    );
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
