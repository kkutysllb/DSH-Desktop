/**
 * 渲染端入口：极简 hash 路由（#/splash、#/setup、#/diagnostics、
 * #/sync、#/plugins、#/terminal）。无框架——桌面壳页面保持
 * 除终端（xterm.js）外零运行时依赖。
 *
 * @module desktop/renderer/src/main
 */

import './app.css'
import { mountSplash } from './views/splash'
import { mountSetup } from './views/setup'
import { mountDiagnostics } from './views/diagnostics'
import { mountSync } from './views/sync'
import { mountPlugins } from './views/plugins'
import { mountTerminal } from './views/terminal'

const app = document.getElementById('app') as HTMLDivElement

type Route = 'splash' | 'setup' | 'diagnostics' | 'sync' | 'plugins' | 'terminal'

function route(): Route {
  const hash = window.location.hash.replace(/^#\//, '')
  const valid: Route[] = ['splash', 'setup', 'diagnostics', 'sync', 'plugins', 'terminal']
  return (valid as string[]).includes(hash) ? (hash as Route) : 'splash'
}

function render(): void {
  app.replaceChildren()
  switch (route()) {
    case 'splash':
      mountSplash(app)
      break
    case 'setup':
      mountSetup(app)
      break
    case 'diagnostics':
      mountDiagnostics(app)
      break
    case 'sync':
      mountSync(app)
      break
    case 'plugins':
      mountPlugins(app)
      break
    case 'terminal':
      void mountTerminal(app)
      break
  }
}

window.addEventListener('hashchange', render)
render()
