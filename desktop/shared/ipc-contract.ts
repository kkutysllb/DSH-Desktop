/**
 * 主进程 ↔ 渲染进程的 IPC 契约（双向唯一事实源）。
 *
 * 主进程在 ipc.ts 中按本文件注册；preload 按本文件暴露；
 * 渲染页面只 import 本文件类型，不感知 Electron。
 *
 * @module desktop/shared/ipc-contract
 */

/* ---------- dsh 侧车状态 ---------- */

/** dsh 侧车进程的运行状态机。 */
export type DshState = 'stopped' | 'starting' | 'ready' | 'failed' | 'restarting'

/** 一次状态快照，随 `dsh:state-changed` 广播，也可 `dsh:status` 拉取。 */
export interface DshStatus {
  state: DshState
  /** 就绪后的 Web UI 地址（http://127.0.0.1:<port>）。 */
  url: string | null
  /** 使用的启动来源。 */
  source: DshSource | null
  /** 最近一次失败原因（state=failed 时有值）。 */
  error: string | null
  /** 本会话内崩溃自动重启的剩余次数。 */
  restartsLeft: number
}

/** dsh 命令解析来源。 */
export type DshSource = 'env' | 'checkout' | 'path'

/** dsh:logs 事件的一行日志。 */
export interface DshLogLine {
  stream: 'stdout' | 'stderr'
  line: string
  at: number
}

/* ---------- 上游仓库 ---------- */

/** 上游克隆的状态快照。 */
export interface UpstreamStatus {
  /** 上游克隆目录是否存在。 */
  cloned: boolean
  /** 当前 HEAD 短哈希。 */
  head: string | null
  /** 本地是否领先远端（自有提交）。 */
  ahead: boolean
  /** 本地是否落后远端（可同步）。 */
  behind: boolean
  /** 落后提交数（-1 表示未知）。 */
  behindCount: number
  /** 工作树是否被改动（同步会被拒绝）。 */
  dirty: boolean
  /** 构建产物（apps/cli/lib/bin.js）是否已生成。 */
  built: boolean
  /** 上游声明的 node 版本要求。 */
  nodeRange: string | null
}

/** upstream:progress 事件的一条流水线输出。 */
export interface UpstreamProgress {
  /** 当前步骤标签。 */
  step: string
  /** 一行输出（空串表示步骤完成）。 */
  line: string
  /** 是否出错终止。 */
  error: boolean
}

/* ---------- 插件 ---------- */

/** profile 中已安装的一个 bundle 层。 */
export interface InstalledPlugin {
  name: string
  /** 层叠顺序（0 = 最底层）。 */
  layer: number
  /** 是否随发行版模板内置（不可卸载）。 */
  inBox: boolean
}

/** GitHub dsh-plugin 社区插件条目。 */
export interface CommunityPlugin {
  fullName: string
  description: string
  stars: number
  updatedAt: string
  url: string
}

/** 一次插件命令（add/remove/update）的执行结果。 */
export interface PluginCommandResult {
  ok: boolean
  /** 合并后的命令输出（尾部若干行）。 */
  output: string
}

/* ---------- preload 暴露面 ---------- */

/** preload 通过 contextBridge 暴露的 `window.dshDesktop`。 */
export interface DesktopBridge {
  /* 拉取 */
  dshStatus(): Promise<DshStatus>
  dshLogs(): Promise<DshLogLine[]>
  upstreamStatus(): Promise<UpstreamStatus>
  pluginsInstalled(): Promise<InstalledPlugin[]>
  pluginsCommunity(): Promise<CommunityPlugin[]>
  /* 动作 */
  dshStart(): Promise<DshStatus>
  dshRestart(): Promise<DshStatus>
  openExternal(url: string): Promise<void>
  revealPath(path: string): Promise<void>
  upstreamSync(): Promise<{ ok: boolean; error: string | null }>
  upstreamSetup(): Promise<{ ok: boolean; error: string | null }>
  pluginAdd(pkg: string): Promise<PluginCommandResult>
  pluginRemove(pkg: string): Promise<PluginCommandResult>
  pluginUpdate(pkg: string): Promise<PluginCommandResult>
  /* 事件订阅（返回退订函数） */
  onDshStateChanged(cb: (s: DshStatus) => void): () => void
  onDshLog(cb: (l: DshLogLine) => void): () => void
  onUpstreamProgress(cb: (p: UpstreamProgress) => void): () => void
}
