/**
 * 工作区终端：在 shell 窗口自绘标题栏右上角注入终端按钮，点击后用
 * 系统终端打开当前任务（当前选中会话）的工作区目录。
 *
 * 上游契约（全部运行时探测，上游零改动）：
 * - 当前会话：侧边栏选中行 `[role="treeitem"][aria-selected="true"]`
 *   （ui-workspace Rows.tsx 的 SessionNodeItem 渲染），沿 React fiber
 *   上溯取 props.node.id——DOM 不暴露会话 id、URL 无路由，fiber 是
 *   唯一稳定来源（上游锁定版本，React 18/19 均为 __reactFiber$ 前缀）；
 * - 会话 → 工作区：`POST /api/workspace.list`（apiproxy fetch/handler.ts
 *   UNARY_ROUTES，client-request 信封、Response.json 应答），items 中
 *   sessionIds 命中该会话的即目标工作区，`path` 为本地目录；
 *   无选中会话时回退 items 里 updatedAt 最新者；
 * - 按钮宿主：theme-watcher 注入的自绘标题栏（#__dsh_desktop_titlebar），
 *   两者同为 did-finish-load 触发、时序不保证，注入脚本轮询等待挂载。
 *
 * 通信：探针与 fetch 都在页面上下文完成（同源、随页面凭据），结果经
 * console 通道 `__dsh_terminal__:<json>` 回传（与主题通道同款机制）。
 *
 * @module desktop/main/workspace-terminal
 */

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'

/** console 通道前缀（与注入脚本约定）。 */
const TERMINAL_PREFIX = '__dsh_terminal__:'

/** linux 终端候选（发行版差异，按优先级回退；mac/win 用各自的固定命令）。 */
const LINUX_TERMINALS: ReadonlyArray<{ cmd: string; args: (dir: string) => string[] }> = [
  { cmd: 'x-terminal-emulator', args: dir => [`--working-directory=${dir}`] },
  { cmd: 'gnome-terminal', args: dir => [`--working-directory=${dir}`] },
  { cmd: 'konsole', args: dir => ['--workdir', dir] },
  { cmd: 'xfce4-terminal', args: dir => [`--working-directory=${dir}`] },
]

/**
 * 注入脚本（页面上下文）：等待自绘标题栏挂载后在其右上角放终端按钮。
 * 点击 → 探针当前会话 → 同源 fetch workspace.list → console 通道上报。
 */
const TERMINAL_JS = `(() => {
  if (window.__dshTerminalWired) return
  window.__dshTerminalWired = true
  const PREFIX = '__dsh_terminal__:'
  const BAR_ID = '__dsh_desktop_titlebar'
  const BTN_ID = '__dsh_desktop_terminal_btn'

  // 样式走 <style> + 上游主题属性选择器（body[data-ds-dark-theme]）：
  // 颜色随主题实时切换，无需 JS 观察；no-drag 使按钮在拖拽区可点击
  const style = document.createElement('style')
  style.id = '__dsh_desktop_terminal_style'
  style.textContent = [
    '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;right:12px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.8)}',
    '#' + BTN_ID + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN_ID + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
  ].join('')
  document.head.append(style)

  // 当前会话探针：选中行沿 React fiber 上溯取 props.node.id
  // （SessionNodeItem 的 props 携带完整 session node）
  const probeSessionId = () => {
    const rows = document.querySelectorAll('[role="treeitem"][aria-selected="true"]')
    for (const el of rows) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
      let fiber = fiberKey !== undefined ? el[fiberKey] : null
      while (fiber != null) {
        const node = fiber.memoizedProps != null ? fiber.memoizedProps.node : null
        if (node != null && typeof node.id === 'string') return node.id
        fiber = fiber.return
      }
    }
    return null
  }

  // 会话 → 工作区：命中 sessionIds 优先，无选中会话回退最新 updatedAt
  const resolveWorkspace = async () => {
    const res = await fetch('/api/workspace.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'dsh-desktop-terminal',
        method: 'workspace.list', payload: {},
      }),
    })
    if (!res.ok) return null
    const envelope = await res.json().catch(() => null)
    const result = envelope != null && envelope.result != null ? envelope.result : null
    const items = result != null && result.ok === true && result.value != null
      && Array.isArray(result.value.items) ? result.value.items : null
    if (items == null || items.length === 0) return null
    const usable = items.filter(it => it != null && typeof it.path === 'string' && it.path !== '')
    if (usable.length === 0) return null
    const sessionId = probeSessionId()
    const bySession = sessionId !== null
      ? usable.find(it => Array.isArray(it.sessionIds) && it.sessionIds.includes(sessionId))
      : null
    const latest = usable.slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
    const workspace = bySession !== undefined && bySession !== null ? bySession : latest
    return { path: workspace.path, title: typeof workspace.title === 'string' ? workspace.title : '' }
  }

  const inject = () => {
  if (document.getElementById(BTN_ID)) return 'present'
  const bar = document.getElementById(BAR_ID)
  if (bar == null) return 'absent'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.id = BTN_ID
  btn.title = '在工作区目录打开终端'
  btn.setAttribute('aria-label', '在工作区目录打开终端')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '15')
  svg.setAttribute('height', '15')
  svg.setAttribute('fill', 'none')
  svg.innerHTML = '<rect x="2" y="2.5" width="12" height="11" rx="1.75" stroke="currentColor" stroke-width="1.2"/><path d="M4.9 6.3 6.6 8l-1.7 1.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.3 9.9h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
  btn.append(svg)
  btn.onclick = () => {
    resolveWorkspace()
      .then(ws => { console.log(PREFIX + JSON.stringify(ws == null ? { error: 'no-workspace' } : ws)) })
      .catch(() => { console.log(PREFIX + JSON.stringify({ error: 'fetch-failed' })) })
  }
  bar.append(btn)
  return 'injected'
  }
  // 标题栏由 theme-watcher 同批注入（时序不保证），短轮询等待，最长 60s
  if (inject() === 'absent') {
    let n = 0
    const timer = setInterval(() => {
      const r = inject()
      if (r !== 'absent' || ++n > 120) clearInterval(timer)
    }, 500)
  }
})()`

/**
 * 把工作区终端挂到 shell 窗口：
 * - did-finish-load 注入按钮脚本（幂等）；
 * - console-message 过滤通道前缀 → 校验路径 → 打开系统终端。
 */
export function attachWorkspaceTerminal(win: BrowserWindow): void {
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(TERMINAL_PREFIX)) return
    let payload: unknown
    try { payload = JSON.parse(message.slice(TERMINAL_PREFIX.length)) } catch { return }
    const path = (payload as { path?: unknown } | null)?.path
    if (typeof path === 'string' && path !== '') {
      void openWorkspaceTerminal(win, path)
    } else {
      void dialog.showMessageBox(win, {
        type: 'info',
        title: 'DSH Desktop',
        message: '未找到可打开的工作区',
        detail: '当前没有选中的任务会话，也没有可用于回退的工作区记录。',
        buttons: ['好'],
      })
    }
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(TERMINAL_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}

/**
 * 校验路径并打开系统终端（darwin: Terminal.app；win32: cmd；
 * linux: 按候选回退）。spawn 不经 shell、参数数组传递，无注入面。
 */
function openWorkspaceTerminal(parent: BrowserWindow, rawPath: string): void {
  const dir = resolvePath(rawPath)
  // 仅接受存在的绝对路径目录；拒绝控制字符
  if (!isAbsolute(dir) || /[\u0000-\u001f]/.test(dir)) return
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
  if (!isDir) {
    void dialog.showMessageBox(parent, {
      type: 'warning',
      title: 'DSH Desktop',
      message: '工作区目录不存在',
      detail: `目录可能已被移动或删除：\n${dir}`,
      buttons: ['好'],
    })
    return
  }
  if (process.platform === 'darwin') {
    launch('open', ['-a', 'Terminal', dir])
  } else if (process.platform === 'win32') {
    launch('cmd.exe', ['/c', 'start', '', 'cmd', '/k', `cd /d "${dir}"`])
  } else {
    tryLinux(0, dir)
  }
}

/** spawn 后台进程并卸离（失败走 onFail 回退）。 */
function launch(cmd: string, args: string[], onFail?: () => void): void {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => { onFail?.() })
  child.unref()
}

/** 逐个尝试 linux 终端候选，全部缺失时提示。 */
function tryLinux(index: number, dir: string): void {
  const candidate = LINUX_TERMINALS[index]
  if (candidate === undefined) {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'DSH Desktop',
      message: '未找到可用的终端程序',
      detail: '已尝试 x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal。',
      buttons: ['好'],
    })
    return
  }
  launch(candidate.cmd, candidate.args(dir), () => { tryLinux(index + 1, dir) })
}
