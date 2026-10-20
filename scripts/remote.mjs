import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
const mode = process.argv[2];
if (!["install", "deploy"].includes(mode)) throw Error("无效部署命令");
const c = parseEnv(readFileSync(".deploy.env", "utf8"));
for (const key of ["DEPLOY_SSH_HOST", "DEPLOY_DOMAIN", "DEPLOY_PROXY_HOST"])
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(c[key] ?? ""))
    throw Error(`配置无效：${key}`);
if (!/^[a-z_][a-z0-9_-]*$/.test(c.DEPLOY_SSH_USER ?? ""))
  throw Error("SSH 用户无效");
if (!/^[\w.+-]+@[\w.-]+$/.test(c.DEPLOY_TLS_EMAIL ?? ""))
  throw Error("TLS 邮箱无效");
for (const key of [
  "DEPLOY_SSH_PORT",
  "DEPLOY_WEB_PORT",
  "DEPLOY_CORE_PORT",
  "DEPLOY_PROXY_PORT",
  "DEPLOY_HTTP_PROXY_PORT",
])
  if (!/^\d+$/.test(c[key] ?? "") || +c[key] < 1 || +c[key] > 65535)
    throw Error(`端口无效：${key}`);
if (c.DEPLOY_WEB_PORT === c.DEPLOY_CORE_PORT) throw Error("服务端口不能相同");
if (!["true", "false"].includes(c.DEPLOY_USE_PROXY))
  throw Error("代理开关无效");
if (process.argv.includes("--check")) {
  console.log(`配置通过：${c.DEPLOY_SSH_HOST} → https://${c.DEPLOY_DOMAIN}`);
  process.exit(0);
}
const env = { ...process.env, COPYFILE_DISABLE: "1" };
for (const k of Object.keys(env))
  if (/^(all|http|https|no)_proxy$/i.test(k)) delete env[k];
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { env, stdio: "inherit", ...options });
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const opts = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ServerAliveInterval=30",
];
const target = `${c.DEPLOY_SSH_USER}@${c.DEPLOY_SSH_HOST}`;
const ssh = (command, capture = false) =>
  run(
    "ssh",
    [...opts, "-p", c.DEPLOY_SSH_PORT, target, command],
    capture ? { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] } : {},
  );
const installed =
  ssh(
    "sudo -n sh -c 'test ! -f /var/www/homestash/shared/installed || printf installed'",
    true,
  ) === "installed";
if (mode === "install" && installed) {
  console.log("首次安装已完成，跳过。日常更新请执行 pnpm server:deploy");
  process.exit(0);
}
if (mode === "deploy" && !installed)
  throw Error("请先执行 pnpm server:install");
const work = mkdtempSync(join(tmpdir(), "homestash-publish-"));
try {
  let archive;
  if (mode === "deploy" && process.env.HOMESTASH_RELEASE_ARCHIVE) {
    archive = process.env.HOMESTASH_RELEASE_ARCHIVE;
    if (!/^homestash-[\w-]+\.tar\.gz$/.test(basename(archive)))
      throw Error("发布包名称无效");
    const expected = readFileSync(archive + ".sha256", "utf8").split(/\s+/)[0];
    if (
      createHash("sha256").update(readFileSync(archive)).digest("hex") !==
      expected
    )
      throw Error("发布包校验失败");
  } else if (mode === "deploy") {
    run("bash", ["scripts/build-release.sh"], {
      env: {
        ...env,
        HOMESTASH_RELEASE_OUTPUT: work,
        CORE_INTERNAL_URL: `http://127.0.0.1:${c.DEPLOY_CORE_PORT}`,
      },
    });
    archive = readFileSync(join(work, "latest-release.txt"), "utf8").trim();
  } else {
    archive = join(work, `homestash-bootstrap-${Date.now()}.tar.gz`);
    run("tar", [
      "--no-xattrs",
      "-czf",
      archive,
      "scripts/server-install.sh",
      "scripts/server-common.sh",
      "scripts/configure-internal-auth.mjs",
      "scripts/server-port-audit.py",
      "docs/nginx.conf.template",
    ]);
  }
  const name = basename(archive),
    hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
  run("scp", [
    ...opts,
    "-P",
    c.DEPLOY_SSH_PORT,
    archive,
    `${target}:/tmp/${name}`,
  ]);
  const exports = Object.entries(c)
    .filter(([k]) =>
      /^DEPLOY_(DOMAIN|TLS_EMAIL|WEB_PORT|CORE_PORT|USE_PROXY|PROXY_HOST|PROXY_PORT|HTTP_PROXY_PORT)$/.test(
        k,
      ),
    )
    .map(([k, v]) => `${k}=${quote(v)}`)
    .join(" ");
  const script = `set -euo pipefail\ncd /tmp\nprintf '%s  %s\\n' '${hash}' '${name}' | sha256sum -c -\nstage=$(mktemp -d /tmp/homestash-upload.XXXXXX)\ntrap 'rm -rf "$stage"; rm -f /tmp/${name}' EXIT\ntar --no-same-owner --no-same-permissions -xzf '${name}' -C "$stage"\nrelease="$stage${mode === "deploy" ? "/release" : ""}"\ntest -x "$release/scripts/server-${mode}.sh"\nenv ${exports} bash "$release/scripts/server-${mode}.sh" "$release"`;
  ssh(`sudo -n bash -c ${quote(script)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
