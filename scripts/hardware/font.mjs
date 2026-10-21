import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "../..");
let symbols = "";
function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (
      ["node_modules", ".next", "build", "managed_components"].includes(e.name)
    )
      continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/\.(c|ts|tsx)$/.test(p) && e.name !== "hs_font.c")
      symbols += readFileSync(p, "utf8");
  }
}
for (const dir of [
  "firmware/freshmate-korvo",
  "firmware/common",
  "firmware/apps",
  "packages",
  "apps/web/app",
  "apps/web/components",
  "services/kitchen-core/src",
])
  scan(resolve(root, dir));
symbols = [...new Set(symbols.match(/[^\u0000-\u007f]/gu) ?? [])].join("");
const result = spawnSync(
  "pnpm",
  [
    "dlx",
    "lv_font_conv@1.5.3",
    "--font",
    resolve(root, "vendor/fonts/noto-sans-cjk/NotoSansCJKsc-Regular.otf"),
    "--symbols",
    symbols,
    "--range",
    "0x20-0x7e",
    "--size",
    "28",
    "--bpp",
    "4",
    "--format",
    "lvgl",
    "--no-compress",
    "--lv-font-name",
    "hs_font",
    "-o",
    resolve(root, "firmware/freshmate-korvo/components/display/hs_font.c"),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
