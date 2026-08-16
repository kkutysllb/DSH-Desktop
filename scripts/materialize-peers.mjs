#!/usr/bin/env node
/**
 * 补齐 pnpm deploy 物化运行时的 peer 依赖（deploy 的盲区）。
 *
 * 上游大量包用 peerDependencies 声明协作包（如 dsh-app-boot 的 9 个
 * peer），workspace 里由 pnpm 自动链接满足；`pnpm deploy --prod` 只物化
 * dependencies 闭包，peer 全部漏掉 → 物化产物启动即 ERR_MODULE_NOT_FOUND。
 *
 * 本脚本在 deploy 之后运行：
 * 1. 扫描 staging 内所有实体包的 peerDependencies + dependencies；
 * 2. 缺失且能溯源的（上游 workspace 包 / 上游 node_modules 实体）复制
 *    到 staging/node_modules 顶层（ESM 向上解析的全局兜底位置）；
 * 3. 递归处理新补包自己的依赖引用，直到收敛；
 * 4. 可选 peer（peerDependenciesMeta.optional）跳过并提示。
 *
 * 跨平台（node:fs），CI 三平台与本地 scripts/release.sh build 共用。
 *
 * @module scripts/materialize-peers
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = join(root, 'deepseek-harness')
const staging = join(root, 'staging', 'dsh-runtime')
const topNM = join(staging, 'node_modules')

if (!existsSync(join(staging, 'lib', 'bin.js'))) {
  console.error('[materialize] staging/dsh-runtime 不存在，先运行 pnpm deploy')
  process.exit(1)
}

/** 上游 workspace 包名 → 源目录（pnpm-workspace.yaml globs 的保守展开）。 */
function scanWorkspace() {
  const map = new Map()
  const areas = [
    ['vendor', 1],
    ['packages', 2],
    ['apps', 1],
    // pnpm-workspace.yaml：native/landlock-run 自身（…-workspace 壳）
    // 与其 packages/*（entry = JS 本体；linux-* = 平台子包）都是独立成员
    ['native/landlock-run', 1],
    ['native/landlock-run/packages', 1],
    ['python', 2],
  ]
  const walk = (dir, depth) => {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      try {
        map.set(JSON.parse(readFileSync(pj, 'utf8')).name, dir)
      } catch { /* 忽略坏 manifest */ }
      return
    }
    if (depth <= 0) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'node_modules') walk(join(dir, e.name), depth - 1)
    }
  }
  for (const [area, depth] of areas) {
    const base = join(upstream, area)
    if (existsSync(base)) walk(base, depth)
  }
  return map
}

/** 复制一个包实体到 staging/node_modules/<name>。 */
function placePkg(srcDir, name, fromWorkspace) {
  const dest = join(topNM, name)
  if (existsSync(dest)) return false
  const pkg = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8'))
  mkdirSync(dest, { recursive: true })
  cpSync(join(srcDir, 'package.json'), join(dest, 'package.json'))
  const files = pkg.files
  const hasGlob = Array.isArray(files) && files.some((f) => f.includes('*'))
  if (fromWorkspace && Array.isArray(files) && files.length > 0 && !hasGlob) {
    // workspace 包按 files 精简（源目录含 src/tests/node_modules，不能全带）
    for (const f of files) {
      if (f === 'package.json' || f.endsWith('.md')) continue
      const src = join(srcDir, f)
      if (existsSync(src)) cpSync(src, join(dest, f), { recursive: true, verbatimSymlinks: true })
    }
    // 保底：产物目录总得有一个，否则这个包就是空壳
    for (const d of ['lib', 'dist', 'config', 'build']) {
      if (existsSync(join(dest, d))) break
      if (existsSync(join(srcDir, d))) {
        cpSync(join(srcDir, d), join(dest, d), { recursive: true })
        break
      }
    }
  } else {
    // 外部包一律整目录复制（files 精简会丢原生二进制/动态解析文件；
    // 上游实体本身就是可运行的，保真优先）；workspace 包 files 含 glob
    // 或未声明（npm 语义 = 全部）同样整目录，排除嵌套依赖
    for (const e of readdirSync(srcDir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.bin' || e.name === '.DS_Store') continue
      cpSync(join(srcDir, e.name), join(dest, e.name), { recursive: true, verbatimSymlinks: true })
    }
  }
  return true
}

/** 从上游 node_modules/.pnpm 溯源外部包实体（按目录名前缀索引）。 */
function findExternal(name) {
  const pnpm = join(upstream, 'node_modules', '.pnpm')
  const prefix = name.replace('/', '+') + '@'
  for (const e of readdirSync(pnpm)) {
    if (!e.startsWith(prefix)) continue
    const dir = join(pnpm, e, 'node_modules', name)
    if (existsSync(dir)) return dir
  }
  return null
}

/** staging 内所有 package.json 路径（.pnpm 实体 + 顶层）。 */
function* stagingManifests() {
  const pnpm = join(topNM, '.pnpm')
  if (existsSync(pnpm)) {
    for (const e of readdirSync(pnpm)) {
      const nm = join(pnpm, e, 'node_modules')
      if (!existsSync(nm)) continue
      yield* manifestsUnder(nm)
    }
  }
  yield* manifestsUnder(topNM)
}
function* manifestsUnder(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '.pnpm' || e.name.startsWith('.')) continue
    if (e.name.startsWith('@')) {
      for (const sub of readdirSync(join(dir, e.name), { withFileTypes: true })) {
        const pj = join(dir, e.name, sub.name, 'package.json')
        if (sub.isDirectory() && existsSync(pj)) yield pj
      }
    } else {
      const pj = join(dir, e.name, 'package.json')
      if (existsSync(pj)) yield pj
    }
  }
}

const ws = scanWorkspace()
const placed = []
const skippedOptional = []
let changed = true
while (changed) {
  changed = false
  for (const pj of stagingManifests()) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pj, 'utf8'))
    } catch {
      continue
    }
    const meta = pkg.peerDependenciesMeta ?? {}
    const wanted = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      // 平台二进制包（sharp/koffi/node-pty 的 darwin-arm64 等）全部声明在
      // optionalDependencies，漏扫会导致原生模块运行时缺失
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ])
    for (const name of wanted) {
      if (existsSync(join(topNM, name))) continue
      const optional = meta[name]?.optional === true
      const wsSrc = ws.get(name)
      const src = wsSrc ?? findExternal(name)
      if (src === null) {
        if (!optional && !skippedOptional.includes(name)) {
          skippedOptional.push(name)
        }
        continue
      }
      if (placePkg(src, name, wsSrc !== undefined)) {
        placed.push(name)
        changed = true
      }
    }
  }
}

const missingNote = skippedOptional.length > 0 ? `；未溯源跳过：${skippedOptional.join(', ')}` : ''
console.log(`[materialize] 补齐 ${placed.length} 个包到顶层 node_modules${missingNote}`)

// flatten：symlink 全部替换为实体副本，删除 .pnpm 虚拟存储。
// pnpm 的符号链接布局会被 electron-builder 复制 extraResources 时丢弃
// （node_modules 整体缺席）；扁平 npm 风格布局无此问题且体积更小。
let flattened = 0
const flatten = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.pnpm' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name.startsWith('@')) { flatten(p); continue }
    if (!lstatSync(p).isSymbolicLink()) continue
    const target = resolve(dirname(p), readlinkSync(p))
    rmSync(p)
    if (target.includes(`${sep}.pnpm${sep}`)) {
      cpSync(target, p, { recursive: true })
      flattened++
    }
  }
}
flatten(topNM)
rmSync(join(topNM, '.pnpm'), { recursive: true, force: true })
console.log(`[materialize] flatten：${flattened} 个 symlink→实体，已删 .pnpm`)
// 自检：补完后再扫一轮，纯 peer 引用必须全部可达
for (const pj of stagingManifests()) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pj, 'utf8'))
  } catch {
    continue
  }
  const meta = pkg.peerDependenciesMeta ?? {}
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    if (meta[name]?.optional === true) continue
    if (!existsSync(join(topNM, name))) {
      console.error(`[materialize] 自检失败：${name} 仍不可达（被 ${pj} peer 引用）`)
      process.exit(1)
    }
  }
}
console.log('[materialize] 自检通过：所有非可选 peer 可达')
