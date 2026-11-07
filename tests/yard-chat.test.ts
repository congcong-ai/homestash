import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../services/kitchen-core/src/app";

test("网页和设备共享自由聊天，传递上下文，重试不重复生成，规则和许可优先", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yard-chat-"));
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                calls.length === 1
                  ? "葡萄来啦！你买的是紫葡萄还是青葡萄呀？"
                  : "青葡萄呀！打算洗好直接吃吗？",
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const core = createApp(join(dir, "test.db"));
  core.repo.write("settings", {
    provider: {
      mode: "openai-compatible",
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: "fixture",
    },
  });
  const post = (text: string, requestId = crypto.randomUUID()) =>
    core.app.inject({
      method: "POST",
      url: "/api/yard/interactions",
      payload: { text, requestId, simulated: true },
    });
  try {
    const id = crypto.randomUUID();
    const first = await post("今天买了葡萄", id);
    assert.equal(first.statusCode, 200);
    assert.match(first.json().reply, /葡萄/);
    assert.equal(
      (await post("今天买了葡萄", id)).json().reply,
      first.json().reply,
    );
    assert.equal(calls.length, 1);
    const commit = await core.prepareYardVoice(crypto.randomUUID(), "青葡萄");
    const second = commit();
    assert.match(second.reply, /青葡萄/);
    assert.equal(second.simulated, false);
    assert.ok(calls[1].messages.some((m) => m.content === "今天买了葡萄"));
    assert.ok(calls[1].messages.some((m) => m.content === first.json().reply));
    await post("小院故事");
    await post("拍一张");
    assert.equal(calls.length, 2);
    assert.equal((await post("你好小冰")).json().reply,"我在，你说。");
    assert.equal((await post("谢谢你")).json().reply,"不客气。");
    assert.equal((await post("拜拜")).json().reply,"好，回头聊。");
    assert.equal(calls.length, 2);
    assert.equal(
      core.repo.sqlite.prepare("SELECT * FROM inventory_items").all().length,
      0,
    );
    await writeFile(
      join(dir, "result.json"),
      JSON.stringify({ first: first.json().reply, second: second.reply }),
    );
    core.repo.write("settings", {
      provider: { mode: "mock", baseUrl: "", model: "" },
    });
    assert.match((await post("今天买了葡萄")).json().reply, /买了葡萄/);
    core.repo.write("settings", {
      provider: {
        mode: "openai-compatible",
        baseUrl: `http://127.0.0.1:${address.port}`,
        model: "fixture",
      },
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match((await post("今天好开心")).json().reply, /没连上聊天服务/);
  } finally {
    server.close();
    await core.app.close();
    core.repo.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
