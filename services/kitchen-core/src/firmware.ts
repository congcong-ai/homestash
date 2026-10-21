import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { SQLiteRepository } from "@homestash/database";
import { z } from "zod";
import { KORVO_BOARD_ID, HardwareDescriptor } from "@homestash/protocol";
import { DomainError } from "@homestash/domain";
export const MAX_FIRMWARE_BYTES = 4 * 1024 * 1024;
export type FirmwareRelease = {
  id: string;
  size: number;
  sha256: string;
  version: string;
  project: string;
  chip: "esp32s31";
  boardId?: string;
  createdAt: string;
};
export const firmwareSignature = (release: FirmwareRelease, token: string) =>
  createHmac("sha256", token)
    .update(
      `${release.sha256}:${release.size}:${release.version}:${release.project}:${release.chip}`,
    )
    .digest("hex");
export function inspectFirmware(bytes: Buffer) {
  const fail = () => {
    throw new DomainError(
      "固件无效：请选择受支持的 HomeStash 应用 .bin，不接受引导程序、整片备份、缺少板型标记或校验失败的镜像",
    );
  };
  if (
    bytes.length < 304 ||
    bytes.length > MAX_FIRMWARE_BYTES ||
    bytes[0] !== 0xe9 ||
    bytes.readUInt16LE(12) !== 32 ||
    bytes[23] !== 1 ||
    bytes.readUInt32LE(32) !== 0xabcd5432
  )
    return fail();
  const segments = bytes[1];
  if (segments < 1 || segments > 16) return fail();
  let offset = 24,
    checksum = 0xef;
  for (let i = 0; i < segments; i++) {
    if (offset + 8 > bytes.length) return fail();
    const size = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (!size || offset + size > bytes.length) return fail();
    for (const value of bytes.subarray(offset, offset + size))
      checksum ^= value;
    offset += size;
  }
  const checksumAt = Math.ceil((offset + 1) / 16) * 16 - 1;
  if (
    checksumAt + 33 !== bytes.length ||
    bytes[checksumAt] !== checksum ||
    !createHash("sha256")
      .update(bytes.subarray(0, checksumAt + 1))
      .digest()
      .equals(bytes.subarray(checksumAt + 1))
  )
    return fail();
  const stringAt = (offset: number) => {
    const field = bytes.subarray(offset, offset + 32);
    const end = field.indexOf(0);
    if (end < 1) return fail();
    return field.toString("utf8", 0, end);
  };
  const version = stringAt(48),
    project = stringAt(80);
  if (
    project !== "homestash_freshmate" ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)
  )
    return fail();
  const marker = Buffer.from("HS_TARGET_V1:");
  const at = bytes.indexOf(marker);
  let boardId = KORVO_BOARD_ID;
  if (at >= 0) {
    if (bytes.indexOf(marker, at + marker.length) >= 0) return fail();
    const end = bytes.indexOf(0, at + marker.length);
    if (end < 0 || end - at - marker.length > 80) return fail();
    boardId = bytes.toString("utf8", at + marker.length, end);
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(boardId)) return fail();
  } else if (!/^0\.[0-4]\./.test(version)) return fail();
  return {
    version,
    project,
    chip: "esp32s31" as const,
    boardId,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export function registerFirmware(
  app: FastifyInstance,
  repo: SQLiteRepository,
  root: string,
) {
  const latest = (boardId = KORVO_BOARD_ID) => {
    const scoped = repo.read<FirmwareRelease | null>(
      `firmware-latest:${boardId}`,
      null,
    );
    const old = repo.read<FirmwareRelease | null>("firmware-latest", null);
    return (
      scoped ??
      (old && (old.boardId ?? KORVO_BOARD_ID) === boardId ? old : null)
    );
  };
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.get("/api/firmware", async (req) => {
    const { boardId } = z
      .object({
        boardId: HardwareDescriptor.shape.boardId.default(KORVO_BOARD_ID),
      })
      .strict()
      .parse(req.query);
    return latest(boardId);
  });
  app.post("/api/firmware", { bodyLimit: MAX_FIRMWARE_BYTES }, async (req) => {
    if (!Buffer.isBuffer(req.body))
      throw new DomainError("请上传固件二进制文件");
    const info = inspectFirmware(req.body);
    const expectedBoard = req.headers["x-firmware-board"];
    if (expectedBoard !== undefined && expectedBoard !== info.boardId)
      throw new DomainError("镜像板型与所选设备板型不符，未发布");
    const release: FirmwareRelease = {
      ...info,
      id: info.sha256,
      createdAt: new Date().toISOString(),
    };
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, `${release.id}.bin`),
      temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, req.body, { mode: 0o600 });
    await rename(temporary, path);
    repo.write(`firmware:${release.id}`, release);
    repo.write(`firmware-latest:${release.boardId}`, release);
    if (release.boardId === KORVO_BOARD_ID)
      repo.write("firmware-latest", release);
    return release;
  });
  return {
    latest,
    compatible(id: string, boardId: string) {
      const release = repo.read<FirmwareRelease | null>(`firmware:${id}`, null);
      return !!release && (release.boardId ?? KORVO_BOARD_ID) === boardId;
    },
    async binary(id: string) {
      if (!/^[a-f0-9]{64}$/.test(id)) return null;
      const release = repo.read<FirmwareRelease | null>(`firmware:${id}`, null);
      if (!release) return null;
      const bytes = await readFile(join(root, `${id}.bin`));
      if (
        bytes.length !== release.size ||
        createHash("sha256").update(bytes).digest("hex") !== release.sha256
      )
        throw new Error("固件缓存校验失败");
      return bytes;
    },
  };
}
