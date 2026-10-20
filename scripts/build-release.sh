#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/homestash-build.XXXXXX")"
stage_root="$(mktemp -d "${TMPDIR:-/tmp}/homestash-stage.XXXXXX")"
trap 'rm -rf "$build_root" "$stage_root"' EXIT
rsync -a --exclude='._*' --exclude='.git' --exclude='.env*' --exclude='.deploy.env*' --exclude=node_modules --exclude=.next --exclude=dist --exclude='*.tsbuildinfo' --exclude=output --exclude=build --exclude=managed_components --exclude=vendor --exclude=data --exclude=__pycache__ ./ "$build_root/"
cd "$build_root"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec esbuild services/kitchen-core/src/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/core.mjs --external:better-sqlite3 --external:fastify --external:dotenv --external:zod --external:drizzle-orm
mkdir -p "$stage_root/release/apps/web" "$stage_root/release/scripts" "$stage_root/release/docs"
cp package.json pnpm-lock.yaml pnpm-workspace.yaml ecosystem.config.cjs "$stage_root/release/"
cp -R dist "$stage_root/release/"
cp -R packages/database/migrations "$stage_root/release/"
for dir in packages/* services/*; do
 mkdir -p "$stage_root/release/$dir"
 cp "$dir/package.json" "$stage_root/release/$dir/"
done
cp apps/web/package.json "$stage_root/release/apps/web/"
cat > "$stage_root/release/apps/web/next.config.mjs" <<'JS'
export default { async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.CORE_INTERNAL_URL}/api/:path*` }]; } };
JS
cp -R apps/web/public "$stage_root/release/apps/web/"
rsync -a --exclude=cache --exclude=dev --exclude=trace --exclude='*.map' apps/web/.next/ "$stage_root/release/apps/web/.next/"
cp scripts/server-common.sh scripts/server-install.sh scripts/server-deploy.sh scripts/server-port-audit.py scripts/native-service.mjs scripts/health-check.mjs scripts/configure-internal-auth.mjs scripts/sync-internal-access.mjs "$stage_root/release/scripts/"
cp docs/nginx.conf.template "$stage_root/release/docs/"
chmod +x "$stage_root/release/scripts/"*.sh
if find "$stage_root/release" \( -name '.env*' -o -name node_modules -o -name .git \) -print -quit | grep -q .; then echo '发布包含不应上传的文件'; exit 1; fi
output="${HOMESTASH_RELEASE_OUTPUT:-$root/output}"
mkdir -p "$output"
archive="$output/homestash-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3).tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" -C "$stage_root" release
(cd "$output" && shasum -a 256 "$(basename "$archive")" > "$(basename "$archive").sha256")
printf '%s\n' "$archive" > "$output/latest-release.txt"
echo "发布包：$archive"
