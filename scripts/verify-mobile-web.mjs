import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { resolve, relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
const { values } = parseArgs({
  options: {
    url: { type: "string" },
    credentials: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.url || !values.credentials || !values.output)
  throw Error(
    "必须指定 --url、--credentials、--output；只允许空的Mock临时测试库",
  );
const base = new URL(values.url).origin;
if (new URL(base).protocol !== "http:") throw Error("此专项用于验证HTTP局域网");
const credentialPath = resolve(values.credentials),
  artifacts = resolve(values.output);
const relativeCredential = relative(resolve(tmpdir()), credentialPath);
if (relativeCredential.startsWith("..") || isAbsolute(relativeCredential))
  throw Error("凭据必须来自系统临时目录中的独立测试环境，拒绝日常凭据");
const access = await readFile(credentialPath, "utf8");
const username = access.match(/账号：(.+)/)?.[1],
  password = access.match(/密码：(.+)/)?.[1];
if (!username || !password) throw Error("测试凭据格式不正确");
const itemName = "手机验收牛奶";
await mkdir(artifacts, { recursive: true });
const report = {
  日期: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  ),
  环境: "Chrome无头浏览器，独立临时SQLite，Mock Provider，真实HTTP局域网",
  真机: "按用户要求跳过，不代表真机验收",
  检查: [],
  截图: [],
  浏览器错误: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-proxy-server"],
});
report.浏览器版本 = browser.version();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", (e) => report.浏览器错误.push(e.message));
page.setDefaultTimeout(12000);
async function shot(name) {
  await page.screenshot({
    path: artifacts + "/" + name + ".png",
    fullPage: true,
  });
  report.截图.push(name + ".png");
}
async function fits(name) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const data = await page.evaluate(() => ({
    viewport: innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  report.检查.push({ 检查: name, ...data });
  assert.ok(
    data.page <= page.viewportSize().width &&
      data.viewport === page.viewportSize().width,
    `${name}水平溢出：${JSON.stringify(data)}`,
  );
}
async function tab(name) {
  await page.locator("nav").getByRole("button", { name, exact: false }).click();
  await page
    .locator("header")
    .filter({ hasText: "我的家 / " + name })
    .waitFor();
}
try {
  await page.goto(base + "/login");
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(`${width} 登录页`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await fits("390登录页");
  assert.equal(await page.getByLabel("密码", { exact: true }).inputValue(), "");
  await shot("login-390");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("错误测试密码");
  await page.getByRole("button", { name: "进入我的厨房" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "用户名或密码不正确" })
    .waitFor();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入我的厨房" }).click();
  await page.locator("nav").waitFor();
  const initialResponse = await context.request.get(base + "/api/state");
  assert.equal(initialResponse.status(), 200);
  const initial = await initialResponse.json();
  assert.equal(initial.items.length, 0, "只允许空临时库存");
  assert.equal(initial.shopping.length, 0, "只允许空临时清单");
  assert.equal(initial.cooking, null, "只允许空临时烹饪状态");
  assert.equal(
    initial.settings.provider.mode,
    "mock",
    "只允许Mock临时Provider",
  );
  assert.equal(await page.evaluate(() => isSecureContext), false);
  report.检查.push({
    检查: "错误密码拒绝、正确密码登录；非安全HTTP环境",
    结果: "通过",
  });
  await tab("购物清单");
  await page.getByLabel("物品", { exact: true }).fill(itemName);
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page.getByLabel("单位", { exact: true }).fill("瓶");
  await page.getByRole("button", { name: "加入清单", exact: true }).click();
  await page.getByRole("checkbox", { name: itemName + "已买到" }).waitFor();
  await page.getByRole("checkbox", { name: itemName + "已买到" }).click();
  await page
    .locator("article")
    .filter({
      has: page.getByRole("checkbox", {
        name: itemName + "已买到",
        exact: true,
      }),
    })
    .getByRole("button", { name: "去入库确认", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "核对购买信息 · " + itemName })
    .waitFor();
  await fits("390核对入库表单");
  await shot("shopping-receive-390");
  await page.setViewportSize({ width: 320, height: 844 });
  await fits("320核对入库表单");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("实际购买数量", { exact: true }).fill("3");
  await page
    .getByLabel("到期日期", { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page
    .getByRole("button", { name: "确认购买并入库", exact: true })
    .click();
  await page
    .locator("article")
    .filter({
      has: page.getByRole("checkbox", {
        name: itemName + "已买到",
        exact: true,
      }),
    })
    .getByText("已入库，可到家中库存查看这一批", { exact: true })
    .waitFor();
  await tab("家中库存");
  await page.getByRole("heading", { name: itemName }).waitFor();
  await page.getByLabel("搜索名称或批次").fill(itemName);
  await page.getByRole("button", { name: /^临期 / }).click();
  await page.getByRole("heading", { name: itemName }).waitFor();
  await fits("390库存批次及临期筛选");
  await shot("inventory-390");
  await page.getByRole("button", { name: "调整库存", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await fits("320库存调整表单");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("数量（消耗 / 丢弃）", { exact: true }).fill("1");
  const consumeResponse = page.waitForResponse(
    (r) => r.url().includes("/actions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^确认操作 · 批次 / }).click();
  assert.equal((await consumeResponse).status(), 200);
  await page.getByText("2瓶", { exact: true }).waitFor();
  await page.getByRole("button", { name: "记录与纠正", exact: true }).click();
  await page
    .getByLabel("纠正原因", { exact: true })
    .fill("模拟手机验收，恢复误消耗数量");
  const correctionResponse = page.waitForResponse(
    (r) => r.url().includes("/corrections") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "确认纠正最近操作", exact: true })
    .click();
  assert.equal((await correctionResponse).status(), 200);
  await page.getByText("3瓶", { exact: true }).waitFor();
  report.检查.push({
    检查: "批次消耗1瓶后2瓶、纠正后恢复3瓶，事件保留",
    结果: "通过",
  });
  await shot("inventory-action-390");
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      "今日",
      "家中库存",
      "添点新鲜",
      "待确认",
      "拍照入库",
      "条码入库",
      "今晚吃什么",
      "购物清单",
      "冰箱贴",
      "设置",
    ]) {
      await tab(name);
      await fits(`${width} ${name}`);
      if (width === 320 && ["家中库存", "今晚吃什么"].includes(name))
        await shot((name === "家中库存" ? "inventory" : "recipes") + "-320");
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await tab("今日");
  await shot("home-390");
  await page
    .getByLabel("和饭搭子说一句", { exact: true })
    .fill("刚买了两个番茄和三个鸡蛋");
  const voiceResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/voice") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送 ↗", exact: true }).click();
  assert.equal((await voiceResponse).status(), 200);
  await page
    .getByRole("button", { name: "发送 ↗", exact: true })
    .waitFor({ state: "visible" });
  await tab("今晚吃什么");
  await page
    .locator("article.recipe")
    .filter({
      has: page.getByRole("heading", { name: "番茄炒蛋", exact: true }),
    })
    .getByRole("button", { name: "开始做饭 →", exact: true })
    .click();
  await page.locator(".cooking").waitFor();
  await page.locator(".cooking").getByText(/1\//).waitFor();
  await page
    .locator(".cooking")
    .getByRole("button", { name: "下一步 →", exact: true })
    .click();
  await page.locator(".cooking").getByText(/2\//).waitFor();
  await page.reload();
  await page.locator("nav").waitFor();
  await tab("今晚吃什么");
  await page.locator(".cooking").getByText(/2\//).waitFor();
  await fits("390烹饪第2步跨刷新保留");
  await page.locator(".cooking").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: artifacts + "/cooking-390.png",
    fullPage: false,
  });
  report.截图.push("cooking-390.png");
  report.检查.push({
    检查: "HTTP文字录入、开始番茄炒蛋、下一步与刷新后第2步保留",
    结果: "通过",
  });

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.waitForURL("**/login");
  assert.equal(await page.getByLabel("密码", { exact: true }).inputValue(), "");
  const anonymous = await context.request.get(base + "/api/state");
  assert.equal(anonymous.status(), 401);
  report.检查.push({
    检查: "购物标记已买→实物3瓶确认入库→临期查询→退出后匿名401及密码不预填",
    结果: "通过",
  });
  assert.deepEqual(report.浏览器错误, []);
  report.结果 = "通过";
} catch (e) {
  report.结果 = "失败";
  report.错误 = e.message;
  await shot("failure");
  process.exitCode = 1;
} finally {
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
