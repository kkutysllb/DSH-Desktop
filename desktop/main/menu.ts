/**
 * 原生应用菜单 + 托盘。
 *
 * 菜单动作只覆盖桌面壳自身（重载 UI、面板、退出）；不试图为上游
 * Web UI 提供业务菜单——那是上游插件树的领域。
 *
 * @module desktop/main/menu
 */

import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { dshManager } from './dsh-manager'
import { resolveAsset } from './dsh-contract'
import { getShellWindow, openPanel, showShellWindow } from './windows'
import { getSettings } from './store'

let tray: Tray | null = null

/** 构建并安装应用菜单；返回可复用的模板构建器。 */
export function installMenu(): void {
  const shellWindow = (): Electron.BrowserWindow | null => getShellWindow()
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'DSH Desktop',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: '设置（上游初始化）…',
          click: () => openPanel('setup', '设置 · DSH Desktop'),
        },
        {
          label: '诊断…',
          click: () => openPanel('diagnostics', '诊断 · DSH Desktop'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        {
          label: '退出（同时停止 dsh）',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重载 Web UI',
          accelerator: 'CmdOrCtrl+R',
          click: () => shellWindow()?.webContents.reload(),
        },
        {
          label: '重启 dsh 服务',
          click: () => dshManager.restart(),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '上游',
      submenu: [
        {
          label: '同步上游仓库…',
          click: () => openPanel('sync', '同步上游 · DSH Desktop'),
        },
        {
          label: '插件管理…',
          click: () => openPanel('plugins', '插件 · DSH Desktop'),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 安装托盘（macOS：显示/隐藏、退出）。重复调用是 no-op。 */
export function installTray(): void {
  if (tray !== null) return
  // 官方 DeepSeek 鲸鱼托盘图标（开发/打包路径由 dsh-contract 统一解析）
  const image = nativeImage.createFromPath(resolveAsset('tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('DSH Desktop')
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        const url = dshManager.status.url
        if (url !== null) showShellWindow(url)
      },
    },
    {
      label: '诊断…',
      click: () => openPanel('diagnostics', '诊断 · DSH Desktop'),
    },
    { type: 'separator' },
    {
      label: '退出（同时停止 dsh）',
      click: () => app.quit(),
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    const url = dshManager.status.url
    if (url !== null) showShellWindow(url)
  })
}

/** 桌面常驻偏好（关闭主窗口不退出时托盘保活）。 */
export function shouldKeepRunning(): boolean {
  return getSettings().keepRunningInTray
}
