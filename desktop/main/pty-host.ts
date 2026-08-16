/**
 * pty 宿主：内嵌终端的真实终端进程管理（node-pty，VS Code 同款）。
 *
 * 单会话模型（v1）：一个 shell 进程，面板关闭仅隐藏（进程保留，
 * 会话不丢），显式 restart 才销毁重建。工作目录 = 当前任务的工作区
 * （terminal-panel 的页面探针解析后经 toggle/缓存传入）。
 *
 * 数据链路：xterm（终端视图）→ IPC terminal:write → pty.write；
 * pty.onData → IPC terminal:data 广播 → xterm。resize 同理。
 *
 * @module desktop/main/pty-host
 */

import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { spawn as ptySpawn, type IPty } from 'node-pty'

/** 事件面：data（pty → 终端）、exit（进程退出）。 */
export interface PtyHostEvents {
  data: (chunk: string) => void
  exit: (info: { cwd: string; title: string }) => void
}

/** pty 会话宿主（单例语义，由 terminal-panel 持有调用）。 */
export class PtyHost {
  private readonly events = new EventEmitter()
  private pty: IPty | null = null
  private cwd = ''
  private exited = false

  on<K extends keyof PtyHostEvents>(event: K, listener: PtyHostEvents[K]): this {
    this.events.on(event, listener)
    return this
  }

  off<K extends keyof PtyHostEvents>(event: K, listener: PtyHostEvents[K]): this {
    this.events.off(event, listener)
    return this
  }

  /** 当前会话信息（终端视图 header 显示用）。 */
  info(): { alive: boolean; cwd: string; title: string } {
    return { alive: this.pty !== null && !this.exited, cwd: this.cwd, title: this.shellTitle() }
  }

  /**
   * 确保会话存在（存在则原样复用——面板重开不丢 shell 历史）。
   * @param preferredCwd - 首选工作目录（页面探针给的工作区路径）。
   */
  ensure(preferredCwd: string | null): void {
    if (this.pty !== null && !this.exited) return
    const cwd = usableDir(preferredCwd) ?? homedir()
    this.start(cwd)
  }

  /** 销毁并用（可能已变化的）工作区目录重建。 */
  restart(preferredCwd: string | null): void {
    const cwd = usableDir(preferredCwd) ?? this.cwd ?? homedir()
    this.dispose()
    this.start(cwd)
  }

  write(data: string): void {
    this.pty?.write(data)
  }

  resize(cols: number, rows: number): void {
    try { this.pty?.resize(cols, rows) } catch {
      // 进程退出瞬间 resize 会抛错，忽略（exit 事件会接手）
    }
  }

  /** 彻底销毁（应用退出/窗口关闭时调用）。 */
  dispose(): void {
    if (this.pty !== null) {
      try { this.pty.kill() } catch { /* 已退出 */ }
      this.pty = null
    }
    this.exited = false
  }

  private start(cwd: string): void {
    this.cwd = cwd
    this.exited = false
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh')
    const args = process.platform === 'win32' ? [] : ['--login']
    this.pty = ptySpawn(shell, args, {
      name: 'xterm-256color',
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
      cols: 80,
      rows: 24,
    })
    this.pty.onData(chunk => { this.events.emit('data', chunk) })
    this.pty.onExit(() => {
      this.exited = true
      this.events.emit('exit', { cwd: this.cwd, title: this.shellTitle() })
    })
  }

  private shellTitle(): string {
    const shell = process.platform === 'win32' ? 'powershell' : (process.env.SHELL || '/bin/zsh')
    return basename(shell)
  }
}

/** 目录可用性校验：存在且是目录才采用，否则交给回退。 */
function usableDir(path: string | null): string | null {
  if (path === null || path === '') return null
  try {
    if (!statSync(path).isDirectory()) return null
    return path
  } catch {
    return null
  }
}

/** 供终端视图 header 显示的目录短名。 */
export function dirLabel(cwd: string): string {
  if (cwd === '') return '~'
  return basename(cwd) || cwd
}
