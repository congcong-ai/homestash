import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "../..");
const t5Source = process.argv[2];
const fontName = t5Source ? "hs_yard_font" : "hs_font";
const output = t5Source
  ? "firmware/boards/tuya-t5-ai/assets/wenkai/hs_yard_font.c"
  : "firmware/shared/assets/hs_font.c";
let symbols = "";
function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".next",
        "build",
        ".build",
        "managed_components",
      ].includes(e.name)
    )
      continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (
      /\.(c|ts|tsx)$/.test(p) &&
      !["hs_font.c", "hs_yard_font.c"].includes(e.name)
    )
      symbols += readFileSync(p, "utf8");
  }
}
for (const dir of [
  "firmware/boards/esp32-s31-korvo-1",
  "firmware/shared/components",
  "firmware/platforms",
  "firmware/boards/tuya-t5-ai",
  "firmware/apps",
  "packages",
  "apps/web/app",
  "apps/web/components",
  "services/kitchen-core/src",
])
  scan(resolve(root, dir));
// GB2312 一级、二级汉字覆盖动态回复；仓库新增文案仍自动补入。
// 6763 个汉字，28px/2bpp；字形常驻只读 Flash，不在启动时复制到 PSRAM。
for (let high = 0xb0; high <= 0xf7; high++)
  for (let low = 0xa1; low <= 0xfe; low++) {
    const ch = new TextDecoder("gb18030").decode(Uint8Array.of(high, low));
    if (/^[\u4e00-\u9fff]$/u.test(ch)) symbols += ch;
  }
symbols = [...new Set(symbols.match(/[^\u0000-\u007f]/gu) ?? [])].join("");
const result = spawnSync(
  "pnpm",
  [
    "dlx",
    "lv_font_conv@1.5.3",
    "--font",
    t5Source
      ? resolve(t5Source)
      : resolve(root, "vendor/fonts/noto-sans-cjk/NotoSansCJKsc-Regular.otf"),
    "--symbols",
    symbols,
    "--range",
    "0x20-0x7e",
    "--size",
    t5Source ? "24" : "28",
    "--bpp",
    "2",
    "--format",
    "lvgl",
    "--no-compress",
    "--lv-font-name",
    fontName,
    "-o",
    resolve(root, output),
  ],
  { stdio: "inherit" },
);
if (t5Source && result.status === 0) {
  const file = resolve(root, output);
  const source = readFileSync(file, "utf8")
    .replaceAll(resolve(t5Source), "LXGWWenKai-Regular.ttf")
    .replaceAll(file, "hs_yard_font.c");
  writeFileSync(
    file,
    "/* 字形来源 https://github.com/lxgw/LxgwWenKai/tree/v1.521 */\n" + source,
  );
}
process.exit(result.status ?? 1);
