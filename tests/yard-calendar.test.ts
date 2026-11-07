import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pcmWav } from "@homestash/ai/speech";
import { createApp } from "../services/kitchen-core/src/app";
import { createDeviceServer } from "../services/kitchen-core/src/device-server";
import { yardCalendar } from "../services/kitchen-core/src/yard-calendar";
import { prepareYardChat } from "../services/kitchen-core/src/yard-chat";

test("家庭本地日期决定节气、农历节日和西方节日，设备复用当天招呼音频", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "yard-calendar-"));
  let now = new Date("2026-11-06T16:05:00Z");
  const core = createApp(join(dir, "db"), undefined, { now: () => now });
  let synthesis = 0;
  const device = createDeviceServer(
    core,
    {
      transcribe: async () => "",
      synthesize: async (line) => {
        assert.match(line, /立冬/);
        synthesis++;
        return pcmWav(Buffer.alloc(320));
      },
    },
    { mediaDir: dir },
  );
  try {
    assert.equal(core.yardCalendar().date, "2026-11-07");
    assert.deepEqual(core.yardCalendar().events, ["立冬"]);
    assert.ok(core.yardCalendar().validForMs() < 24 * 3600000);
    for (const [date, event] of [
      ["2026-02-16", "除夕"],
      ["2026-02-17", "春节"],
      ["2026-05-01", "劳动节"],
      ["2026-06-19", "端午节"],
      ["2026-09-25", "中秋节"],
      ["2026-12-25", "圣诞节"],
    ]) {
      assert.ok(
        yardCalendar(core.repo, new Date(date + "T04:00:00Z")).events.includes(
          event,
        ),
        event,
      );
    }
    core.repo.write("settings", {
      provider: {
        mode: "openai-compatible",
        baseUrl: "http://calendar.invalid",
        model: "calendar-test",
      },
    });
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (_url: string | URL | Request, options?: RequestInit) => {
        const prompt = JSON.parse(String(options?.body)).messages[0].content;
        assert.match(prompt, /2026-11-07.*00:05.*农历/u);
        assert.match(prompt, /今天的节日或节气：立冬/u);
        return Response.json({
          choices: [{ message: { content: "立冬了，煮碗热汤吧。" } }],
        });
      },
    );
    assert.equal(
      await prepareYardChat(core.repo, "今天吃什么", now),
      "立冬了，煮碗热汤吧。",
    );
    fetchMock.mock.restore();

    const registered = await core.app.inject({
      method: "POST",
      url: "/api/devices",
      payload: {
        id: "season-t5",
        name: "节气测试",
        boardId: "tuya-t5-ai-board-v1.02",
      },
    });
    const headers = {
      authorization: `Bearer ${registered.json().token}`,
      "x-device-id": "season-t5",
    };
    const settings = () =>
      device.inject({
        method: "GET",
        url: "/device/v1/yard/settings",
        headers,
      });
    const greeting = (await settings()).json().greeting;
    assert.match(greeting.text, /立冬/);
    const url = `/device/v1/yard/greeting/${greeting.key}`;
    for (const response of await Promise.all([
      device.inject({ method: "GET", url, headers }),
      device.inject({ method: "GET", url, headers }),
    ]))
      assert.equal(response.statusCode, 200, response.body);
    assert.equal(synthesis, 1);
    now = new Date("2026-11-07T16:00:00Z");
    assert.equal((await settings()).json().greeting, null);
    assert.equal(
      (await device.inject({ method: "GET", url, headers })).statusCode,
      404,
    );
  } finally {
    await device.close();
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
