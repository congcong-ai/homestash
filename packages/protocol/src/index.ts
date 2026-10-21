import { z } from "zod";
export const DeviceEvent = z.object({
  version: z.literal(1),
  eventId: z.uuid(),
  deviceId: z.literal("korvo-simulator"),
  at: z.iso.datetime(),
  payload: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("BUTTON_PRESSED"),
      button: z.enum(["SET", "NEXT", "PREVIOUS"]),
    }),
    z.object({
      type: z.literal("VOICE_CAPTURED"),
      text: z.string().trim().min(1).max(2000),
      simulated: z.literal(true),
    }),
    z.object({
      type: z.literal("CAMERA_CAPTURED"),
      simulated: z.literal(true),
      width: z.literal(1280),
      height: z.literal(720),
      mime: z.literal("image/jpeg"),
    }),
    z.object({
      type: z.literal("HEARTBEAT"),
      battery: z.number().int().min(0).max(100),
      wifi: z.boolean(),
      online: z.boolean(),
    }),
    z.object({
      type: z.literal("POWER_CHANGED"),
      mode: z.enum(["active", "idle", "light_sleep", "deep_sleep"]),
    }),
  ]),
});
export type DeviceEvent = z.infer<typeof DeviceEvent>;
export type DeviceState = {
  id: string;
  battery: number;
  wifi: boolean;
  online: boolean;
  lastSeen: string | null;
  mode: "active" | "idle" | "light_sleep" | "deep_sleep";
  recording: boolean;
  screen: string;
  cameraCount: number;
};
export type DeviceCommand =
  | { version: 1; commandId: string; type: "DISPLAY_RENDER"; text: string }
  | {
      version: 1;
      commandId: string;
      type: "START_RECORDING" | "STOP_RECORDING";
    }
  | {
      version: 1;
      commandId: string;
      type: "PLAY_AUDIO";
      mediaId: string;
      format: "pcm_s16le";
      sampleRate: 16000;
      channels: 1;
    };
export const defaultDevice: DeviceState = {
  id: "korvo-simulator",
  battery: 86,
  wifi: true,
  online: false,
  lastSeen: null,
  mode: "idle",
  recording: false,
  screen: "欢迎回家，今天想吃点什么？",
  cameraCount: 0,
};
export type AudioDescriptor = {
  mediaId: string;
  mime: "audio/wav";
  sampleRate: 16000;
  bits: 16;
  channels: 1;
  bytes: number;
  sha256: string;
};

/** 板型能力属于设备协议；业务动作不依赖厂商按键名或GPIO。 */
export const KORVO_BOARD_ID = "esp32-s31-korvo-1-v1.1";
export const DeviceCapability = z.enum([
  "audio_input",
  "audio_output",
  "camera",
  "display",
  "touch",
  "buttons",
  "wifi",
  "ble_provisioning",
  "ota",
  "persistent_storage",
  "timer_sleep",
]);
export type DeviceCapability = z.infer<typeof DeviceCapability>;
export const HardwareDescriptor = z
  .object({
    boardId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    chip: z.string().regex(/^[a-z0-9-]{1,32}$/),
    capabilities: z
      .array(DeviceCapability)
      .max(16)
      .refine((v) => new Set(v).size === v.length, "能力不能重复"),
  })
  .strict();
export type HardwareDescriptor = z.infer<typeof HardwareDescriptor>;
export const DeviceReport = z
  .object({
    screen: z.string().max(1024).optional(),
    network: z.string().max(96).optional(),
    screenRevision: z.number().int().nonnegative().optional(),
    uptimeMs: z.number().int().nonnegative().optional(),
    firmwareVersion: z.string().max(32).optional(),
    firmwarePartition: z.string().max(16).optional(),
    firmwareElf: z
      .string()
      .regex(/^[a-f0-9]{8,64}$/)
      .optional(),
    otaState: z.string().max(160).optional(),
    powerState: z
      .enum(["Idle", "Active", "Light Sleep", "Deep Sleep"])
      .optional(),
    freeHeapBytes: z.number().int().nonnegative().optional(),
    minimumFreeHeapBytes: z.number().int().nonnegative().optional(),
    hardware: HardwareDescriptor.optional(),
  })
  .strict();
export type DeviceReport = z.infer<typeof DeviceReport>;
export type ManagedDevice = {
  id: string;
  name: string;
  boardId: string;
  enabled: boolean;
  online: boolean;
  createdAt: string;
  lastSeen: string | null;
  report: DeviceReport;
};
