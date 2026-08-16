/**
 * 窗口层：承载上游 Web UI 的主窗口（shell）+ 桌面端本地页面（bootstrap/面板）。
 *
 * shell 窗口刻意**不注入 preload**——它是上游 Web UI 的纯浏览器载体，
 * 同源 fetch 与 WebSocket 直接命中 dsh 的 API 网关；桌面能力全部经由
 * 独立的面板窗口（带 preload）提供，两者互不污染。
 *
 * @module desktop/main/windows
 */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, shell } from 'electron'
import { resolveAsset } from './dsh-contract'
import { dshManager } from './dsh-manager'
import { installUpdate } from './updater'
import { attachUpdateInjector } from './update-injector'
import { attachThemeWatcher, themeBackgroundColor } from './theme-watcher'
import { attachWorkspaceTerminal } from './workspace-terminal'
import { getSettings, saveSettings } from './store'

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径。 */
const PRELOAD = join(__dirname, '../preload/index.js')

let shellWindow: BrowserWindow | null = null
const panels = new Map<string, BrowserWindow>()

/** 供菜单等处引用。 */
export function getShellWindow(): BrowserWindow | null {
  return shellWindow
}

/**
 * 创建（或复用并导航到 dsh URL）shell 窗口。
 * @param dshUrl - dsh web 就绪地址（http://127.0.0.1:<port>）。
 */
export function showShellWindow(dshUrl: string): void {
  if (shellWindow === null || shellWindow.isDestroyed()) {
    const bounds = getSettings().windowBounds
    shellWindow = new BrowserWindow({
      width: bounds?.width ?? 1440,
      height: bounds?.height ?? 900,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'DSH Desktop',
      // 按上次已知主题设底色，页面加载期间不白闪/黑闪
      backgroundColor: themeBackgroundColor(),
      // macOS：隐藏系统标题栏但保留红绿灯（'hidden'）；标题栏由
      // theme-watcher 注入自绘拖拽区（VS Code 同款）：颜色直接解析
      // 上游 token 随主题实时变化，双击缩放/拖拽原生可用，标题显示
      // document.title（上游 DocumentTitle 投射会话任务标题）。
      // 注：不用 WCO 覆盖条——它在 macOS 不渲染标题且双击缩放失效。
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hidden' as const }
        : {}),
      // 官方 DeepSeek 图标（macOS 用 Dock 图标，此项服务 Linux/Windows）
      icon: resolveAsset('icon.png'),
      // 纯浏览器载体：无 node、无 preload、webSecurity 开启
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    shellWindow.once('ready-to-show', () => shellWindow?.show())
    shellWindow.on('resized', persistBounds)
    shellWindow.on('moved', persistBounds)
    // 更新下载完成后：侧边栏 logo 旁出现安装按钮（注入器零侵入上游）
    attachUpdateInjector(shellWindow)
    // 主题跟随：上游 UI 主题切换 → 原生标题栏/菜单栏自适应（零侵入）
    attachThemeWatcher(shellWindow)
    // 标题栏右上角终端按钮：在当前任务的工作区目录打开系统终端
    // （按钮宿主是自绘标题栏，仅 darwin）
    if (process.platform === 'darwin') attachWorkspaceTerminal(shellWindow)
    // 只允许停留在 dsh 回环地址；外链交给系统浏览器
    shellWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('dsh-desktop:')) return { action: 'deny' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    shellWindow.webContents.on('will-navigate', (event, url) => {
      // 安装按钮的回调协议：拦下并触发安装，绝不真正导航
      if (url.startsWith('dsh-desktop:')) {
        event.preventDefault()
        if (url === 'dsh-desktop://install-update') void installUpdate()
        return
      }
      // 实时取当前 dsh 地址（dsh 重启端口会变，不能用创建时的闭包值）
      const current = dshManager.status.url ?? dshUrl
      if (!url.startsWith(current)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    // dsh Web UI 无需任何浏览器特权
    shellWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false)
    })
  }
  void shellWindow.loadURL(dshUrl)
  if (!shellWindow.isVisible()) shellWindow.show()
  shellWindow.focus()
}

function persistBounds(): void {
  const win = shellWindow
  if (win === null || win.isDestroyed()) return
  saveSettings({ windowBounds: win.getNormalBounds() })
}

/**
 * 打开（或聚焦）一个桌面端本地面板窗口。
 * @param panel - 面板标识，同时是 hash 路由（#/diagnostics 等）。
 * @param title - 窗口标题。
 */
export function openPanel(panel: 'setup' | 'diagnostics' | 'sync' | 'plugins', title: string): void {
  const existing = panels.get(panel)
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width: 880,
    height: 640,
    title,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: themeBackgroundColor(),
    icon: resolveAsset('icon.png'),
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })
  panels.set(panel, win)
  win.on('closed', () => panels.delete(panel))
  win.once('ready-to-show', () => win.show())
  const url = RENDERER_URL !== undefined
    ? `${RENDERER_URL}/#/${panel}`
    : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/${panel}`
  void win.loadURL(url)
}

/**
 * 打开 bootstrap 窗口（splash/失败引导）。桌面端启动时先显示，
 * dsh 就绪后由 index.ts 切到 shell 窗口。
 */
export function showBootstrap(route: 'splash' | 'setup'): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 560,
    title: 'DSH Desktop',
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: themeBackgroundColor(),
    icon: resolveAsset('icon.png'),
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  const url = RENDERER_URL !== undefined
    ? `${RENDERER_URL}/#/${route}`
    : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/${route}`
  void win.loadURL(url)
  return win
}

/** 关闭全部面板窗口（应用退出前）。 */
export function closePanels(): void {
  for (const win of panels.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  panels.clear()
}
