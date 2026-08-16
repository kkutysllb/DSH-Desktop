/**
 * Diagnostics：dsh 侧车诊断面板（状态、命令、日志尾部、重启）。
 *
 * @module desktop/renderer/src/views/diagnostics
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { DshLogLine, DshStatus } from '@shared/ipc-contract'

export function mountDiagnostics(root: HTMLElement): void {
  const statusText = document.createElement('div')
  const log = document.createElement('pre')
  log.className = 'log'
  const restartButton = document.createElement('button')
  restartButton.className = 'primary'
  restartButton.textContent = '重启 dsh'

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '诊断'),
        el('div', 'sub', 'dsh 侧车进程的运行状态与输出。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '状态'), statusText, el('div', 'row', [restartButton])]),
        el('div', 'card', [el('h2', '', '日志（尾部 500 行，实时）'), log]),
      ]),
    ]),
  )

  const stateLabel = (state: DshStatus['state']): string =>
    ({ stopped: '已停止', starting: '启动中', ready: '已就绪', failed: '失败', restarting: '重启中' })[state]

  const render = (status: DshStatus): void => {
    statusText.textContent = `状态：${stateLabel(status.state)}`
      + (status.url !== null ? `　·　地址：${status.url}` : '')
      + (status.source !== null ? `　·　来源：${{ env: 'DSH_BIN', checkout: '本地克隆', path: 'PATH' }[status.source]}` : '')
      + `　·　剩余自动重启：${String(status.restartsLeft)}`
    if (status.error !== null) {
      const err = el('div', '', `错误：${status.error}`)
      err.style.color = 'var(--danger)'
      statusText.append(err)
    }
  }

  const appendLine = (line: DshLogLine): void => {
    const span = document.createElement('span')
    if (line.stream === 'stderr') span.className = 'err'
    span.textContent = `${line.line}\n`
    log.append(span)
    while (log.childElementCount > 500) log.firstElementChild?.remove()
    log.scrollTop = log.scrollHeight
  }

  void bridge.dshStatus().then(render)
  void bridge.dshLogs().then((lines) => {
    log.replaceChildren()
    for (const line of lines) appendLine(line)
  })
  bridge.onDshStateChanged(render)
  bridge.onDshLog(appendLine)

  restartButton.addEventListener('click', () => {
    restartButton.disabled = true
    void bridge.dshRestart().then(() => {
      restartButton.disabled = false
    })
  })
}
