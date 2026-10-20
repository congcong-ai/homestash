import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Barcode, barcodeKey, type BarcodeReview } from "@homestash/domain";
import { createApp } from "../services/kitchen-core/src/app";
import { OpenFoodFactsProvider } from "../services/kitchen-core/src/product-lookup";

test("商品条码验证校验位并统一UPC/EAN前导零；不接受链接和任意文本", () => {
  for (const code of [
    "96385074",
    "036000291452",
    "3017620422003",
    "0036000291452",
    "00036000291452",
  ])
    assert.ok(Barcode.safeParse(code).success, code);
  assert.equal(barcodeKey("036000291452"), barcodeKey("0036000291452"));
  for (const code of [
    "3017620422004",
    "123",
    "3017620422003?q=x",
    "https://example.com",
    "ABC36000291452",
  ])
    assert.equal(Barcode.safeParse(code).success, false, code);
});

test("条码查询不写库存；编辑确认与并发重试幂等，跨重启本地商品可查且不复用日期/数量", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homestash-barcode-"));
  let core = createApp(join(dir, "core.db"));
  const post = (url: string, payload: object) =>
    core.app.inject({ method: "POST", url, payload });
  try {
    const query = { requestId: crypto.randomUUID(), barcode: "036000291452" };
    const first = await post("/api/intake/barcodes", query);
    assert.equal(first.statusCode, 200, first.body);
    const review = first.json<BarcodeReview>();
    assert.equal(review.product, null);
    assert.equal(core.repo.list().length, 0);
    assert.equal(core.repo.events().length, 0);
    assert.deepEqual(
      (await post("/api/intake/barcodes", query)).json(),
      review,
    );
    const item = {
      name: "家用纸巾",
      category: "household",
      quantity: 2,
      unit: "包",
      locationId: "other",
      expiresAt: "2099-02-01",
      metadata: { barcode: "伪造来源" },
    };
    const url = `/api/intake/barcodes/${review.id}/confirm`;
    const missing = await post(url, {
      requestId: crypto.randomUUID(),
      item: { name: "纸巾", locationId: "other" },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(core.repo.list().length, 0);
    const payload = { requestId: crypto.randomUUID(), item };
    const replies = await Promise.all([post(url, payload), post(url, payload)]);
    assert.deepEqual(
      replies.map((r) => r.statusCode),
      [200, 200],
    );
    assert.equal(core.repo.list().length, 1);
    assert.equal(core.repo.events().length, 1);
    assert.equal(core.repo.list()[0].source, "barcode");
    assert.equal(core.repo.list()[0].metadata.barcode, query.barcode);
    assert.equal(
      (await post(url, { ...payload, requestId: crypto.randomUUID() }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await post(url, {
          ...payload,
          requestId: crypto.randomUUID(),
          item: { ...item, quantity: 3 },
        })
      ).statusCode,
      409,
    );
    await core.app.close();
    core = createApp(join(dir, "core.db"));
    assert.equal(
      (await post("/api/intake/barcodes", query)).json().status,
      "confirmed",
    );
    const next = (
      await post("/api/intake/barcodes", {
        requestId: crypto.randomUUID(),
        barcode: "0036000291452",
      })
    ).json<BarcodeReview>();
    assert.equal(next.product?.name, item.name);
    assert.equal(next.product?.category, "household");
    assert.equal(next.product?.source, "local");
    assert.equal("quantity" in next.product!, false);
    assert.equal("expiresAt" in next.product!, false);
    assert.equal(core.repo.events().length, 1);
    const invalidLocation = await post(
      `/api/intake/barcodes/${next.id}/confirm`,
      {
        requestId: crypto.randomUUID(),
        item: { ...item, locationId: "invalid-location" },
      },
    );
    assert.equal(invalidLocation.statusCode, 409);
    assert.equal(core.repo.events().length, 1);
    assert.equal(
      (await post(`/api/intake/barcodes/${next.id}/cancel`, {})).statusCode,
      200,
    );
    assert.equal(
      (
        await post(`/api/intake/barcodes/${next.id}/confirm`, {
          requestId: crypto.randomUUID(),
          item,
        })
      ).statusCode,
      409,
    );
    assert.equal(core.repo.events().length, 1);
  } finally {
    await core.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Open Food Facts适配器仅请求指定条码；缺失、限流、错码、网络失败不伪造商品", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  const provider = new OpenFoodFactsProvider(async (input, options) => {
    requests.push({ url: String(input), options });
    return Response.json({
      status: 1,
      product: {
        code: "3017620422003",
        product_name: "Example",
        product_name_zh: "示例食品",
        brands: "示例品牌",
        quantity: "400 g",
      },
    });
  });
  const result = await provider.lookup("3017620422003");
  assert.equal(result?.name, "示例食品");
  assert.equal(result?.category, "food");
  assert.equal(result?.packageDescription, "400 g");
  assert.equal(
    new URL(requests[0].url).pathname,
    "/api/v2/product/3017620422003.json",
  );
  assert.match(JSON.stringify(requests[0].options?.headers), /HomeStash/);
  assert.equal(requests[0].options?.redirect, "error");
  assert.equal("quantity" in result!, false);
  assert.equal("expiresAt" in result!, false);
  assert.equal(
    await new OpenFoodFactsProvider(async () =>
      Response.json({ status: 0 }),
    ).lookup("3017620422003"),
    null,
  );
  assert.equal(
    await new OpenFoodFactsProvider(
      async () => new Response(null, { status: 404 }),
    ).lookup("3017620422003"),
    null,
  );
  await assert.rejects(
    new OpenFoodFactsProvider(
      async () => new Response(null, { status: 429 }),
    ).lookup("3017620422003"),
    /暂不可用/,
  );
  await assert.rejects(
    new OpenFoodFactsProvider(async () => new Response("not-json")).lookup(
      "3017620422003",
    ),
    /内容无效/,
  );
  await assert.rejects(
    new OpenFoodFactsProvider(async () =>
      Response.json({ status: "broken" }),
    ).lookup("3017620422003"),
    /内容无效/,
  );
  await assert.rejects(
    new OpenFoodFactsProvider(async () => {
      throw Error("timeout");
    }).lookup("3017620422003"),
    /连接失败/,
  );
  await assert.rejects(
    new OpenFoodFactsProvider(async () =>
      Response.json({
        status: 1,
        product: { code: "036000291452", product_name: "错码" },
      }),
    ).lookup("3017620422003"),
    /条码不匹配/,
  );
});
