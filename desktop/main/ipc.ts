/**
 * IPC 注册：按 desktop/shared/ipc-contract.ts 的契约实现主进程侧。
 *
 * 事件广播使用 WebContents 广播（面板窗口按需存在）；
 * invoke 处理器全部有返回值，渲染端可 await。
 *
 * @module desktop/main/ipc
 */

import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { showShellWindow } from './windows'
import { dshManager } from './dsh-manager'
import { progressEvents, setupUpstream, syncUpstream, upstreamStatus } from './upstream'
import { communityPlugins, installedPlugins, runPluginCommand } from './plugins'
import { checkForUpdates, installUpdate, updateEvents, updateStatus } from './updater'
import { terminalPanel, terminalTheme } from './terminal-panel'
import type { UpstreamProgress } from '@shared/ipc-contract'

/** 安装全部 IPC 处理器与事件桥。 */
export function registerIpc(): void {
  /* ---- dsh 侧车 ---- */
  ipcMain.handle('dsh:status', () => dshManager.status)
  ipcMain.handle('dsh:logs', () => dshManager.logTail)
  ipcMain.handle('dsh:start', () => {
    dshManager.start()
    return dshManager.status
  })
  ipcMain.handle('dsh:restart', () => dshManager.restart())

  /* ---- 上游仓库 ---- */
  ipcMain.handle('upstream:status', () => upstreamStatus())
  ipcMain.handle('upstream:sync', async () => {
    const result = await syncUpstream()
    if (result.ok) {
      // 同步成功 → 重启 dsh 加载新构建；就绪后自动拉起 shell 窗口
      dshManager.restart()
      dshManager.once('state-changed', (status) => {
        if (status.state === 'ready' && status.url !== null) showShellWindow(status.url)
      })
    }
    return result
  })
  ipcMain.handle('upstream:setup', () => setupUpstream())

  /* ---- 插件 ---- */
  ipcMain.handle('plugins:installed', () => installedPlugins())
  ipcMain.handle('plugins:community', () => communityPlugins())
  ipcMain.handle('plugins:add', (_event, pkg: string) => runPluginCommand(['add', pkg]))
  ipcMain.handle('plugins:remove', (_event, pkg: string) => runPluginCommand(['remove', pkg]))
  ipcMain.handle('plugins:update', (_event, pkg: string) => runPluginCommand(['update', pkg]))

  /* ---- 应用自动更新 ---- */
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())

  /* ---- 桌面动作 ---- */
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return Promise.resolve()
  })
  ipcMain.handle('shell:show', (event) => {
    const url = dshManager.status.url
    if (url === null) return false
    showShellWindow(url)
    BrowserWindow.fromWebContents(event.sender)?.close()
    return true
  })
  ipcMain.handle('shell:revealPath', (_event, target: string) => {
    void shell.showItemInFolder(target)
    return Promise.resolve()
  })

  /* ---- 内嵌终端（面板视图 ↔ pty，多标签：全部动作常 id） ---- */
  ipcMain.handle('terminal:tabs', () => terminalPanel.ptyHost().list())
  ipcMain.handle('terminal:new', () => {
    const ws = terminalPanel.currentWorkspace()
    return terminalPanel.ptyHost().create(ws.path)
  })
  ipcMain.handle('terminal:write', (_event, id: number, data: string) => {
    terminalPanel.ptyHost().write(id, data)
  })
  ipcMain.handle('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminalPanel.ptyHost().resize(id, cols, rows)
  })
  ipcMain.handle('terminal:restart', (_event, id: number) => {
    const ws = terminalPanel.currentWorkspace()
    return terminalPanel.ptyHost().restart(id, ws.path)
  })
  ipcMain.handle('terminal:close', (_event, id: number) => {
    return terminalPanel.ptyHost().close(id)
  })
  ipcMain.handle('terminal:hide', () => {
    terminalPanel.hide()
  })
  ipcMain.handle('terminal:theme', () => terminalTheme())
  ipcMain.handle('terminal:panel-resize', (_event, dy: number) => {
    terminalPanel.adjustHeight(dy)
    return terminalPanel.height()
  })

  /* ---- 剪贴板（终端右键菜单复制/粘贴） ---- */
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
    return Promise.resolve()
  })

  /* ---- 事件广播（面板窗口存在才有听众） ---- */
  dshManager.on('state-changed', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('dsh:state-changed', status)
    }
  })
  dshManager.on('log', (line) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('dsh:log', line)
    }
  })
  progressEvents.on('progress', (progress: UpstreamProgress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('upstream:progress', progress)
    }
  })
  updateEvents.on('state-changed', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:state-changed', status)
    }
  })
}
