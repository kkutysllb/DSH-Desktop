/**
 * DSH Desktop 主进程入口。
 *
 * 启动流程：单实例锁 → app ready → 菜单/托盘/IPC → splash 窗口 →
 * 启动 dsh 侧车 → 就绪即切换 shell 窗口（上游 Web UI）；
 * 失败则停留在 setup 引导页。退出时优雅关停 dsh。
 *
 * @module desktop/main
 */

import { app } from 'electron'
import { dshManager } from './dsh-manager'
import { registerIpc } from './ipc'
import { installMenu, installTray, wireMenuRefresh } from './menu'
import { closePanels, showBootstrap, showShellWindow } from './windows'
import { upstreamBuilt, upstreamCloned } from './dsh-contract'
import { initUpdater } from './updater'
import { applyNativeTheme, currentThemePref } from './theme-watcher'

/** splash 窗口引用（切到 shell 后关闭）。 */
let bootstrap: Electron.BrowserWindow | null = null

app.whenReady().then(() => {
  // 预置上次已知主题：原生标题栏/菜单栏在首个窗口出现前就对色
  applyNativeTheme(currentThemePref())
  registerIpc()
  installMenu()
  installTray()
  wireMenuRefresh() // dsh/更新状态变化 → 重建菜单与托盘
  initUpdater() // 自动更新：启动后静默检测，下载完成侧边栏出现安装按钮

  // 启动即显示 splash：任何后续状态都在可见反馈中发生
  bootstrap = showBootstrap('splash')

  const onStateChanged = (status: { state: string; url: string | null }): void => {
    if (status.state === 'ready' && status.url !== null) {
      showShellWindow(status.url)
      bootstrap?.close()
      bootstrap = null
      dshManager.removeListener('state-changed', onStateChanged)
    } else if (status.state === 'failed') {
      if (bootstrap !== null && !bootstrap.isDestroyed()) {
        void bootstrap.loadURL(
          process.env.ELECTRON_RENDERER_URL !== undefined
            ? `${process.env.ELECTRON_RENDERER_URL}/#/setup`
            : `file://${__dirname}/../renderer/index.html#/setup`,
        )
      }
    }
  }
  dshManager.on('state-changed', onStateChanged)

  // 上游未就绪时先打开 setup（仍会尝试 PATH dsh / DSH_BIN）
  if (!upstreamCloned() || !upstreamBuilt()) {
    bootstrap?.close()
    bootstrap = showBootstrap('setup')
  }
  dshManager.start()

  app.on('activate', () => {
    // macOS dock 图标点击：有 shell 显 shell，否则维持现状
    const url = dshManager.status.url
    if (url !== null) showShellWindow(url)
  })
})

/* ---------- 单实例 ---------- */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const url = dshManager.status.url
    if (url !== null) showShellWindow(url)
    else if (bootstrap !== null && !bootstrap.isDestroyed()) bootstrap.show()
  })
}

/* ---------- 退出序列：优雅关停 dsh，绝不留孤儿进程 ---------- */
app.on('before-quit', (event) => {
  if (dshManager.status.state === 'stopped' || dshManager.status.state === 'failed') return
  event.preventDefault()
  void dshManager.stop().then(() => {
    closePanels()
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  // 托盘常驻：由菜单/托盘“退出”收尾；非 macOS 直接退出
  if (process.platform !== 'darwin') app.quit()
})

/* ---------- 终端信号兑底：dev 下 Ctrl+C 也不留孤儿 dsh ---------- */
const signalShutdown = (signal: NodeJS.Signals): void => {
  process.removeAllListeners(signal)
  void dshManager.stop().finally(() => app.exit(0))
}
process.on('SIGINT', () => signalShutdown('SIGINT'))
process.on('SIGTERM', () => signalShutdown('SIGTERM'))

/* ---------- 开发期主进程崩溃可读 ---------- */
process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception:', error)
})
