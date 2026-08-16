/**
 * 消息样式覆盖层：零修改上游的前提下微调 Web UI 的消息排版。
 *
 * 上游是高度 token 化的设计系统（ui-theme 的 --dsw-* / --ds-* 变量），
 * 排版出口全部变量化——覆盖层在文档末尾注入 `<style>`，按同特异性
 * 后到者赢的层叠规则直接改写 token 值；个别写死在 CSS Modules 规则
 * 里的值（气泡宽度/圆角等）用「文件名前缀 + 类名」属性选择器匹配
 * （如 [class*="MessageItem_bubble"]，产物类名形态 MessageItem_bubble__hash，
 * 全前端唯一，不会误伤同名类）。
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

/* ---- 用户气泡：宽度上限放宽（宽屏）+ 圆角/内距/字号利落化 ---- */
[class*="MessageItem_userStack"] { max-width: min(640px, 88%) !important; }
[class*="MessageItem_bubble"] {
  border-radius: 16px !important;
  padding: 8px 14px !important;
  font-size: 15px !important;
  line-height: 23px !important;
}

/* ---- assistant 正文：与 markdown base 统一，块间距微收 ---- */
[class*="AssistantMarkdown_root"] { font-size: 14px !important; line-height: 22px !important; }
[class*="AssistantMarkdown_body"] { gap: 14px !important; }

/* ---- 代码块：圆角收敛（局部变量重定义，banner 顶角自动跟随） ---- */
[class*="CodeBlock_block"] { --dsl-code-block-border-radius: 10px; }

/* ---- 消息列宽：960 → 1080（挂在 ConversationRoot 容器自身，:root 覆盖无效；
   输入卡/dock 卡引用同一变量自动跟随，上游是单一宽度轴设计） ---- */
[class*="ConversationRoot_root"] {
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
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(INJECT_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  win.webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.removeListener('did-finish-load', onDidLoad)
    }
  })
}
