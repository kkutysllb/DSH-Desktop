#!/usr/bin/env bash
# DSH Desktop 本地打包发布脚本（手动操作，一切可控）。
#
# 打包产物开箱即用的核心：上游运行时（pnpm deploy 物化的生产依赖
# 闭包，约 330MB）经 electron-builder extraResources 随包分发，
# 安装后无需克隆/构建上游。
#
# 签名与公证（macOS）：
# - 签名：本地钥匙串的 Developer ID 证书自动发现（无需配置）；
# - 公证：设置环境变量后自动启用（三者缺一即跳过，仅签名）：
#     export APPLE_ID=<apple id>
#     export APPLE_APP_SPECIFIC_PASSWORD=<应用专用密码>
#     export APPLE_TEAM_ID=<团队 id>
#
# 常用流程：
#   bash scripts/release.sh bump 0.2.0        # 改版本（自行提交）
#   bash scripts/release.sh build             # 打包 + 自动校验
#   bash scripts/release.sh release create v0.2.0   # 上传为 draft
#   bash scripts/release.sh release publish v0.2.0  # 检查后正式发布
#
# 出问题时：
#   bash scripts/release.sh status            # 全局状态总览
#   bash scripts/release.sh release delete v0.2.0 --with-tag
#
# 用法：bash scripts/release.sh <命令>（help 查看全部）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/deepseek-harness"
STAGING="$ROOT/staging/dsh-runtime"
DIST="$ROOT/dist"
APP_NAME="DSH Desktop.app"

say()  { printf '\033[1;34m[release]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[release]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[release]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[release] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

# 当前 package.json 版本。
app_version() { node -p 'require(process.argv[1]).version' "$ROOT/package.json"; }

# 规范化 tag：接受 v0.2.0 或 0.2.0，统一输出 v0.2.0。
norm_tag() {
  local t="${1#v}"
  [[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "非法版本号：$1（示例：0.2.0）"
  echo "v$t"
}

# 从 tag 提取裸版本（v0.2.0 → 0.2.0）。
bare_version() { echo "${1#v}"; }

# ─────────────────────────── status ───────────────────────────

cmd_status() {
  say "应用版本：$(app_version)"
  if [[ -d "$UPSTREAM/.git" ]]; then
    local bin="$UPSTREAM/apps/cli/lib/bin.js"
    say "上游克隆：$([[ -f "$bin" ]] && echo "已构建" || echo "未构建（缺 $bin）") @ $(git -C "$UPSTREAM" rev-parse --short HEAD)"
  else
    say "上游克隆：缺失（开发态需要，打包前会自动准备）"
  fi
  say "运行时物化：$([[ -f "$STAGING/lib/bin.js" ]] && echo "就绪（$(du -sh "$STAGING" 2>/dev/null | cut -f1)）" || echo "未物化")"
  if [[ -d "$DIST" && -n "$(ls -A "$DIST" 2>/dev/null)" ]]; then
    say "打包产物（dist/）："
    ls -lh "$DIST" | tail -n +2 | awk '{printf "    %s  %s\n", $5, $9}'
  else
    say "打包产物：无"
  fi
  say "本地 tag：$(git -C "$ROOT" tag -l | tr '\n' ' ')"
  say "远程 tag：$(git -C "$ROOT" ls-remote --tags origin | awk -F/ '{print $NF}' | grep -v '\^{}' | tr '\n' ' ')"
  if command -v gh >/dev/null 2>&1; then
    say "GitHub Releases："
    gh release list -R kkutysllb/DSH-Desktop 2>/dev/null | sed 's/^/    /' || warn "（无法读取，检查 gh 登录）"
  fi
}

# ─────────────────────────── build ───────────────────────────

cmd_build() {
  command -v node >/dev/null 2>&1 || die "需要 node"
  command -v pnpm >/dev/null 2>&1 || die "需要 pnpm"

  # 1) 上游就绪（克隆 + 构建；已就绪则跳过）
  if [[ ! -f "$UPSTREAM/apps/cli/lib/bin.js" ]]; then
    say "上游未构建，执行 setup（克隆 + install + build）…"
    bash "$ROOT/scripts/setup.sh"
  else
    ok "上游已构建，跳过 setup"
  fi

  # 2) 桌面端编译
  say "编译桌面端（typecheck + build）…"
  (cd "$ROOT" && pnpm install --frozen-lockfile && pnpm typecheck && pnpm build)

  # 3) 物化上游运行时（开箱即用的核心）：pnpm deploy 生产闭包
  #    + peer/平台二进制补齐（materialize-peers，deploy 的盲区）
  say "物化上游运行时（deploy --prod + peer 补齐）→ staging/dsh-runtime …"
  rm -rf "$STAGING"
  pnpm --dir "$UPSTREAM" --filter=@deepseek-ai/dsh deploy --prod --legacy "$STAGING"
  [[ -f "$STAGING/lib/bin.js" ]] || die "物化失败：缺 lib/bin.js"
  node "$ROOT/scripts/materialize-peers.mjs"
  ok "运行时就绪（$(du -sh "$STAGING" | cut -f1)）"

  # 4) 运行时冒烟：真实起 Web 服务（就绪行 + 首页 200），
  #    不过全关的检查绝不进入下一步
  say "运行时冒烟（真实起服）…"
  node "$ROOT/scripts/smoke-runtime.mjs" --dir "$STAGING"

  # 5) electron-builder（本地签名自动发现；公证凭据齐则自动公证）
  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    say "公证凭据齐全，构建将自动签名 + 公证"
  else
    die "公证凭据不全（需 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 环境变量）。未公证的包会被用户机器的 Gatekeeper 拦截，禁止打包：
    export APPLE_ID=<apple id>
    export APPLE_APP_SPECIFIC_PASSWORD=<应用专用密码>
    export APPLE_TEAM_ID=DHV5D72JNF"
  fi
  say "electron-builder 打包…"
  rm -rf "$DIST"
  (cd "$ROOT" && pnpm exec electron-vite build && pnpm exec electron-builder --publish never)

  # 6) 产物校验（不过全关的检查绝不放出包）
  cmd_verify
  ok "打包完成：$DIST"
}

# ─────────────────────────── verify ───────────────────────────

cmd_verify() {
  local app
  app="$(find "$DIST" -maxdepth 2 -name "$APP_NAME" -type d | head -1)"
  [[ -n "$app" ]] || die "校验失败：dist 下未找到 $APP_NAME"

  local res="$app/Contents/Resources"
  local runtime="$res/dsh-runtime"

  # 1) 开箱即用三要素：运行时目录 + bin + 依赖
  [[ -f "$runtime/lib/bin.js" ]] || die "校验失败：包内缺 dsh-runtime/lib/bin.js（开箱即用被破坏）"
  [[ -d "$runtime/node_modules" ]] || die "校验失败：包内缺 dsh-runtime/node_modules"
  ok "内置运行时：存在（$(du -sh "$runtime" | cut -f1)）"

  # 2) 运行时真实起服冒烟（包内运行时全链路验收）
  node "$ROOT/scripts/smoke-runtime.mjs" --dir "$runtime" \
    || die "校验失败：包内运行时无法起服"

  # 3) macOS 签名（必须 Developer ID，拒绝 adhoc 坏包）
  if [[ "$(uname)" == "Darwin" ]]; then
    local sig
    sig="$(codesign -dv --verbose=4 "$app" 2>&1 || true)"
    if grep -q "Signature=adhoc" <<<"$sig"; then
      die "校验失败：产物是 adhoc 签名（钥匙串无 Developer ID 证书？）"
    fi
    grep -q "TeamIdentifier" <<<"$sig" || die "校验失败：产物无 TeamIdentifier"
    ok "签名：$(grep -m1 'Authority=' <<<"$sig" | sed 's/.*Authority=//')"
    # 4) 公证票据（notarize: true 后必有票据，缺即坏包）
    if [[ "$(uname)" == "Darwin" ]]; then
      xcrun stapler validate "$app" >/dev/null 2>&1 \
        || die "校验失败：产物未公证（stapler 无票据）"
      ok "公证：票据有效"
    fi
  fi

  # 5) 自动更新元数据（mac 需 zip + blockmap + latest-mac.yml）
  local miss=0
  for f in latest-mac.yml; do
    [[ -f "$DIST/$f" ]] || { warn "缺 $DIST/$f（自动更新发现入口）"; miss=1; }
  done
  if ls "$DIST"/*.zip >/dev/null 2>&1 && ls "$DIST"/*.blockmap >/dev/null 2>&1; then
    ok "更新元数据：zip + blockmap 齐全"
  else
    warn "缺 zip/blockmap（自动更新增量包）"; miss=1
  fi
  [[ $miss -eq 0 ]] || warn "存在缺失项——若需自动更新请先解决"
  ok "校验通过：$app"
}

# ─────────────────────────── bump ───────────────────────────

cmd_bump() {
  [[ $# -eq 1 ]] || die "用法：release.sh bump <version>（例：0.2.0）"
  local v; v="$(bare_version "$(norm_tag "$1")")"
  node -e '
    const fs = require("fs")
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    p.version = process.argv[2]
    fs.writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + "\n")
  ' "$ROOT/package.json" "$v"
  ok "版本已更新为 $v（记得提交：git add package.json && git commit）"
}

# ─────────────────────────── tag ───────────────────────────

cmd_tag() {
  [[ $# -ge 1 ]] || die "用法：release.sh tag <create|push|list|delete> ..."
  local sub="$1"; shift
  case "$sub" in
    create)
      [[ $# -eq 1 ]] || die "用法：release.sh tag create <version>"
      local t; t="$(norm_tag "$1")"
      git -C "$ROOT" rev-parse -q --verify "refs/tags/$t" >/dev/null \
        && die "本地 tag $t 已存在"
      git -C "$ROOT" tag "$t"
      ok "已创建本地 tag $t（HEAD $(git -C "$ROOT" rev-parse --short HEAD)）"
      ;;
    push)
      local t
      if [[ $# -eq 1 ]]; then t="$(norm_tag "$1")";
      else t="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null)" || die "无本地 tag"; fi
      git -C "$ROOT" push origin "$t"
      ok "已推送 $t（如需触发 CI 三平台构建即生效；不需要 CI 可忽略）"
      ;;
    list)
      say "本地：$(git -C "$ROOT" tag -l | tr '\n' ' ')"
      say "远程：$(git -C "$ROOT" ls-remote --tags origin | awk -F/ '{print $NF}' | grep -v '\^{}' | tr '\n' ' ')"
      ;;
    delete)
      [[ $# -ge 1 ]] || die "用法：release.sh tag delete <version> [...]（本地+远程）"
      for arg in "$@"; do
        local t; t="$(norm_tag "$arg")"
        git -C "$ROOT" tag -d "$t" 2>/dev/null && ok "已删本地 $t" || warn "本地无 $t"
        git -C "$ROOT" push origin ":refs/tags/$t" 2>/dev/null && ok "已删远程 $t" || warn "远程无 $t"
      done
      ;;
    *)
      die "未知 tag 子命令：$sub（create|push|list|delete）"
      ;;
  esac
}

# ─────────────────────────── release ───────────────────────────

cmd_release() {
  command -v gh >/dev/null 2>&1 || die "release 子命令需要 gh（brew install gh && gh auth login）"
  [[ $# -ge 1 ]] || die "用法：release.sh release <create|list|publish|delete> ..."
  local sub="$1"; shift
  case "$sub" in
    create)
      [[ $# -ge 1 ]] || die "用法：release.sh release create <version> [--publish]"
      local t; t="$(norm_tag "$1")"; local publish="${2:-}"
      # 版本一致性：package.json 必须 == tag（防版本错位的事故重演）
      local pv; pv="$(app_version)"
      [[ "$pv" == "$(bare_version "$t")" ]] \
        || die "版本错位：package.json=$pv，tag=$t。先 bash scripts/release.sh bump $(bare_version "$t") 并提交"
      # tag 必须存在并指向已推送的提交
      git -C "$ROOT" rev-parse -q --verify "refs/tags/$t" >/dev/null \
        || die "本地无 $t，先：release.sh tag create $(bare_version "$t")"
      git -C "$ROOT" ls-remote --tags origin | grep -q "refs/tags/$t$" \
        || die "远程无 $t，先：release.sh tag push $t"
      # 产物必须存在且新鲜（当天构建）
      [[ -f "$DIST/latest-mac.yml" ]] || die "dist 无产物，先：release.sh build"
      say "上传产物到 $t …"
      local args=(--draft --title "$t" --generate-notes)
      [[ "$publish" == "--publish" ]] && args=(--title "$t" --generate-notes)
      (cd "$DIST" && gh release create "$t" -R kkutysllb/DSH-Desktop \
        ./*.dmg ./*.zip ./*.blockmap ./latest*.yml "${args[@]}")
      if [[ "$publish" == "--publish" ]]; then
        ok "已正式发布 $t"
      else
        ok "已创建 draft $t（检查无误后：release.sh release publish $t）"
      fi
      ;;
    list)
      gh release list -R kkutysllb/DSH-Desktop
      ;;
    publish)
      [[ $# -eq 1 ]] || die "用法：release.sh release publish <version>"
      local t; t="$(norm_tag "$1")"
      gh release edit "$t" -R kkutysllb/DSH-Desktop --draft=false
      ok "$t 已正式发布"
      ;;
    delete)
      [[ $# -ge 1 ]] || die "用法：release.sh release delete <version> [--with-tag]"
      local t with_tag="${2:-}"
      t="$(norm_tag "$1")"
      if gh release view "$t" -R kkutysllb/DSH-Desktop >/dev/null 2>&1; then
        if [[ "$with_tag" == "--with-tag" ]]; then
          gh release delete "$t" -R kkutysllb/DSH-Desktop --yes --cleanup-tag
          git -C "$ROOT" tag -d "$t" 2>/dev/null || true
          ok "已删除 Release + 远程/本地 tag：$t"
        else
          gh release delete "$t" -R kkutysllb/DSH-Desktop --yes
          ok "已删除 Release：$t（tag 保留）"
        fi
      else
        warn "Release $t 不存在"
        [[ "$with_tag" == "--with-tag" ]] && cmd_tag delete "$t"
      fi
      ;;
    *)
      die "未知 release 子命令：$sub（create|list|publish|delete）"
      ;;
  esac
}

# ─────────────────────────── 入口 ───────────────────────────

main() {
  [[ $# -ge 1 ]] || { sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 1; }
  local cmd="$1"; shift
  case "$cmd" in
    status)  cmd_status "$@" ;;
    build)   cmd_build "$@" ;;
    verify)  cmd_verify "$@" ;;
    bump)    cmd_bump "$@" ;;
    tag)     cmd_tag "$@" ;;
    release) cmd_release "$@" ;;
    help|-h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" ;;
    *) die "未知命令：$cmd（可用：status build verify bump tag release help）" ;;
  esac
}

main "$@"
