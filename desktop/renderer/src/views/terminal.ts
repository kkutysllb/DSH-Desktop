/**
 * 内嵌终端视图（#/terminal，承载于 shell 窗口底部的 WebContentsView）：
 * xterm.js 渲染 + IPC 桥接主进程 pty（node-pty）。
 *
 * 面板顶部是细 header：shell 名 + 工作区目录、重开（换工作区后重建
 * shell）、关闭；header 上缘 4px 拖条调面板高度（主进程 clamp 并
 * 持久化）。主题色由主进程推送（上游 token），随主题切换实时刷新。
 *
 * @module desktop/renderer/src/views/terminal
 */

import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { bridge } from '../bridge'
import type { TerminalTheme } from '@shared/ipc-contract'

/** 视图内样式（独立于 app.css：此页是终端面板专用布局）。 */
const PAGE_CSS = `
html, body { height: 100%; margin: 0; overflow: hidden; }
#app { height: 100%; display: flex; flex-direction: column; font: 500 12px -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
.tm-grip { height: 4px; flex: none; cursor: row-resize; }
.tm-header { flex: none; height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 12px; user-select: none; }
.tm-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; }
.tm-title .tm-shell { font-weight: 600; opacity: 1; }
.tm-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; }
.tm-btn:hover { background: rgba(128, 128, 128, .18); }
.tm-btn svg { display: block; }
.tm-term { flex: 1; min-height: 0; padding: 2px 8px 6px; }
.tm-term .xterm { height: 100%; }
.tm-exit { flex: none; display: none; align-items: center; gap: 10px; padding: 6px 12px; font-size: 12px; opacity: .8; }
`

function applyPalette(theme: TerminalTheme, header: HTMLElement, grip: HTMLElement, exit: HTMLElement): ITheme {
  document.body.style.background = theme.bg
  header.style.background = theme.headerBg
  header.style.color = theme.fg
  header.style.borderBottom = `1px solid ${theme.border}`
  grip.style.background = theme.border
  exit.style.background = theme.bg
  exit.style.color = theme.fg
  return {
    background: theme.bg,
    foreground: theme.fg,
    cursor: theme.accent,
    cursorAccent: theme.bg,
    selectionBackground: theme.accent + '59',
  }
}

export async function mountTerminal(root: HTMLElement): Promise<void> {
  const style = document.createElement('style')
  style.textContent = PAGE_CSS
  document.head.append(style)

  const grip = document.createElement('div')
  grip.className = 'tm-grip'
  const header = document.createElement('div')
  header.className = 'tm-header'
  const title = document.createElement('span')
  title.className = 'tm-title'
  const restartBtn = iconButton(
    '重启 shell（在当前工作区目录）',
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13.7 1.8v2.7h-2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  )
  const closeBtn = iconButton(
    '关闭终端面板',
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  )
  header.append(title, restartBtn, closeBtn)

  const termHost = document.createElement('div')
  termHost.className = 'tm-term'

  const exitBar = document.createElement('div')
  exitBar.className = 'tm-exit'
  const exitText = document.createElement('span')
  exitText.textContent = 'shell 进程已退出'
  const relaunch = document.createElement('button')
  relaunch.textContent = '重新启动'
  relaunch.style.cssText = 'all:unset;cursor:pointer;padding:3px 10px;border-radius:6px;font-weight:600'
  relaunch.onmouseenter = () => { relaunch.style.background = 'rgba(128,128,128,.25)' }
  relaunch.onmouseleave = () => { relaunch.style.background = 'transparent' }
  exitBar.append(exitText, relaunch)

  root.append(grip, header, termHost, exitBar)

  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "DejaVu Sans Mono", "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    convertEol: false,
    scrollback: 4000,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termHost)
  term.attachCustomKeyEventHandler(event => {
    // 面板内 Cmd+W 等关窗快捷键放行给应用菜单（避免吃掉）
    if (event.metaKey && event.key === 'w') return false
    return true
  })

  /* ---- 主题（初始拉取 + 订阅推送） ---- */
  const palette = applyPalette(await bridge.terminalTheme(), header, grip, exitBar)
  term.options.theme = palette
  bridge.onTerminalTheme(theme => {
    term.options.theme = applyPalette(theme, header, grip, exitBar)
  })

  /* ---- 会话信息（header 标题） ---- */
  const refreshTitle = (): void => {
    void bridge.terminalInfo().then(info => {
      const cwdShort = info.cwd.split('/').filter(Boolean).pop() ?? info.cwd
      title.innerHTML = ''
      const shell = document.createElement('span')
      shell.className = 'tm-shell'
      shell.textContent = info.title
      const rest = document.createElement('span')
      rest.textContent = `　—　${cwdShort !== '' ? cwdShort : info.cwd}`
      title.append(shell, rest)
      exitBar.style.display = info.alive ? 'none' : 'flex'
    })
  }
  refreshTitle()

  /* ---- 数据/退出 ---- */
  bridge.onTerminalData(chunk => { term.write(chunk) })
  bridge.onTerminalExit(() => {
    term.write('\r\n\x1b[2m—— 进程已退出 ——\x1b[0m\r\n')
    refreshTitle()
  })

  /* ---- 写入与尺寸 ---- */
  term.onData(data => { void bridge.terminalWrite(data) })
  term.onResize(({ cols, rows }) => { void bridge.terminalResize(cols, rows) })
  const refit = (): void => {
    if (termHost.clientWidth === 0 || termHost.clientHeight === 0) return
    fit.fit()
  }
  const ro = new ResizeObserver(() => refit())
  ro.observe(termHost)
  refit()
  term.focus()

  /* ---- header 动作 ---- */
  restartBtn.onclick = async () => {
    await bridge.terminalRestart()
    term.reset()
    refreshTitle()
    term.focus()
  }
  closeBtn.onclick = () => { void bridge.terminalHide() }
  relaunch.onclick = async () => {
    await bridge.terminalRestart()
    term.reset()
    refreshTitle()
    term.focus()
  }

  /* ---- 上缘拖条：调面板高度（增量上报，主进程 clamp + 持久化） ---- */
  let dragging = false
  let lastY = 0
  let pending = 0
  let raf = 0
  grip.onpointerdown = e => {
    dragging = true
    lastY = e.clientY
    pending = 0
    grip.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  grip.onpointermove = e => {
    if (!dragging) return
    pending += e.clientY - lastY
    lastY = e.clientY
    if (raf === 0) {
      raf = requestAnimationFrame(() => {
        raf = 0
        if (pending !== 0) {
          // 向下拖（正）= 面板变矮：主进程 adjustHeight(dy) 是"加"
          const sent = pending
          pending = 0
          void bridge.terminalPanelResize(-sent)
        }
      })
    }
  }
  const endDrag = (): void => {
    dragging = false
    // pointerup/pointercancel 后浏览器自动释放捕获，无需手动
  }
  grip.onpointerup = endDrag
  grip.onpointercancel = endDrag
}

function iconButton(label: string, svg: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'tm-btn'
  btn.type = 'button'
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.innerHTML = svg
  return btn
}
