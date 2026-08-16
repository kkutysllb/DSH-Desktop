/**
 * 消息样式覆盖层：零修改上游的前提下微调 Web UI 的消息排版。
 *
 * 上游是高度 token 化的设计系统（ui-theme 的 --dsw-* / --ds-* 变量），
 * 排版出口全部变量化——覆盖层在文档末尾注入 `<style>`，按同特异性
 * 后到者赢的层叠规则直接改写 token 值；个别写死在 CSS Modules 规则
 * 里的值（气泡宽度/圆角等）用属性选择器匹配 scoped 产物类名。
 *
 * 产物类名含「_+原类名」子串，但 hash 位置随构建形态不同（dsh 运行
 * 时即时编译是 _<hash>_<类名>，vite build 是 _<类名>_<hash>）——
 * 一律按「_+类名」子串匹配（如 [class*="_userStack"]），不依赖
 * hash 的位置与具体值。同名类跨文件冲突（.bubble 在 Tooltip/
 * MessageItem/GoalCommandInputView 三处）用结构判别（userStack 后代）；
 * 类名太泛的（_root/_block）只重定义无人误消费的 CSS 变量。
 * 上游类改名 → 覆盖静默失效回原样，不崩不错位。
 *
 * 主题适配纯 CSS 完成：上游深色主题挂 body[data-ds-dark-theme]，
 * 覆盖层用同一宿主选择器写深色差异，无需监听主题事件重注入。
 *
 * 脆性边界：上游改名 token/类名 → 覆盖静默失效、显示回原样，
 * 不崩不错位（与 sidebarCol 探针同一可靠性等级）。上游相关样式：
 * ui-theme/src/styles/gradient-shadow-text.css（排版 token）、
 * ui-conversation MessageItem/AssistantMarkdown.module.css（气泡/正文）、
 * ui-primitives markdown/CodeBlock.module.css（代码块）。
 *
 * @module desktop/main/style-overlay
 */

import type { BrowserWindow } from 'electron'

/** 注入的 style 元素 id（幂等替换）。 */
const STYLE_ID = '__dsh_desktop_style_override'

/**
 * 覆盖样式。定值取向：中文排版密度（16/28 正文对 13" 屏偏松）、
 * 气泡更利落（22px 圆角 → 16px，宽度上限放宽利用宽屏）、标题层级
 * 收敛（h1-h4 与正文比例更协调）、深色主题气泡与背景对比拉开一档。
 */
const OVERRIDE_CSS = `
/* ---- 排版 token（shorthand + longhand 双写：部分组件用 longhand） ---- */
:root {
  --dsw-font-markdown-base: 400 14px/22px var(--dsw-font-family);
  --dsw-font-markdown-base-font-family: var(--dsw-font-family);
  --dsw-font-markdown-base-font-weight: 400;
  --dsw-font-markdown-base-font-size: 14px;
  --dsw-font-markdown-base-font-style: normal;
  --dsw-font-markdown-base-line-height: 22px;
  --dsw-font-markdown-base-strong: 600 14px/22px var(--dsw-font-family);
  --dsw-font-markdown-base-strong-font-size: 14px;
  --dsw-font-markdown-base-strong-line-height: 22px;
  --dsw-font-markdown-h1: 700 21px/30px var(--dsw-font-family);
  --dsw-font-markdown-h1-font-size: 21px;
  --dsw-font-markdown-h1-line-height: 30px;
  --dsw-font-markdown-h2: 700 19px/28px var(--dsw-font-family);
  --dsw-font-markdown-h2-font-size: 19px;
  --dsw-font-markdown-h2-line-height: 28px;
  --dsw-font-markdown-h3: 600 17px/26px var(--dsw-font-family);
  --dsw-font-markdown-h3-font-size: 17px;
  --dsw-font-markdown-h3-line-height: 26px;
  --dsw-font-markdown-h4: 600 15px/24px var(--dsw-font-family);
  --dsw-font-markdown-h4-font-size: 15px;
  --dsw-font-markdown-h4-line-height: 24px;
  --dsw-font-markdown-code-block: 13px/21px var(--ds-font-family-code);
  --dsw-font-markdown-code-block-font-size: 13px;
  --dsw-font-markdown-code-block-line-height: 21px;
}

/* ---- 用户气泡：宽度上限放宽（宽屏）+ 圆角/内距/字号利落化。
   bubble 类跨文件同名（Tooltip/MessageItem/GoalCommandInput 三处），
   用「userStack 后代」结构判别锁定 MessageItem 的那一处（userStack
   全仓唯一）；两个选择器均按「_+类名」子串匹配，对 hash 位置无感 */
[class*="_userStack"] { max-width: min(640px, 88%) !important; }
[class*="_userStack"] [class*="_bubble"] {
  border-radius: 16px !important;
  padding: 8px 14px !important;
  font-size: 15px !important;
  line-height: 23px !important;
}

/* ---- 代码块：圆角收敛（局部变量重定义，banner 顶角自动跟随）。
   _block 是常见类名，泛匹配仅定义一个局部变量——非 CodeBlock 的
   block 后代不消费 --dsl-code-block-border-radius，零视觉副作用 */
[class*="_block"] { --dsl-code-block-border-radius: 10px; }

/* ---- 消息列宽：960 → 1080。定义方（ConversationRoot 容器）与消费方
   （ChatView/输入卡等）同用 _root 类名；泛匹配把 1080 广播到所有
   root，消费方取最近定义一致为 1080，非会话子树不消费该变量，
   上游是单一宽度轴设计，输入卡/dock 卡自动跟随 */
[class*="_root"] {
  --dsh-chat-content-width: 1080px;
}

/* ---- 深色主题：气泡与背景（900）对比拉开一档 ---- */
body[data-ds-dark-theme] {
  --dsw-specific-bubble: var(--dsw-static-neutral-bluish-800);
}
`

/** 注入脚本（幂等：替换已存在的同 id 标签；SPA 内部导航不清 head）。 */
const INJECT_JS = `(() => {
  const css = ${JSON.stringify(OVERRIDE_CSS)}
  let el = document.getElementById('${STYLE_ID}')
  if (el === null) {
    el = document.createElement('style')
    el.id = '${STYLE_ID}'
    document.head.append(el)
  }
  if (el.textContent !== css) el.textContent = css
})()`

/**
 * 给 shell 窗口挂样式覆盖（每次整页加载后重新注入，脚本自幂等；
 * 重复调用安全，窗口重建时旧监听随窗口销毁）。
 */
export function attachStyleOverlay(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  // "Object has been destroyed"（terminal-panel 同款防御）
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(INJECT_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
