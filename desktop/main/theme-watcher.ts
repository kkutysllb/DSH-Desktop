/**
 * 主题跟随：上游 Web UI 的主题切换 → Electron 原生外观自适应。
 *
 * 上游契约（packages/client/ui-theme/src/client/index.ts）：
 * - 深色时 `body` 带 `data-ds-dark-theme` 属性（官方注释：以该字段为准，
 *   "body[data-ds-dark-theme] from this field — never from the id"）；
 * - 同时 `documentElement.style.colorScheme = 'dark' | 'light'`；
 * - 偏好（light/dark/system）持久化在 dsh 服务端 settings（~/.dsh），
 *   随机端口不丢偏好。
 *
 * 桌面端链路（shell 窗口是纯浏览器载体，无 preload）：
 * 1. 注入观察脚本（MutationObserver）监听上述两处 DOM 变化；
 * 2. 通过 console 通道 `__dsh_theme__:<dark|light>` 回传主进程
 *    （webContents console-message 事件，CSP 不影响，零导航开销）；
 * 3. 主进程 `nativeTheme.themeSource` 同步 → 原生标题栏/红绿灯区域、
 *    菜单栏、Dock 与桌面端面板（prefers-color-scheme）全部自适应；
 * 4. 最后已知渲染主题持久化到 store，下次启动预置，避免首帧闪烁。
 *
 * @module desktop/main/theme-watcher
 */

import { nativeTheme, type BrowserWindow } from 'electron'
import { getSettings, saveSettings } from './store'

/** console 通道前缀（与注入脚本约定）。 */
const THEME_PREFIX = '__dsh_theme__:'

/**
 * macOS 标题栏高度（Window Controls Overlay 覆盖条）。
 * 与上游侧边栏控件节奏对齐（36px 控制盒）；页面注入等高 padding 下移，
 * 保证上游 UI 不被覆盖条遮挡。
 */
export const SHELL_TITLEBAR_HEIGHT = 36

/**
 * 注入脚本（页面上下文）：观察上游主题在 DOM 上的落点并上报。
 * 首次立即上报当前状态；之后任何变化（偏好切换/系统翻转）都会触发。
 */
const WATCH_JS = `(() => {
  if (window.__dshThemeWatched) return
  window.__dshThemeWatched = true
  const report = () => {
    const dark = document.body === null
      ? document.documentElement.style.colorScheme === 'dark'
      : document.body.hasAttribute('data-ds-dark-theme')
        || document.documentElement.style.colorScheme === 'dark'
    console.log('__dsh_theme__:' + (dark ? 'dark' : 'light'))
  }
  new MutationObserver(report).observe(document.documentElement, {
    attributes: true, attributeFilter: ['style'],
  })
  const watchBody = () => {
    if (document.body !== null) {
      new MutationObserver(report).observe(document.body, {
        attributes: true, attributeFilter: ['data-ds-dark-theme'],
      })
      report()
    } else {
      requestAnimationFrame(watchBody)
    }
  }
  watchBody()
})()`

/** 当前应使用的原生外观（启动时 = 上次已知渲染主题）。 */
export function currentThemePref(): 'system' | 'light' | 'dark' {
  return getSettings().lastTheme
}

/** 应用原生主题：themeSource + 持久化（变化才写盘）。 */
export function applyNativeTheme(pref: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = pref
  if (getSettings().lastTheme !== pref) saveSettings({ lastTheme: pref })
}

/**
 * 把主题观察器挂到 shell 窗口：
 * - did-finish-load 注入观察脚本（每次导航后重新注入，脚本自幂等）；
 * - console-message 过滤通道前缀 → 同步 nativeTheme。
 */
export function attachThemeWatcher(win: BrowserWindow): void {
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    // 兼容新旧签名：新版 Electron 的 message 在 event 对象上，
    // 旧版为 (event, level, message, line, sourceId)
    const maybeMessage = (event as { message?: unknown } | null)?.message
    const message = typeof maybeMessage === 'string'
      ? maybeMessage
      : typeof rest[2] === 'string' ? (rest[2] as string) : ''
    if (!message.startsWith(THEME_PREFIX)) return
    const value = message.slice(THEME_PREFIX.length)
    if (value === 'dark' || value === 'light') {
      applyNativeTheme(value)
      applyShellChromeTheme(win, value)
    }
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    // 标题栏覆盖条下移页面：上游 html/body/#root 均为 height:100%，
    // body padding-top 不会溢出（内容盒 = 视口 - 覆盖条高）
    webContents.executeJavaScript(SHELL_PAD_JS, true).catch(() => {})
    webContents.executeJavaScript(WATCH_JS, true).catch(() => {
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
 * 按主题给出标题栏/窗口底色（取上游精确 token：sidebar-fill）。
 * 标题栏左半下方是侧边栏、右半是对话区（bg-base，与 sidebar 仅差
 * Δ6，人眼不可辨）：
 * - 深：--dsw-static-neutral-bluish-900 = rgb(27,27,28)
 * - 浅：--dsw-static-neutral-bluish-50 = rgb(249,250,251)
 */
export function themeBackgroundColor(pref: 'system' | 'light' | 'dark' = getSettings().lastTheme): string {
  if (pref === 'light') return '#F9FAFB'
  if (pref === 'dark') return '#1B1B1C'
  return nativeTheme.shouldUseDarkColors ? '#1B1B1C' : '#F9FAFB'
}

/** 页面下移注入（macOS 标题栏覆盖条占高，页面上让出）：幂等。 */
const SHELL_PAD_JS = `(() => {
  const ID = '__dsh_desktop_titlebar_pad'
  if (document.getElementById(ID)) return
  const st = document.createElement('style')
  st.id = ID
  st.textContent = 'body{padding-top:${SHELL_TITLEBAR_HEIGHT}px;box-sizing:border-box}'
  document.head.append(st)
})()`

/**
 * 同步 shell 窗口的原生 chrome 颜色：
 * - 窗口底色（加载间隙不闪色）；
 * - macOS 标题栏覆盖条颜色（真正的标题栏着色点——系统原生标题栏由
 *   系统材质绘制，backgroundColor 不影响它，必须用 WCO 覆盖条控制）。
 */
export function applyShellChromeTheme(win: BrowserWindow, pref: 'system' | 'light' | 'dark'): void {
  if (win.isDestroyed()) return
  const color = themeBackgroundColor(pref)
  win.setBackgroundColor(color)
  if (process.platform === 'darwin' && typeof win.setTitleBarOverlay === 'function') {
    try {
      win.setTitleBarOverlay({ color })
    } catch {
      // 覆盖条不可用（窗口未启用 WCO 等）时静默降级为仅窗口底色
    }
  }
}
