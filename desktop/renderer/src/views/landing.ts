/**
 * DeepSeek Harness 产品落地页。
 *
 * 保持为独立的 renderer 路由：它可在浏览器预览，也不干扰桌面壳的
 * splash / setup 启动路径。
 */

import type { DshStatus } from '@shared/ipc-contract'

type ModeKey = 'standard' | 'ptc' | 'minimal' | 'create'

interface LandingDesktopBridge {
  dshStatus(): Promise<DshStatus>
  showShell(): Promise<boolean>
  onDshStateChanged(cb: (status: DshStatus) => void): () => void
}

const modes: Record<ModeKey, { name: string; label: string; description: string; capability: string; command: string }> = {
  standard: {
    name: '标准模式',
    label: 'DEFAULT PRESET',
    description: '完整的编码 Agent。把文件编辑、Shell、检索、Skills、计划、目标、子代理和工作流放进同一个可组合的运行时。',
    capability: 'filesystem + shell + web + skills + subagents',
    command: 'dsh --profile web',
  },
  ptc: {
    name: 'PTC 模式',
    label: 'CODE MODE',
    description: '保留标准模式能力，并让模型以 TypeScript 程序编排多轮工具调用，在一个受控执行面里完成复杂任务。',
    capability: 'standard capabilities + TypeScript orchestration',
    command: 'dsh --preset ptc',
  },
  minimal: {
    name: '极简模式',
    label: 'BENCHMARK BASELINE',
    description: '只保留持久 bash 和 str_replace_editor，用于最小化环境下的模型基准测试与可控对照。',
    capability: 'persistent bash + str_replace_editor',
    command: 'dsh --preset minimal',
  },
  create: {
    name: '创造模式',
    label: 'COMPOSE YOUR OWN',
    description: '检查当前运行时、试验 Cordis 插件，并以真实配置树为素材创作新的 Agent preset。',
    capability: 'runtime inspect + plugin experiments + preset authoring',
    command: 'dsh --preset cordis',
  },
}

export function mountLanding(root: HTMLElement): void {
  root.className = 'landing-root'
  root.innerHTML = `
    <div class="landing-shell">
      <header class="landing-nav" aria-label="主导航">
        <button class="landing-brand" type="button" data-scroll="landing-hero" aria-label="回到顶部">
          <img src="deepseek.svg" alt="" width="28" height="28" />
          <span>deepseek</span>
          <i>Harness</i>
        </button>
        <nav class="landing-nav-links" aria-label="页面导航">
          <button type="button" data-scroll="architecture">架构</button>
          <button type="button" data-scroll="trajectory">Trajectory</button>
          <button type="button" data-scroll="modes">运行模式</button>
        </nav>
        <div class="landing-nav-actions">
          <span class="landing-preview-pill">DEVELOPER PREVIEW</span>
          <a href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <main>
        <section class="landing-hero" id="landing-hero" aria-labelledby="landing-title">
          <div class="hero-grid" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="hero-dots" aria-hidden="true"></div>
          <div class="hero-content">
            <div class="hero-copy">
              <p class="landing-eyebrow"><span></span> DEEPSEEK HARNESS / 开发者预览版</p>
              <h1 id="landing-title">一切皆插件<span class="title-stop">.</span></h1>
              <p class="hero-lead">DeepSeek Harness 是为真实工作而生的开源 Agent Harness。把模型接入一个可替换、可追溯、可持续演进的运行时。</p>
              <div class="hero-actions">
                <a class="landing-button landing-button-primary" href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">查看 GitHub <span aria-hidden="true">↗</span></a>
                <button class="landing-button landing-button-secondary" type="button" data-scroll="architecture">了解架构 <span aria-hidden="true">↓</span></button>
                <button class="landing-button landing-workbench-button" type="button" data-open-shell disabled>正在连接 dsh…</button>
              </div>
              <dl class="hero-facts">
                <div><dt>LICENSE</dt><dd>MIT 开源</dd></div>
                <div><dt>KERNEL</dt><dd>Cordis</dd></div>
                <div><dt>RUNTIME</dt><dd>Node.js 22+</dd></div>
              </dl>
            </div>

            <div class="runtime-card" aria-label="DeepSeek Harness 插件运行时示意">
              <div class="runtime-card-toolbar">
                <span class="runtime-status"><i></i><i></i><i></i></span>
                <span>dsh / runtime</span>
                <span class="runtime-live"><b></b> live</span>
              </div>
              <div class="runtime-map runtime-stack">
                <p class="runtime-kicker">AGENT = MODEL + HARNESS</p>
                <div class="runtime-flow">
                  <div class="runtime-stage stage-config"><div><small>CONFIGURATION</small><strong>web profile + patch</strong></div><em>choose · replace · extend</em></div>
                  <div class="runtime-flow-arrow arrow-blue" aria-hidden="true"></div>
                  <div class="runtime-stage stage-kernel"><div><small>CORDIS KERNEL</small><strong>loader / services / events</strong></div><em>dependency graph</em></div>
                  <div class="runtime-flow-arrow arrow-cyan" aria-hidden="true"></div>
                  <div class="runtime-capabilities"><small>PLUGIN CAPABILITIES</small><div><span>model</span><span>tools</span><span>skills</span><span>session</span><span>sandbox</span><span>ui</span></div></div>
                  <div class="runtime-flow-arrow arrow-lilac" aria-hidden="true"></div>
                  <div class="runtime-stage stage-loop"><div><small>AGENT RUNTIME</small><strong>loop + append-only events</strong></div><em>trace · replay · fork</em></div>
                </div>
              </div>
              <div class="runtime-command"><span>$</span><code>npx @deepseek-ai/dsh web</code><button type="button" class="runtime-copy" data-copy="npx @deepseek-ai/dsh web">复制</button></div>
            </div>
          </div>
          <div class="hero-bottomline" aria-label="产品关键词">
            <span>MODEL</span><b>+</b><span>HARNESS</span><b>=</b><span>AGENT THAT KEEPS WORKING</span>
          </div>
        </section>

        <section class="landing-section architecture-section" id="architecture" aria-labelledby="architecture-title">
          <div class="section-intro">
            <p class="section-index">01 / ARCHITECTURE</p>
            <h2 id="architecture-title">让 Agent 不止于回答，<br />而是在环境中持续工作。</h2>
          </div>
          <div class="architecture-body">
            <div class="principles" role="list">
              <article class="principle" role="listitem">
                <span class="principle-number">01</span>
                <div><h3>Cordis 只做内核该做的事</h3><p>加载、卸载、依赖关系。没有需要打补丁的特权核心，副作用随插件卸载而撤销。</p></div>
              </article>
              <article class="principle" role="listitem">
                <span class="principle-number">02</span>
                <div><h3>能力由插件提供</h3><p>模型、工具、技能、会话、沙箱、存储、循环、调度和 UI 都能独立更换，并通过服务与事件协作。</p></div>
              </article>
              <article class="principle" role="listitem">
                <span class="principle-number">03</span>
                <div><h3>在配置层完成组合</h3><p>选择、替换、扩展能力不必修改源码。每一个运行中的 dsh 都是一棵可审视的插件树。</p></div>
              </article>
            </div>
            <figure class="architecture-canvas" aria-label="插件组合配置示意">
              <div class="canvas-heading"><span>composition / web profile</span><b><i aria-hidden="true"></i>ready</b></div>
              <div class="architecture-diagram">
                <div class="diagram-layer diagram-config"><small>CONFIGURATION</small><strong>profile + patch</strong><em>choose / replace / extend</em></div>
                <div class="diagram-arrow arrow-config" aria-hidden="true"></div>
                <div class="diagram-layer diagram-kernel"><small>CORDIS KERNEL</small><strong>loader / services / events</strong><em>dependencies stay explicit</em></div>
                <div class="diagram-arrow arrow-kernel" aria-hidden="true"></div>
                <div class="diagram-capabilities"><small>PLUGIN CAPABILITIES</small><div class="capability-grid"><span>model</span><span>tools</span><span>skills</span><span>session</span><span>sandbox</span><span>ui</span></div></div>
                <div class="diagram-arrow arrow-events" aria-hidden="true"></div>
                <div class="diagram-layer diagram-events"><small>SESSION EVENT STREAM</small><strong>append-only log</strong><em>replay · fork · trace</em></div>
              </div>
              <pre><code><i>profile:</i>
  <b>bundles: [dsh-base, dsh-web-app]</b>
  <b>patch: your-plugin</b></code></pre>
            </figure>
          </div>
        </section>

        <section class="landing-section trajectory-section" id="trajectory" aria-labelledby="trajectory-title">
          <div class="trajectory-copy">
            <p class="section-index">02 / TRAJECTORY</p>
            <h2 id="trajectory-title">每一次运行，<br />都有迹可循。</h2>
            <p>模型看到的一切都写入仅追加的会话日志：系统提示词、工具调用、结果、子 Agent 调度和上下文注入。恢复、分叉、检索与回放共享同一份事件流。</p>
            <div class="trace-points"><span>APPEND ONLY</span><span>REPLAYABLE</span><span>FORKABLE</span></div>
          </div>
          <div class="trajectory-terminal" aria-label="Trajectory 运行日志示例">
            <div class="trajectory-toolbar"><span>Trajectory</span><span>session / research-ui</span><b>LIVE</b></div>
            <div class="trace-rail"><span></span><span></span><span></span><span></span><span></span><span></span></div>
            <ol class="trace-events">
              <li><time>10:43:02</time><i class="event-user"></i><div><small>user/message</small><strong>为产品页建立一个可访问的页面骨架</strong></div></li>
              <li><time>10:43:04</time><i class="event-model"></i><div><small>agent/request</small><strong>组装模型历史与工具 schema</strong></div></li>
              <li><time>10:43:11</time><i class="event-tool"></i><div><small>tool/call</small><strong>read_files · package.json · app.css</strong></div></li>
              <li><time>10:43:16</time><i class="event-tool"></i><div><small>tool/result</small><strong>4 files loaded · 0 errors</strong></div></li>
              <li><time>10:43:27</time><i class="event-model"></i><div><small>assistant/message</small><strong>提交可回放的页面变更</strong></div></li>
            </ol>
            <div class="trajectory-summary"><span>1 turn</span><span>2 tool calls</span><span>all context recorded</span></div>
          </div>
        </section>

        <section class="landing-section modes-section" id="modes" aria-labelledby="modes-title">
          <div class="modes-heading">
            <p class="section-index">03 / PRESETS</p>
            <h2 id="modes-title">以不同组合，<br />应对不同工作。</h2>
            <p>预设不是功能开关，而是每个会话实际运行的插件组装。选择一个起点，或从创造模式开始写下自己的组合。</p>
          </div>
          <div class="modes-workbench">
            <div class="mode-list" role="tablist" aria-label="DeepSeek Harness 运行模式">
              <button type="button" role="tab" data-mode="standard" aria-selected="true"><span>01</span><strong>标准模式</strong><i>默认</i></button>
              <button type="button" role="tab" data-mode="ptc" aria-selected="false"><span>02</span><strong>PTC 模式</strong><i>Code mode</i></button>
              <button type="button" role="tab" data-mode="minimal" aria-selected="false"><span>03</span><strong>极简模式</strong><i>Baseline</i></button>
              <button type="button" role="tab" data-mode="create" aria-selected="false"><span>04</span><strong>创造模式</strong><i>Compose</i></button>
            </div>
            <div class="mode-preview" role="tabpanel" aria-live="polite">
              <span class="mode-preview-label" data-mode-label>DEFAULT PRESET</span>
              <h3 data-mode-title>标准模式</h3>
              <p data-mode-description>完整的编码 Agent。把文件编辑、Shell、检索、Skills、计划、目标、子代理和工作流放进同一个可组合的运行时。</p>
              <div class="mode-capability"><span>CAPABILITIES</span><code data-mode-capability>filesystem + shell + web + skills + subagents</code></div>
              <div class="mode-command"><span>$</span><code data-mode-command>dsh --profile web</code><button type="button" data-mode-copy>复制</button></div>
            </div>
          </div>
        </section>

        <section class="landing-section evidence-section" aria-labelledby="evidence-title">
          <div class="evidence-header"><p class="section-index">04 / IN THE PRODUCT</p><h2 id="evidence-title">配置、会话与插件，<br />都在同一条脉络里。</h2></div>
          <div class="evidence-grid">
            <figure class="product-shot shot-plugins">
              <img src="harness/feat-plugin.png" alt="DeepSeek Harness 的插件设置界面" />
              <figcaption><span>插件目录</span><strong>安装、启用、替换</strong></figcaption>
            </figure>
            <figure class="product-shot shot-trajectory">
              <img src="harness/trajectory-real-view.zh.png" alt="DeepSeek Harness 的 Trajectory 会话轨迹界面" />
              <figcaption><span>Trajectory</span><strong>从事件流还原完整运行过程</strong></figcaption>
            </figure>
          </div>
        </section>

        <section class="landing-section install-section" id="start" aria-labelledby="install-title">
          <div class="install-copy">
            <p class="section-index">05 / START</p>
            <h2 id="install-title">现在，开始组合<br />属于你的 Harness。</h2>
            <p>开发者预览版正在快速迭代。核心插件和基础 API 会持续演进，欢迎把你的扩展发布到 DSH 插件生态。</p>
            <div class="install-links">
              <a href="https://deepseek-harness.github.io/deepseek-harness/guide/quickstart" target="_blank" rel="noreferrer">开发者文档 <span>↗</span></a>
              <a href="https://github.com/topics/dsh-plugin" target="_blank" rel="noreferrer">社区插件 <span>↗</span></a>
            </div>
          </div>
          <div class="install-terminal" aria-label="DeepSeek Harness 安装命令">
            <div class="install-tabs"><span class="is-active">快速体验</span><span>源码安装</span></div>
            <div class="install-command"><small>01</small><code><b>$</b> npx @deepseek-ai/dsh web</code><button type="button" data-copy="npx @deepseek-ai/dsh web">复制</button></div>
            <p>安装 Node.js 后启动本地 Web UI，默认监听 <code>127.0.0.1:3080</code>。</p>
            <div class="install-divider"></div>
            <div class="install-command"><small>02</small><code><b>$</b> git clone https://github.com/deepseek-ai/deepseek-harness.git</code><button type="button" data-copy="git clone https://github.com/deepseek-ai/deepseek-harness.git">复制</button></div>
            <p>从源码运行：安装依赖、构建，再执行 <code>pnpm dsh web</code>。</p>
            <span class="copy-notice" role="status" aria-live="polite"></span>
          </div>
        </section>
      </main>

      <footer class="landing-footer">
        <div class="footer-brand"><img src="deepseek.svg" alt="" width="21" height="21" /><span>deepseek</span><i>Harness</i></div>
        <span>Open source · MIT · Developer Preview</span>
        <a href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">github.com/deepseek-ai/deepseek-harness ↗</a>
      </footer>
    </div>
  `

  const dots = root.querySelector<HTMLElement>('.hero-dots')
  if (dots !== null) {
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 24; column += 1) {
        const dot = document.createElement('span')
        dot.style.setProperty('--dot-row', String(row))
        dot.style.setProperty('--dot-column', String(column))
        dots.append(dot)
      }
    }
  }

  for (const button of root.querySelectorAll<HTMLElement>('[data-scroll]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.scroll
      document.getElementById(id ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const preview = root.querySelector<HTMLElement>('.mode-preview')
  const modeTitle = root.querySelector<HTMLElement>('[data-mode-title]')
  const modeLabel = root.querySelector<HTMLElement>('[data-mode-label]')
  const modeDescription = root.querySelector<HTMLElement>('[data-mode-description]')
  const modeCapability = root.querySelector<HTMLElement>('[data-mode-capability]')
  const modeCommand = root.querySelector<HTMLElement>('[data-mode-command]')
  let selectedMode: ModeKey = 'standard'

  const renderMode = (key: ModeKey): void => {
    const mode = modes[key]
    selectedMode = key
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.setAttribute('aria-selected', String(button.dataset.mode === key))
    }
    modeTitle!.textContent = mode.name
    modeLabel!.textContent = mode.label
    modeDescription!.textContent = mode.description
    modeCapability!.textContent = mode.capability
    modeCommand!.textContent = mode.command
    preview?.animate(
      [{ opacity: 0.5, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 180, easing: 'ease-out' },
    )
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.addEventListener('click', () => renderMode(button.dataset.mode as ModeKey))
  }

  const notice = root.querySelector<HTMLElement>('.copy-notice')
  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      if (notice !== null) notice.textContent = '命令已复制到剪贴板'
    } catch {
      if (notice !== null) notice.textContent = '请手动复制命令'
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', () => void copy(button.dataset.copy ?? ''))
  }
  root.querySelector<HTMLButtonElement>('[data-mode-copy]')?.addEventListener('click', () => {
    void copy(modes[selectedMode].command)
  })

  const workbenchButton = root.querySelector<HTMLButtonElement>('[data-open-shell]')
  const desktop = (window as Window & { dshDesktop?: LandingDesktopBridge }).dshDesktop
  const renderDshStatus = (status: DshStatus): void => {
    if (workbenchButton === null) return
    if (status.state === 'ready' && status.url !== null) {
      workbenchButton.disabled = false
      workbenchButton.textContent = '进入工作台'
      return
    }
    workbenchButton.disabled = true
    workbenchButton.textContent = status.state === 'failed' ? 'dsh 启动失败，请检查设置' : '正在连接 dsh…'
  }

  if (desktop !== undefined) {
    void desktop.dshStatus().then(renderDshStatus)
    desktop.onDshStateChanged(renderDshStatus)
    workbenchButton?.addEventListener('click', () => {
      workbenchButton.disabled = true
      workbenchButton.textContent = '正在打开工作台…'
      void desktop.showShell().then((opened) => {
        if (!opened) void desktop.dshStatus().then(renderDshStatus)
      })
    })
  } else if (workbenchButton !== null) {
    workbenchButton.hidden = true
  }
}
