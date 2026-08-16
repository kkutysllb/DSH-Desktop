/**
 * 上游 deepseek-harness 契约适配层。
 *
 * 上游处于 developer preview，bin 路径、就绪行格式、CLI flags、
 * DSH_HOME 等约定都可能变化。本文件是桌面端对这些约定的**唯一**引用点：
 * 升级上游后若行为不符，只需要修改这里。
 *
 * 契约依据（2026-08, upstream 0.1.0-rc.5）：
 * - 就绪行：packages/bundle/web-app/src/index.ts `printUrl`
 *   `dsh web: http://127.0.0.1:<port>`（loader 结算后打印，是就绪信号）
 * - CLI：`dsh [--profile web] --host/--port/--trusted-host`；`web` 是
 *   `--profile web` 的硬编码别名；`--port 0` 让 OS 分配端口
 * - 构建产物 bin：apps/cli/package.json `bin.dsh = lib/bin.js`
 * - 源码运行：根 package.json script `dsh = node --import tsx/esm apps/cli/src/bin.ts`
 *   （SRC 回退模式，Web UI 仍需 `pnpm run build` 产物）
 * - Harness home：packages/util/home-paths `DSH_HOME` 环境变量，默认 `~/.dsh`
 * - 插件管理：apps/cli/src/plugin.ts `dsh plugin --profile <name> <pnpm args>`
 *   （pnpm 转发器；声明 `dsh.bundle` 的依赖自动进入层叠）
 * - Profile 清单：`$DSH_HOME/profiles/web/package.json` 的
 *   `dsh.profile.bundles`（层叠顺序）与 `dsh.profile` 声明
 *
 * @module desktop/main/dsh-contract
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { satisfies } from 'semver'
import type { DshSource } from '@shared/ipc-contract'

/** 就绪行的解析规则：`dsh web: http://127.0.0.1:<port>`。 */
export const READY_LINE_RE = /^dsh web: http:\/\/127\.0\.0\.1:(\d+)/

/** 就绪等待上限（毫秒）：dsh 需等 loader 结算后才打印 URL。 */
export const READY_TIMEOUT_MS = 60_000

/** 崩溃自动重启次数上限。 */
export const MAX_AUTO_RESTARTS = 3

/** 上游克隆在本项目中的目录名（被 .gitignore 排除，绝不提交）。 */
export const UPSTREAM_DIR_NAME = 'deepseek-harness'

/** 桌面端工作区根（含 desktop/、scripts/、上游克隆）。 */
export const PROJECT_ROOT = resolve(__dirname, '..', '..')

/** 上游克隆的绝对路径。 */
export const UPSTREAM_DIR = join(PROJECT_ROOT, UPSTREAM_DIR_NAME)

/**
 * 解析 assets/ 下的资产路径（官方 DeepSeek 图标等）。
 * 开发时在项目根 assets/；打包后在 extraResources 的 assets/ 下。
 */
export function resolveAsset(name: string): string {
  const dev = join(PROJECT_ROOT, 'assets', name)
  if (existsSync(dev)) return dev
  return join(process.resourcesPath ?? PROJECT_ROOT, 'assets', name)
}

/** 构建后的 CLI bin（相对上游根）。 */
export const UPSTREAM_BIN = join('apps', 'cli', 'lib', 'bin.js')

/** 上游 web profile 名称。 */
export const WEB_PROFILE = 'web'

/** dsh Harness home（与 CLI / Web 共享同一份数据）。 */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 上游 package.json 的 engines.node 要求；克隆缺失时返回 null。 */
export function upstreamNodeRange(): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(UPSTREAM_DIR, 'package.json'), 'utf8')) as {
      engines?: { node?: string }
    }
    return manifest.engines?.node ?? null
  } catch {
    return null
  }
}

/** 上游克隆是否存在（目录 + git 元数据）。 */
export function upstreamCloned(): boolean {
  return existsSync(join(UPSTREAM_DIR, '.git'))
}

/** 上游是否已完成 `pnpm run build`（以 CLI bin 产物为准）。 */
export function upstreamBuilt(): boolean {
  return existsSync(join(UPSTREAM_DIR, UPSTREAM_BIN))
}

/**
 * 运行 dsh 用的 Node 解释器。
 *
 * 优先系统 node（与用户构建上游时的版本一致），其版本必须满足上游
 * engines.node；不满足时退回 Electron 内置 node（ELECTRON_RUN_AS_NODE）；
 * 都不满足时返回 null（应引导用户修环境）。
 */
export function resolveRuntime(): { command: string; args: string[]; isElectron: boolean } | null {
  const range = upstreamNodeRange()
  const sysNode = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 5_000 })
  const sysOk =
    sysNode.status === 0 && typeof sysNode.stdout === 'string'
    && (range === null || satisfies(sysNode.stdout.trim().slice(1), range))
  if (sysOk) return { command: 'node', args: [], isElectron: false }
  const electronVersion = `v${process.versions.node}`
  if (range === null || satisfies(electronVersion.slice(1), range)) {
    return { command: process.execPath, args: [], isElectron: true }
  }
  return null
}

/** 一条可执行的 dsh 命令描述。 */
export interface DshCommand {
  source: DshSource
  /** 进程命令（解释器或可执行文件）。 */
  command: string
  /** command 之后、子命令之前的固定参数（如 bin 路径）。 */
  baseArgs: string[]
  /** 工作目录。 */
  cwd: string
  /** 需要注入的环境（ELECTRON_RUN_AS_NODE 等）。 */
  env: NodeJS.ProcessEnv
  /** 人类可读描述（诊断面板展示）。 */
  describe: string
}

/**
 * 解析启动 dsh 的命令，优先级：
 * 1. `DSH_BIN` 环境变量（可执行文件或 `node script.js` 形式）
 * 2. 本地克隆的构建产物（`node apps/cli/lib/bin.js`）
 * 3. PATH 中的 `dsh`
 *
 * @returns 命令描述；找不到任何可用来源时返回 null。
 */
export function resolveDshCommand(): DshCommand | null {
  // 1) 显式环境变量：支持 "dsh" 或 "node /path/bin.js"
  const envBin = process.env.DSH_BIN
  if (envBin !== undefined && envBin !== '') {
    const parts = envBin.split(/\s+/)
    return {
      source: 'env',
      command: parts[0],
      baseArgs: parts.slice(1),
      cwd: UPSTREAM_DIR,
      env: {},
      describe: `$DSH_BIN: ${envBin}`,
    }
  }

  // 2) 本地克隆的构建产物
  if (upstreamCloned() && upstreamBuilt()) {
    const runtime = resolveRuntime()
    if (runtime !== null) {
      return {
        source: 'checkout',
        command: runtime.command,
        baseArgs: [...runtime.args, join(UPSTREAM_DIR, UPSTREAM_BIN)],
        cwd: UPSTREAM_DIR,
        env: runtime.isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
        describe: `本地克隆: ${runtime.isElectron ? 'Electron node' : '系统 node'} ${join(UPSTREAM_DIR, UPSTREAM_BIN)}`,
      }
    }
    return null
  }

  // 3) PATH 中的 dsh（用户全局安装了 @deepseek-ai/dsh 或自行链接）
  const probe = spawnSync('dsh', ['--version'], { encoding: 'utf8', timeout: 10_000 })
  if (probe.status === 0) {
    return {
      source: 'path',
      command: 'dsh',
      baseArgs: [],
      cwd: UPSTREAM_DIR,
      env: {},
      describe: 'PATH 中的 dsh',
    }
  }
  return null
}
