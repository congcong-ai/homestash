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
function stock(core: ReturnType<typeof createApp>) {
  const a = core.inventory.create({
    name: "番茄",
    quantity: 1,
    unit: "个",
    bestBeforeAt: "2099-01-01",
  });
  const b = core.inventory.create({
    name: "番茄",
    quantity: 4,
    unit: "个",
    bestBeforeAt: "2099-02-01",
  });
  const egg = core.inventory.create({ name: "鸡蛋", quantity: 10, unit: "个" });
  return { a, b, egg };
}
test("设备烹饪：人数承接、步骤与重复播报、问答、重启重试不前进两次、确认后只扣一次", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-cooking-"));
  const path = join(dir, "core.db");
  let core = createApp(path, new MockAIProvider());
  const { a, b, egg } = stock(core);
  const wav = pcmWav(Buffer.alloc(32000));
  let utterance = "今晚四个人吃什么",
    stt = 0;
  const speech = {
    async transcribe() {
      stt++;
      return utterance;
    },
    async synthesize() {
      return wav;
    },
  };
  const options = {
    token: "c".repeat(32),
    deviceId: "cooking-korvo",
    mediaDir: join(dir, "media"),
  };
  let device = createDeviceServer(core, speech, options);
  const headers = {
    authorization: `Bearer ${options.token}`,
    "x-device-id": options.deviceId,
    "content-type": "audio/wav",
  };
  const upload = (id = crypto.randomUUID()) =>
    device.inject({
      method: "POST",
      url: `/device/v1/captures/${id}`,
      headers,
      payload: wav,
    });
  try {
    assert.equal((await upload()).statusCode, 200);
    utterance = "开始做番茄炒蛋";
    const start = (await upload()).json();
    assert.match(start.message, /番茄炒蛋.*第1步/);
    assert.equal(
      core.repo.read<{ recipe: { people: number } }>("cooking", {
        recipe: { people: 0 },
      }).recipe.people,
      4,
    );
    utterance = "下一步";
    const nextId = crypto.randomUUID();
    const next = await upload(nextId);
    assert.match(next.json().message, /第2步/);
    const count = stt;
    await device.close();
    await core.app.close();
    core = createApp(path, new MockAIProvider());
    device = createDeviceServer(core, speech, options);
    assert.deepEqual((await upload(nextId)).json(), next.json());
    assert.equal(stt, count);
    utterance = "再说一遍";
    assert.match((await upload()).json().message, /第2步/);
    utterance = "放多少";
    assert.match((await upload()).json().message, /鸡蛋6个/);
    utterance = "上一步";
    assert.match((await upload()).json().message, /第1步/);
    utterance = "做完了";
    assert.match((await upload()).json().message, /确认扣减/);
    assert.equal(core.repo.get(a.id)?.quantity, 1);
    assert.equal(core.repo.events().length, 3);
    utterance = "确认扣减";
    const confirmId = crypto.randomUUID();
    const confirmed = await upload(confirmId);
    assert.match(confirmed.json().message, /已完成.*扣减/);
    assert.equal(core.repo.get(a.id)?.quantity, 0);
    assert.equal(core.repo.get(b.id)?.quantity, 1);
    assert.equal(core.repo.get(egg.id)?.quantity, 4);
    assert.equal(core.repo.events().length, 6);
    assert.deepEqual((await upload(confirmId)).json(), confirmed.json());
    // 另一个录音 ID 重复确认已完成任务也不能再次扣减。
    assert.match((await upload()).json().message, /已完成/);
    assert.equal(core.repo.events().length, 6);
    const audio = await device.inject({
      method: "GET",
      url: `/device/v1/captures/${confirmId}/audio`,
      headers,
    });
    assert.deepEqual(audio.rawPayload, wav);
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("库存扣减拒绝过期、非食品及单位不匹配；不扣减保留所有库存", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  try {
    core.inventory.create({
      name: "番茄",
      quantity: 10,
      unit: "个",
      expiresAt: "2000-01-01",
    });
    core.inventory.create({
      name: "番茄",
      quantity: 10,
      unit: "个",
      category: "other",
    });
    core.inventory.create({ name: "番茄", quantity: 1000, unit: "克" });
    core.inventory.create({ name: "鸡蛋", quantity: 10, unit: "个" });
    await voice(core, "开始做番茄炒蛋");
    const baseline = core.repo.list();
    const finish = await voice(core, "做完了");
    assert.match(finish.json().message, /番茄缺2个/);
    const blocked = await voice(core, "确认扣减");
    assert.equal(blocked.statusCode, 200);
    assert.match(blocked.json().message, /未扣减/);
    assert.deepEqual(core.repo.list(), baseline);
    const skip = await voice(core, "不扣减");
    assert.match(skip.json().message, /库存未扣减/);
    assert.deepEqual(core.repo.list(), baseline);
  } finally {
    await core.app.close();
  }
});
test("确认绑定批次版本与任务 ID，已变化批次不得静默替换；扣减失败整笔回滚", async () => {
  const core = createApp(":memory:", new MockAIProvider());
  try {
    const { a } = stock(core);
    const start = await post(core, "/api/cooking", {
      action: "start",
      recipeId: "tomato-eggs",
    });
    const sessionId = start.json().id;
    const confirm = (override: Record<string, unknown> = {}) =>
      post(core, "/api/cooking", {
        action: "confirm_consumption",
        sessionId,
        revision: core.repo.read<{ revision: number }>("cooking", {
          revision: 0,
        }).revision,
        ...override,
      });
    await post(core, "/api/cooking", { action: "finish", sessionId });
    core.inventory.act(a.id, { type: "move", locationId: "pantry" });
    const baseline = core.repo.list();
    assert.equal((await confirm()).statusCode, 409);
    assert.deepEqual(core.repo.list(), baseline);
    assert.equal(
      (await confirm({ sessionId: crypto.randomUUID() })).statusCode,
      409,
    );
    await post(core, "/api/cooking", { action: "finish", sessionId });
    const previousRevision = core.repo.read<{ revision: number }>("cooking", {
      revision: 0,
    }).revision;
    await post(core, "/api/cooking", { action: "finish", sessionId });
    assert.equal(
      (await confirm({ revision: previousRevision })).statusCode,
      409,
    );
    const events = core.repo.events();
    const save = core.repo.save.bind(core.repo);
    let n = 0;
    core.repo.save = (...args) => {
      if (++n === 2) throw new Error("模拟第二批写入失败");
      save(...args);
    };
    const failed = await confirm();
    assert.equal(failed.statusCode, 502);
    assert.deepEqual(core.repo.list(), baseline);
    assert.deepEqual(core.repo.events(), events);
    core.repo.save = save;
    assert.equal(
      (await confirm({ requestId: crypto.randomUUID() })).statusCode,
      200,
    );
  } finally {
    await core.app.close();
  }
});
test("不明确的确认即使被模型误判也不能扣减；过时的异步语音不能操作新任务", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mock = new MockAIProvider();
  const core = createApp(":memory:", {
    kind: "test",
    async structuredOutput(text) {
      if (text === "好的")
        return { intent: "cooking", action: "confirm_consumption" };
      if (text === "下一步" && ++calls === 1) await ready;
      return mock.structuredOutput(text);
    },
  });
  try {
    stock(core);
    await voice(core, "开始做番茄炒蛋");
    await voice(core, "做完了");
    const before = core.repo.list();
    assert.match((await voice(core, "好的")).json().message, /明确说/);
    assert.deepEqual(core.repo.list(), before);
    const pending = core.prepareVoice("下一步");
    await post(core, "/api/cooking", {
      action: "start",
      recipeId: "tomato-soup",
    });
    release!();
    const commit = await pending;
    const reply = core.repo.transaction(commit);
    assert.match(reply.message, /任务已变化/);
    assert.equal(
      core.repo.read<{ step: number }>("cooking", { step: -1 }).step,
      0,
    );
    assert.deepEqual(core.repo.list(), before);
  } finally {
    release?.();
    await core.app.close();
  }
});
