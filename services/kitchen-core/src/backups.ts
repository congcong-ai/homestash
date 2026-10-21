import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import {
  DomainError,
  ItemInput,
  ShoppingInput,
  ImageRecognition,
  ProductCandidate,
  Barcode,
} from "@homestash/domain";

const Item = ItemInput.extend({
  id: z.uuid(),
  householdId: z.literal("local"),
  createdAt: z.iso.datetime(),
  version: z.number().int().positive(),
});
const Event = z
  .object({
    id: z.uuid(),
    itemId: z.uuid(),
    type: z.enum([
      "ITEM_CREATED",
      "ITEM_UPDATED",
      "ITEM_CONSUMED",
      "ITEM_DISCARDED",
      "ITEM_MOVED",
      "ITEM_OPENED",
      "ITEM_EXPIRED",
      "ITEM_RESTOCKED",
      "ITEM_CORRECTED",
    ]),
    at: z.iso.datetime(),
    before: Item.nullable(),
    after: Item,
    correction: z
      .object({ eventId: z.uuid(), reason: z.string().trim().min(1).max(300) })
      .strict()
      .optional(),
  })
  .strict();
const Shopping = ShoppingInput.extend({
  id: z.uuid(),
  checked: z.boolean(),
  source: z.string(),
  createdAt: z.iso.datetime(),
  stockedAt: z.iso.datetime().optional(),
  inventoryItemId: z.uuid().optional(),
  receivedItem: Item.optional(),
  confirmationSignature: z.string().optional(),
});
const Recipe = z
  .object({
    id: z.string().min(1),
    origin: z.enum(["local", "ai"]).optional(),
    name: z.string().min(1),
    minutes: z.number().positive(),
    ingredients: z.array(
      z.object({
        name: z.string(),
        quantity: z.number().positive(),
        unit: z.string(),
      }),
    ),
    steps: z.array(z.string()).min(1),
    used: z.array(z.string()),
    missing: z.array(z.string()),
    people: z.number().int().min(1).max(20),
  })
  .strict();
const Cooking = z
  .object({
    id: z.uuid(),
    recipe: Recipe,
    step: z.number().int().nonnegative(),
    answer: z.string(),
    revision: z.number().int().nonnegative().optional(),
    status: z.enum(["active", "awaiting_confirmation", "completed"]).optional(),
    consumption: z
      .object({
        state: z.enum(["pending", "confirmed", "skipped"]),
        lines: z.array(
          z
            .object({
              itemId: z.uuid(),
              name: z.string(),
              quantity: z.number().positive(),
              unit: z.string(),
              version: z.number().int().positive(),
            })
            .strict(),
        ),
        missing: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .nullable();
const Image = z
  .object({
    id: z.uuid(),
    status: z.enum(["pending", "confirmed", "cancelled"]),
    createdAt: z.iso.datetime(),
    imageHash: z.string().regex(/^[a-f0-9]{64}$/),
    notes: z.string(),
    candidates: z.array(
      ImageRecognition.shape.candidates.element.extend({ id: z.uuid() }),
    ),
    confirmationSignature: z.string().optional(),
    confirmedItems: z.array(Item).optional(),
  })
  .strict();
const BarcodeReview = z
  .object({
    id: z.uuid(),
    barcode: Barcode,
    createdAt: z.iso.datetime(),
    status: z.enum(["pending", "confirmed", "cancelled"]),
    product: ProductCandidate.nullable(),
    note: z.string(),
    confirmationSignature: z.string().optional(),
    confirmedItem: Item.optional(),
  })
  .strict();
const Failure = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(["image", "barcode"]),
    status: z.literal("failed"),
    createdAt: z.iso.datetime(),
    barcode: Barcode.optional(),
  })
  .strict();
const Payload = z
  .object({
    households: z
      .array(
        z.object({ id: z.literal("local"), name: z.string().min(1) }).strict(),
      )
      .length(1),
    members: z.array(
      z
        .object({
          id: z.string().min(1),
          household_id: z.literal("local"),
          name: z.string(),
          preferences: z.string().refine((v) => {
            try {
              return z.array(z.string()).safeParse(JSON.parse(v)).success;
            } catch {
              return false;
            }
          }),
        })
        .strict(),
    ),
    locations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            household_id: z.literal("local"),
            name: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    items: z.array(Item),
    events: z.array(Event),
    state: z.array(
      z.object({ id: z.string().min(1).max(300), data: z.json() }).strict(),
    ),
  })
  .strict();
export type BackupPayload = z.infer<typeof Payload>;
const Envelope = z
  .object({
    format: z.literal("homestash-household"),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z.json(),
  })
  .strict();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const scoped = (id: string) =>
  [
    "shopping",
    "cooking",
    "recipe-catalog",
    "recipe-people",
    "image-intake-index",
    "barcode-intake-index",
    "intake-failures",
    "backup-blocked-requests",
  ].includes(id) ||
  /^(image-intake|barcode-intake|product):/.test(id) ||
  (id.startsWith("request:") && !id.startsWith("request:backup-restore:"));
function readPayload(repo: SQLiteRepository): BackupPayload {
  return repo.transaction(() => ({
    households: repo.sqlite
      .prepare("SELECT id,name FROM households ORDER BY id")
      .all(),
    members: repo.sqlite
      .prepare(
        "SELECT id,household_id,name,preferences FROM household_members ORDER BY id",
      )
      .all(),
    locations: repo.sqlite
      .prepare("SELECT id,household_id,name FROM locations ORDER BY id")
      .all(),
    items: repo.list().sort((a, b) => a.id.localeCompare(b.id)),
    events: repo
      .events()
      .sort(
        (a, b) =>
          a.itemId.localeCompare(b.itemId) || a.after.version - b.after.version,
      ),
    state: (
      repo.sqlite
        .prepare("SELECT id,data FROM app_state ORDER BY id")
        .all() as { id: string; data: string }[]
    )
      .filter((r) => scoped(r.id))
      .map((r) => ({ id: r.id, data: JSON.parse(r.data) })),
  })) as BackupPayload;
}
function envelope(payload: BackupPayload) {
  return {
    format: "homestash-household" as const,
    version: 1 as const,
    createdAt: new Date().toISOString(),
    sha256: digest(payload),
    payload,
  };
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length)
    throw new DomainError("备份包含重复标识，未恢复");
}
export function validateBackup(raw: unknown) {
  const file = Envelope.parse(raw);
  if (digest(file.payload) !== file.sha256)
    throw new DomainError("备份校验和不匹配，文件可能损坏，未恢复");
  const p = Payload.parse(file.payload);
  unique(p.items.map((i) => i.id));
  unique(p.events.map((e) => e.id));
  unique(p.locations.map((l) => l.id));
  unique(p.members.map((m) => m.id));
  unique(p.state.map((r) => r.id));
  const itemMap = new Map(p.items.map((i) => [i.id, i]));
  const locations = new Set(p.locations.map((l) => l.id));
  for (const item of p.items)
    if (!locations.has(item.locationId))
      throw new DomainError("备份中的存放位置不存在");
  const byItem = new Map<string, typeof p.events>();
  for (const event of p.events) {
    const list = byItem.get(event.itemId) ?? [];
    list.push(event);
    byItem.set(event.itemId, list);
  }
  for (const item of p.items) {
    const events = (byItem.get(item.id) ?? []).sort(
      (a, b) => a.after.version - b.after.version,
    );
    if (
      events.length !== item.version ||
      canonical(events.at(-1)?.after) !== canonical(item)
    )
      throw new DomainError("备份库存与事件版本不一致");
    events.forEach((event, index) => {
      if (
        event.after.id !== item.id ||
        event.after.version !== index + 1 ||
        (index === 0
          ? event.type !== "ITEM_CREATED" || event.before !== null
          : canonical(event.before) !== canonical(events[index - 1].after))
      )
        throw new DomainError("备份事件链不完整");
      if (
        !locations.has(event.after.locationId) ||
        (event.before && !locations.has(event.before.locationId))
      )
        throw new DomainError("备份历史包含未知位置");
      if (
        event.correction &&
        !events.slice(0, index).some((e) => e.id === event.correction?.eventId)
      )
        throw new DomainError("纠正记录引用不存在");
    });
  }
  if (p.events.some((e) => !itemMap.has(e.itemId)))
    throw new DomainError("备份事件引用了未知批次");
  const records = new Map(p.state.map((r) => [r.id, r.data]));
  for (const r of p.state) {
    if (!scoped(r.id)) throw new DomainError("备份包含不允许恢复的系统配置");
    if (r.id === "backup-blocked-requests")
      z.array(z.string().startsWith("request:")).parse(r.data);
    else if (r.id === "shopping") {
      const items = z.array(Shopping).parse(r.data);
      unique(items.map((i) => i.id));
      if (
        items.some(
          (i) =>
            i.inventoryItemId &&
            (!itemMap.has(i.inventoryItemId) ||
              !i.checked ||
              (i.receivedItem && i.receivedItem.id !== i.inventoryItemId)),
        )
      )
        throw new DomainError("购物入库记录引用不完整");
    } else if (r.id === "recipe-catalog") z.array(Recipe).parse(r.data);
    else if (r.id === "recipe-people")
      z.number().int().min(1).max(20).parse(r.data);
    else if (r.id === "cooking") {
      const c = Cooking.parse(r.data);
      if (
        c &&
        (c.step >= c.recipe.steps.length ||
          c.consumption?.lines.some((l) => !itemMap.has(l.itemId)))
      )
        throw new DomainError("烹饪进度或批次引用无效");
    } else if (r.id === "intake-failures") z.array(Failure).parse(r.data);
    else if (r.id.endsWith("-intake-index")) {
      const ids = z.array(z.uuid()).parse(r.data);
      unique(ids);
      const prefix = r.id.replace("-index", ":");
      if (ids.some((id) => !records.has(prefix + id)))
        throw new DomainError("待确认索引引用缺失");
    } else if (r.id.startsWith("image-intake:")) {
      const review = Image.parse(r.data);
      if (
        !z
          .array(z.string())
          .parse(records.get("image-intake-index"))
          .includes(review.id)
      )
        throw new DomainError("图片候选不在备份索引中");
      if (
        r.id !== `image-intake:${review.id}` ||
        review.confirmedItems?.some((i) => !itemMap.has(i.id))
      )
        throw new DomainError("图片候选引用无效");
    } else if (r.id.startsWith("barcode-intake:")) {
      const review = BarcodeReview.parse(r.data);
      if (
        !z
          .array(z.string())
          .parse(records.get("barcode-intake-index"))
          .includes(review.id)
      )
        throw new DomainError("条码候选不在备份索引中");
      if (
        r.id !== `barcode-intake:${review.id}` ||
        (review.confirmedItem && !itemMap.has(review.confirmedItem.id))
      )
        throw new DomainError("条码候选引用无效");
    } else if (r.id.startsWith("product:")) ProductCandidate.parse(r.data);
    else if (r.id.startsWith("request:"))
      z.object({ signature: z.string(), result: z.json() })
        .strict()
        .parse(r.data);
  }
  return { ...file, payload: p };
}
type Once = <T>(
  key: string,
  body: unknown,
  work: () => Promise<() => T>,
) => Promise<T>;
export function registerBackups(
  app: FastifyInstance,
  repo: SQLiteRepository,
  path: string,
  once: Once,
  restored: () => void,
) {
  const directory = resolve(
    process.env.BACKUP_DIRECTORY ?? join(dirname(path), "backups"),
  );
  const snapshot = (file: ReturnType<typeof envelope>) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const id = crypto.randomUUID(),
      target = join(directory, `${id}.json`),
      temporary = target + ".tmp";
    writeFileSync(temporary, JSON.stringify(file), { mode: 0o600, flag: "wx" });
    const fd = openSync(temporary, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, target);
    const dirfd = openSync(directory, "r");
    try {
      fsyncSync(dirfd);
    } finally {
      closeSync(dirfd);
    }
    return id;
  };
  const summary = (payload: BackupPayload) => {
    const shopping =
      (payload.state.find((r) => r.id === "shopping")?.data as
        z.infer<typeof Shopping>[] | undefined) ?? [];
    return {
      items: payload.items.length,
      events: payload.events.length,
      locations: payload.locations.length,
      shopping: shopping.length,
      pending:
        payload.state.filter(
          (r) =>
            /^(image|barcode)-intake:/.test(r.id) &&
            (r.data as { status?: string })?.status === "pending",
        ).length +
        shopping.filter((i) => i.checked && !i.inventoryItemId).length,
    };
  };
  const exportFile = () => {
    const file = envelope(readPayload(repo));
    validateBackup(file);
    return file;
  };
  app.get("/api/backups/export", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .header(
        "Content-Disposition",
        `attachment; filename="homestash-${new Date().toISOString().slice(0, 10)}.json"`,
      )
      .send(exportFile()),
  );
  app.get("/api/backups/snapshots", async () => {
    try {
      return readdirSync(directory)
        .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
        .map((n) => {
          const file = validateBackup(
            JSON.parse(readFileSync(join(directory, n), "utf8")),
          );
          return {
            id: n.slice(0, -5),
            createdAt: file.createdAt,
            ...summary(file.payload),
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  });
  app.get("/api/backups/snapshots/:id", async (req, reply) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    let file;
    try {
      file = readFileSync(join(directory, `${id}.json`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return reply.code(404).send({ error: "找不到恢复前快照" });
      throw error;
    }
    validateBackup(JSON.parse(file));
    return reply
      .type("application/json")
      .header(
        "Content-Disposition",
        `attachment; filename="homestash-before-restore-${id}.json"`,
      )
      .send(file);
  });
  app.post(
    "/api/backups/validate",
    { bodyLimit: 20 * 1024 * 1024 },
    async (req) => {
      const file = validateBackup(req.body);
      return {
        sha256: file.sha256,
        createdAt: file.createdAt,
        ...summary(file.payload),
        current: summary(readPayload(repo)),
        currentFingerprint: digest(readPayload(repo)),
      };
    },
  );
  app.post(
    "/api/backups/restore",
    { bodyLimit: 21 * 1024 * 1024 },
    async (req) => {
      const body = z
        .object({
          requestId: z.uuid(),
          confirmation: z.literal("覆盖恢复"),
          currentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          backup: z.unknown(),
        })
        .strict()
        .parse(req.body);
      const file = validateBackup(body.backup);
      return once(
        `backup-restore:${body.requestId}`,
        { sha256: file.sha256, currentFingerprint: body.currentFingerprint },
        async () => () => {
          const current = readPayload(repo);
          if (digest(current) !== body.currentFingerprint)
            throw new DomainError("校验后家庭数据已变化，请重新校验再恢复");
          const beforeRestore = envelope(current);
          validateBackup(beforeRestore);
          if (
            Buffer.byteLength(JSON.stringify(beforeRestore)) >
            20 * 1024 * 1024
          )
            throw new DomainError(
              "恢复前快照超过网页20MB范围，请先离线备份，未覆盖当前数据",
            );
          const snapshotId = snapshot(beforeRestore);
          const previousRequests = current.state
            .filter((r) => r.id.startsWith("request:"))
            .map((r) => r.id);
          const incomingRequests = new Set(
            file.payload.state
              .filter((r) => r.id.startsWith("request:"))
              .map((r) => r.id),
          );
          const blocked = new Set([
            ...repo.read<string[]>("backup-blocked-requests", []),
            ...((file.payload.state.find(
              (r) => r.id === "backup-blocked-requests",
            )?.data as string[] | undefined) ?? []),
          ]);
          for (const key of previousRequests)
            if (!incomingRequests.has(key)) blocked.add(key);
          for (const key of incomingRequests) blocked.delete(key);
          for (const table of [
            "inventory_events",
            "inventory_items",
            "household_members",
            "locations",
          ])
            repo.sqlite.prepare(`DELETE FROM ${table}`).run();
          const oldState = repo.sqlite
            .prepare("SELECT id FROM app_state")
            .all() as { id: string }[];
          for (const row of oldState)
            if (scoped(row.id))
              repo.sqlite
                .prepare("DELETE FROM app_state WHERE id=?")
                .run(row.id);
          repo.sqlite
            .prepare("UPDATE households SET name=? WHERE id='local'")
            .run(file.payload.households[0].name);
          for (const l of file.payload.locations)
            repo.sqlite
              .prepare(
                "INSERT INTO locations(id,household_id,name) VALUES(?,?,?)",
              )
              .run(l.id, l.household_id, l.name);
          for (const m of file.payload.members)
            repo.sqlite
              .prepare(
                "INSERT INTO household_members(id,household_id,name,preferences) VALUES(?,?,?,?)",
              )
              .run(m.id, m.household_id, m.name, m.preferences);
          for (const item of file.payload.items)
            repo.sqlite
              .prepare("INSERT INTO inventory_items(id,data) VALUES(?,?)")
              .run(item.id, JSON.stringify(item));
          for (const event of file.payload.events)
            repo.sqlite
              .prepare("INSERT INTO inventory_events(id,data) VALUES(?,?)")
              .run(event.id, JSON.stringify(event));
          for (const row of file.payload.state) repo.write(row.id, row.data);
          repo.write("backup-blocked-requests", [...blocked]);
          repo.write("backup-data-epoch", crypto.randomUUID());
          restored();
          return {
            snapshotId,
            ...summary(file.payload),
            message: "家庭数据已恢复；设备与AI配置保持当前机器设置",
          };
        },
      );
    },
  );
}
