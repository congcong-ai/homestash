import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import { DomainError } from "@homestash/domain";
import {
  KORVO_BOARD_ID,
  DeviceReport,
  HardwareDescriptor,
  type ManagedDevice,
} from "@homestash/protocol";
import { z } from "zod";
const DeviceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
type Stored = Omit<ManagedDevice, "online"> & { tokenHash: string };
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function registerDevices(app: FastifyInstance, repo: SQLiteRepository) {
  const read = () => repo.read<Stored[]>("managed-devices", []);
  const save = (records: Stored[]) => repo.write("managed-devices", records);
  const publicRecord = (device: Stored): ManagedDevice => ({
    id: device.id,
    name: device.name,
    boardId: device.boardId,
    enabled: device.enabled,
    createdAt: device.createdAt,
    lastSeen: device.lastSeen,
    report: device.report,
    online:
      device.enabled &&
      !!device.lastSeen &&
      Date.now() - Date.parse(device.lastSeen) < 45000,
  });
  const list = () => read().map(publicRecord);
  const legacy = (id: string, token: string) => {
    DeviceId.parse(id);
    if (token.length < 32) throw new Error("设备Token至少需要32个字符");
    const records = read();
    // 只导入一次，重启不能让已撤销的凭据复活或覆盖后来签发的凭据。
    if (records.some((d) => d.id === id)) return;
    const old = repo.read<Record<string, unknown> | null>(
      "physical-device",
      null,
    );
    const report =
      old?.id === id
        ? DeviceReport.parse(
            Object.fromEntries(
              Object.entries(old).filter(
                ([k]) => !["id", "lastSeen"].includes(k),
              ),
            ),
          )
        : {};
    records.push({
      id,
      name: "FreshMate Korvo",
      boardId: KORVO_BOARD_ID,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastSeen:
        typeof old?.lastSeen === "string" && old?.id === id
          ? old.lastSeen
          : null,
      report,
      tokenHash: hash(token),
    });
    save(records);
  };
  const authenticate = (id: unknown, token: string) => {
    if (
      typeof id !== "string" ||
      !DeviceId.safeParse(id).success ||
      token.length < 32 ||
      token.length > 256
    )
      return null;
    const device = read().find((d) => d.id === id && d.enabled);
    if (
      !device ||
      !timingSafeEqual(
        Buffer.from(device.tokenHash, "hex"),
        Buffer.from(hash(token), "hex"),
      )
    )
      return null;
    return publicRecord(device);
  };
  const seen = (id: string, report: z.infer<typeof DeviceReport> = {}) => {
    const records = read(),
      device = records.find((d) => d.id === id && d.enabled);
    if (!device) throw new DomainError("设备已停用，请重新登记");
    if (
      report.hardware &&
      (report.hardware.boardId !== device.boardId ||
        (device.boardId === KORVO_BOARD_ID &&
          report.hardware.chip !== "esp32s31"))
    )
      throw new DomainError("上报板型与登记板型不符");
    device.report = { ...device.report, ...report };
    device.lastSeen = new Date().toISOString();
    save(records);
    // 兼容旧UI/调试工具，新的设备目录始终按ID分别保存，互不覆盖。
    repo.write("physical-device", {
      ...device.report,
      id,
      lastSeen: device.lastSeen,
    });
  };
  app.get("/api/devices", async () => list());
  app.post("/api/devices", async (req) => {
    const input = z
      .object({
        id: DeviceId,
        name: z.string().trim().min(1).max(80),
        boardId: HardwareDescriptor.shape.boardId,
      })
      .strict()
      .parse(req.body);
    const records = read();
    if (records.some((d) => d.id === input.id))
      throw new DomainError("设备ID已存在，请使用其他ID");
    if (records.length >= 100)
      throw new DomainError("当前家庭设备数量已达上限");
    const token = randomBytes(32).toString("hex");
    const record: Stored = {
      ...input,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastSeen: null,
      report: {},
      tokenHash: hash(token),
    };
    records.push(record);
    save(records);
    return { device: publicRecord(record), token };
  });
  app.post("/api/devices/:id/rotate-token", async (req) => {
    const { id } = z.object({ id: DeviceId }).parse(req.params);
    const records = read(),
      device = records.find((d) => d.id === id);
    if (!device) throw new DomainError("设备不存在");
    const token = randomBytes(32).toString("hex");
    device.tokenHash = hash(token);
    device.enabled = true;
    device.lastSeen = null;
    save(records);
    return { device: publicRecord(device), token };
  });
  app.post("/api/devices/:id/revoke", async (req) => {
    const { id } = z.object({ id: DeviceId }).parse(req.params);
    const records = read(),
      device = records.find((d) => d.id === id);
    if (!device) throw new DomainError("设备不存在");
    device.enabled = false;
    save(records);
    return publicRecord(device);
  });
  return { list, legacy, authenticate, seen };
}
