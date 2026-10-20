import { z } from "zod";
import {
  Barcode,
  barcodeKey,
  DomainError,
  type ProductCandidate,
  type ProductLookupProvider,
} from "@homestash/domain";

export class LocalProductLookupProvider implements ProductLookupProvider {
  readonly kind = "local";
  constructor(
    private readonly read: (key: string) => ProductCandidate | null,
  ) {}
  async lookup(barcode: string) {
    const product = this.read(barcodeKey(barcode));
    return product ? { ...product, barcode, source: "local" as const } : null;
  }
}

// 固定服务地址；只有用户启用后才请求，不发送库存、图片或家庭信息。
export class OpenFoodFactsProvider implements ProductLookupProvider {
  readonly kind = "open-food-facts";
  private nextRequestAt = 0;
  constructor(private readonly request: typeof fetch = fetch) {}
  async lookup(input: string): Promise<ProductCandidate | null> {
    const barcode = Barcode.parse(input);
    const wait = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + 1000;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const url = new URL(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
    );
    url.searchParams.set(
      "fields",
      "code,product_name,product_name_zh,brands,quantity",
    );
    let response: Response;
    try {
      response = await this.request(url, {
        headers: {
          "User-Agent":
            "HomeStash/0.1 (https://github.com/congcong-ai/homestash)",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
    } catch {
      throw new DomainError(
        "商品服务连接失败；可重试，或关闭外部查询后手动填写",
      );
    }
    if (response.status === 404) return null;
    if (!response.ok)
      throw new DomainError("商品服务暂不可用，库存未改变；请稍后重试");
    const raw = await response.json().catch(() => {
      throw new DomainError("商品服务返回的内容无效，库存未改变");
    });
    const parsed = z
      .object({
        status: z.union([z.literal(0), z.literal(1)]),
        product: z
          .object({
            code: z.string(),
            product_name: z.string().optional(),
            product_name_zh: z.string().optional(),
            brands: z.string().optional(),
            quantity: z.string().optional(),
          })
          .optional(),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new DomainError("商品服务返回的内容无效，库存未改变");
    const data = parsed.data;
    if (data.status === 0) return null;
    const product = data.product;
    if (
      !product ||
      !Barcode.safeParse(product.code).success ||
      barcodeKey(product.code) !== barcodeKey(barcode)
    )
      throw new DomainError("商品服务返回的条码不匹配，库存未改变");
    const name = (product.product_name_zh || product.product_name || "").trim();
    if (!name) return null;
    return {
      barcode,
      name: name.slice(0, 80),
      category: "food",
      source: "open-food-facts",
      brand: product.brands?.slice(0, 120),
      packageDescription: product.quantity?.slice(0, 120),
      sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
    };
  }
}
