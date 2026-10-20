import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../services/kitchen-core/src/app";

test("生产官网同源请求可访问库存，外部来源仍被拒绝", async () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://homestash.bebackpacker.com";
  const { app } = createApp(":memory:");
  try {
    for (const origin of [process.env.APP_ORIGIN, "http://127.0.0.1:3000"]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/state",
        headers: { origin },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(Array.isArray(response.json().items));
    }
    const response = await app.inject({
      method: "GET",
      url: "/api/state",
      headers: { origin: "https://other.example" },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});
