/**
 * 文件预览抽屉：主界面右侧的真实面板，跟随 agent 的读/编辑文件活动
 * （codex 预览面板同款体验）。VS Code 侧边栏同款布局。
 *
 * 构成（全部仿 terminal-panel 的成熟模式）：
 * - 面板本体是 WebContentsView（renderer 的 #/preview 视图 + preload），
 *   叠在 shell 窗口右侧全高——上游页面零修改；
 * - 数据源是 file-activity（主进程第二个 mux 客户端），活动经 IPC
 *   preview:activity 推给视图，视图按需 preview:read-file 读盘；
 * - 布局：x = 窗口右缘 - 面板宽（不越侧边栏），y = 0 全高；终端面板
 *   可见时宽度给本面板让位（terminal-panel 单向感知本面板）；
 * - 让位：面板打开时给上游 AppFrame 的 centerCol/detailsCol 注入
 *   padding-right（与终端的 padding-bottom 属性正交，可叠加）；
 * - 宽度：左缘 4px 拖条（视图内）调宽，clamp {@link PANEL_MIN_W}-
 *   {@link PANEL_MAX_W}，持久化；默认折叠，手动展示。
 *
 * 通信：页面侧上报走 console 通道 `__dsh_preview__:<json>`（toggle /
 * workspace / sidebar 三类）；面板视图 ↔ 主进程走 IPC（ipc-contract
 * preview:*）。
 *
 * @module desktop/main/preview-panel
 */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WebContentsView, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { getSettings, saveSettings } from './store'
import { fileActivity } from './file-activity'
import type { PreviewEntry } from '@shared/ipc-contract'

/** console 通道前缀（与注入脚本约定）。 */
const PREVIEW_PREFIX = '__dsh_preview__:'

/** 面板默认/界限宽度（DIP）。 */
const PANEL_DEFAULT_W = 400
const PANEL_MIN_W = 260
const PANEL_MAX_W = 720

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径（面板窗口同款：preload + contextIsolation）。 */
const PRELOAD = join(__dirname, '../preload/index.js')

/**
 * 页面注入脚本（上游 shell 页面上下文）：
 * 1. 标题栏预览按钮（终端按钮右侧，点击 → 解析当前工作区 → 上报 toggle）；
 * 2. 侧边栏宽度探针（ResizeObserver + rAF 节流 → 上报宽度）；
 * 3. 工作区探针（选中会话变化 → debounce → 解析工作区 → 上报缓存，
 *    主进程转喂 file-activity 作相对路径解析基准）；
 * 4. 内容区右侧让位 padding 的设置/清除入口（__dshPreviewPad(W)）。
 */
const PAGE_JS = `(() => {
  if (window.__dshPreviewWired) return
  window.__dshPreviewWired = true
  const PREFIX = '__dsh_preview__:'
  const report = (obj) => { console.log(PREFIX + JSON.stringify(obj)) }
  const bar = () => document.getElementById('__dsh_desktop_titlebar')

  /* ---- 侧边栏宽度探针：面板宽度跟随（不被侧边栏压住） ---- */
  const sidebarEl = () => document.querySelector('[class*="sidebarCol"]')
  const watchSidebar = () => {
    const el = sidebarEl()
    if (el == null) { requestAnimationFrame(watchSidebar); return }
    let raf = 0
    const reportW = () => {
      raf = 0
      report({ sidebar: Math.round(el.getBoundingClientRect().width) })
    }
    new ResizeObserver(() => { if (raf === 0) raf = requestAnimationFrame(reportW) }).observe(el)
    reportW()
  }
  watchSidebar()

  /* ---- 当前会话 → 工作区解析（同源 RPC，与终端面板同款契约） ---- */
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
  let rpcSeq = 0
  const resolveWorkspace = async () => {
    const res = await fetch('/api/workspace.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'dsh-desktop-preview-' + (++rpcSeq),
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
    const workspace = bySession != null ? bySession : latest
    return { path: workspace.path, title: typeof workspace.title === 'string' ? workspace.title : '' }
  }

  let debounce = 0
  const reportWorkspace = () => {
    resolveWorkspace()
      .then(ws => { report(ws == null ? { workspace: null } : { workspace: ws.path, workspaceTitle: ws.title }) })
      .catch(() => {})
  }
  const watchSelection = () => {
    new MutationObserver(() => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(reportWorkspace, 600)
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    reportWorkspace()
  }
  if (document.body) watchSelection()
  else document.addEventListener('DOMContentLoaded', () => watchSelection(), { once: true })

  /* ---- 正文文件链接接管：拦 host.openPath/openTextFile RPC → 抽屉预览 ----
   * （上游链路：文件链接 → RPC → host 侧系统默认应用打开；.ts 会被
   * macOS 识别为视频流交给腾讯视频、.log 交给日志分析器——桌面端拦
   * 下后在预览抽屉里打开，合成成功响应，上游 UI 无感知） */
  const origFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input
        : input instanceof Request ? input.url : String(input)
      if (!url.includes('/api/') || url.includes('/api/events.')) return origFetch(input, init)
      const method = (init != null && typeof init.method === 'string' ? init.method
        : input instanceof Request ? input.method : 'GET').toUpperCase()
      if (method !== 'POST') return origFetch(input, init)
      const bodyText = input instanceof Request
        ? input.clone().text()
        : Promise.resolve(init != null && typeof init.body === 'string' ? init.body : '')
      return bodyText.then(text => {
        let rpc = null
        try { rpc = JSON.parse(text) } catch { /* 非 JSON 放行 */ }
        const m = rpc !== null && typeof rpc.method === 'string' ? rpc.method : null
        if (m === 'host.openPath' || m === 'host.openTextFile') {
          const path = rpc != null && rpc.payload != null && typeof rpc.payload.path === 'string' ? rpc.payload.path : null
          report({ action: 'open', path })
          // 回传校验需要 rpcId + type（serverResponseSchema）
          const id = rpc != null && typeof rpc.rpcId === 'string' ? rpc.rpcId : ''
          return new Response(JSON.stringify({ type: 'server-response', rpcId: id, result: { ok: true, value: { opened: true } } }), {
            status: 200, headers: { 'content-type': 'application/json' },
          })
        }
        return origFetch(input, init)
      }).catch(() => origFetch(input, init))
    } catch { return origFetch(input, init) }
  }

  /* ---- 标题栏按钮（宿主由 theme-watcher 注入；在终端按钮右侧） ---- */
  const BTN_ID = '__dsh_desktop_preview_btn'
  const style = document.createElement('style')
  style.id = '__dsh_desktop_preview_style'
  style.textContent = [
    '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;right:44px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.8)}',
    '#' + BTN_ID + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + BTN_ID + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + BTN_ID + '[data-open="1"]{background:color-mix(in srgb,currentColor 14%,transparent)}',
  ].join('')
  document.head.append(style)
  const injectBtn = () => {
    if (document.getElementById(BTN_ID)) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BTN_ID
    btn.title = '切换文件预览抽屉'
    btn.setAttribute('aria-label', '切换文件预览抽屉')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '15')
    svg.setAttribute('height', '15')
    svg.setAttribute('fill', 'none')
    svg.innerHTML = '<rect x="2" y="2.5" width="12" height="11" rx="1.75" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 2.5v11" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 5.9h3.1M4.2 8.6h3.1M4.2 11.3h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
    btn.append(svg)
    btn.onclick = () => {
      resolveWorkspace()
        .then(ws => report(ws == null ? { action: 'toggle' } : { action: 'toggle', path: ws.path }))
        .catch(() => report({ action: 'toggle' }))
    }
    host.append(btn)
    return 'injected'
  }
  let tries = 0
  const poll = setInterval(() => {
    if (injectBtn() !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  /* ---- 内容区右侧让位（主进程每次布局时调用；W=0 清除）---- */
  window.__dshPreviewPad = (W) => {
    const cols = document.querySelectorAll('[class*="centerCol"], [class*="detailsCol"]')
    for (const el of cols) {
      if (W > 0) el.style.paddingRight = W + 'px'
      else el.style.removeProperty('padding-right')
    }
  }
})()`

/** 让位 padding 注入（面板宽度变化时随布局执行）。 */
function padScript(w: number): string {
  return `window.__dshPreviewPad ? window.__dshPreviewPad(${w}) : undefined`
}

/**
 * 预览抽屉管理器：每 shell 窗口一份。供 ipc.ts 的 preview:* handlers
 * 与 terminal-panel（让位感知）调用。
 */
class PreviewPanel {
  private win: BrowserWindow | null = null
  private view: WebContentsView | null = null
  private visible = false
  private panelW = clampW(getSettings().previewWidth ?? PANEL_DEFAULT_W)
  private sidebarW = 0
  /** 布局联动回调（windows.ts 接线：通知终端面板重排，避免循环依赖）。 */
  onLayoutChange: (() => void) | null = null

  /** shell 窗口创建后接线（重复调用安全）。 */
  attach(win: BrowserWindow): void {
    this.win = win
    const { webContents } = win
    const onConsole = (event: unknown, ...rest: unknown[]): void => {
      const message = consoleMessageText(event, rest)
      if (!message.startsWith(PREVIEW_PREFIX)) return
      let payload: Record<string, unknown>
      try { payload = JSON.parse(message.slice(PREVIEW_PREFIX.length)) as Record<string, unknown> } catch { return }
      const sidebar = payload.sidebar
      if (typeof sidebar === 'number' && sidebar >= 0) {
        this.sidebarW = Math.round(sidebar)
        this.layout()
        return
      }
      if (typeof payload.workspace === 'string' || payload.workspace === null) {
        // 工作区缓存：file-activity 的相对路径解析基准
        const ws = payload.workspace
        fileActivity.setWorkspace(typeof ws === 'string' && ws !== '' ? ws : null)
        return
      }
      if (payload.action === 'toggle') {
        if (typeof payload.path === 'string' && payload.path !== '') fileActivity.setWorkspace(payload.path)
        this.toggle()
        return
      }
      if (payload.action === 'open') {
        // 正文文件链接接管：在预览抽屉中打开（无路径则忽略）
        const path = typeof payload.path === 'string' ? payload.path : null
        if (path !== null && path !== '') {
          const entry = fileActivity.open(path)
          this.show()
          this.forwardActivity(entry, true)
        }
      }
    }
    const onDidLoad = (): void => {
      if (win.isDestroyed()) return
      webContents.executeJavaScript(PAGE_JS, true).catch(() => {
        // 页面跳转间隙执行失败属正常，下次加载会重试
      })
      if (this.visible) {
        webContents.executeJavaScript(padScript(this.panelW), true).catch(() => {})
        this.syncButtonState()
      }
    }
    webContents.on('console-message', onConsole)
    webContents.on('did-finish-load', onDidLoad)
    win.on('resize', () => { if (this.visible) this.layout() })
    win.once('closed', () => {
      webContents.removeListener('console-message', onConsole)
      webContents.removeListener('did-finish-load', onDidLoad)
      this.destroyView()
      this.win = null
    })
  }

  /** 应用退出前彻底清理。 */
  dispose(): void {
    this.destroyView()
  }

  toggle(): void {
    if (this.visible) this.hide()
    else this.show()
  }

  show(): void {
    const win = this.win
    if (win === null || win.isDestroyed()) return
    this.visible = true
    if (this.view === null) {
      this.view = new WebContentsView({
        webPreferences: {
          preload: PRELOAD,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
        },
      })
      win.contentView.addChildView(this.view)
      const url = RENDERER_URL !== undefined
        ? `${RENDERER_URL}/#/preview`
        : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/preview`
      void this.view.webContents.loadURL(url)
    }
    this.view.setVisible(true)
    this.layout()
    this.syncButtonState()
    this.onLayoutChange?.()
  }

  hide(): void {
    this.visible = false
    this.view?.setVisible(false)
    this.pad(0)
    this.syncButtonState()
    this.onLayoutChange?.()
    // 焦点还给上游页面
    this.win?.webContents.focus()
  }

  /** 面板宽度拖拽（dx 向左为正 = 变宽）。 */
  adjustWidth(dx: number): void {
    const next = clampW(this.panelW + dx)
    if (next === this.panelW) return
    this.panelW = next
    saveSettings({ previewWidth: next })
    if (this.visible) this.layout()
  }

  width(): number {
    return this.panelW
  }

  /** 终端面板让位用：可见时占的宽度。 */
  visibleWidth(): number {
    return this.visible ? this.panelW : 0
  }

  /** 活动事件 → 面板视图（file-activity 订阅转发；ipc.ts 接线）。 */
  forwardActivity(entry: PreviewEntry, focus = false): void {
    const wc = this.view?.webContents
    if (wc !== undefined && !wc.isDestroyed()) wc.send('preview:activity', entry, focus)
  }

  /** 请求重排（外部布局联动；面板可见才重算）。 */
  relayout(): void {
    if (this.visible) this.layout()
  }

  /** 同步标题栏按钮的开合态（页面导航后/面板切换时）。 */
  syncButtonState(): void {
    const wc = this.win?.webContents
    if (wc === undefined || wc.isDestroyed()) return
    wc.executeJavaScript(
      `(() => { const b = document.getElementById('__dsh_desktop_preview_btn'); if (b) b.setAttribute('data-open', ${this.visible ? '"1"' : '"0"'}) })()`,
      true,
    ).catch(() => {})
  }

  /** 重算面板 bounds + 上游让位。 */
  private layout(): void {
    const win = this.win
    const view = this.view
    if (win === null || win.isDestroyed() || view === null || !this.visible) return
    const [contentW, contentH] = win.getContentSize()
    const x = Math.max(contentW - this.panelW, Math.min(this.sidebarW, contentW))
    view.setBounds({
      x,
      y: 0,
      width: Math.max(contentW - x, 0),
      height: Math.max(contentH, 0),
    })
    this.pad(this.panelW)
  }

  /** 上游内容区让位注入（面板宽度变化时同步）。 */
  private pad(w: number): void {
    this.win?.webContents.executeJavaScript(padScript(w), true).catch(() => {})
  }

  private destroyView(): void {
    const win = this.win
    if (this.view !== null && win !== null && !win.isDestroyed()) {
      win.contentView.removeChildView(this.view)
      this.view.webContents.close()
    }
    this.view = null
    this.visible = false
  }
}

function clampW(w: number): number {
  return Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Math.round(w)))
}

/** 全局单例（应用级：活动记录在 file-activity，跨窗口存续）。 */
export const previewPanel = new PreviewPanel()
