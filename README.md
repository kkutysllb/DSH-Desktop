# DSH Desktop

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的 Electron 桌面端。

dsh 是"一切皆插件"的开源 agent harness：运行时是由 profile 组装出的 Cordis 插件树。DSH Desktop 遵循这一理念——**它是宿主与侧车（host & sidecar）关系，而不是 fork**：桌面端零修改复用上游的 Web UI、API 网关（Typert Remote + `/api` 桥）、会话持久化（`~/.dsh`）与插件生态（[`dsh-plugin` 社区](https://github.com/topics/dsh-plugin)），自己只负责进程托管、窗口、托盘、上游同步与插件管理的桌面化呈现。

```
┌───────────────────────────── DSH Desktop（Electron）────────────────────────────┐
│  主进程                                                                        │
│   ├─ DshManager ──spawn──▶ dsh web --port 0（上游侧车，OS 分配端口）            │
│   │                          └─ stdout: "dsh web: http://127.0.0.1:<port>"     │
│   ├─ shell 窗口 ──loadURL──▶ http://127.0.0.1:<port>（上游 Web UI，零改动）    │
│   ├─ 面板窗口（preload 白名单 IPC）：设置 / 诊断 / 同步上游 / 插件             │
│   └─ Upstream/Plugins ──▶ git pull + pnpm build / dsh plugin --profile web …   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 快速开始

前置：Node.js（≥ 上游要求，见 `deepseek-harness/package.json` 的 `engines.node`）、pnpm、git。

```sh
pnpm install          # 安装桌面端依赖
pnpm setup            # 克隆上游（若缺）+ pnpm install + pnpm run build
pnpm dev              # 开发模式启动
# 或
pnpm build && pnpm start
```

也可在应用内完成：首次启动会进入"设置"页，一键初始化上游。

- 会话/凭据/插件数据在 `~/.dsh`（`DSH_HOME` 可覆盖），与 `dsh` CLI / `npx dsh web` 完全共享。
- 打包：`pnpm dist`（electron-builder，macOS dmg）。

## 图标

应用图标、托盘图标与启动页标志均取自上游官方 DeepSeek 图标（`deepseek-harness/website/public/favicon.svg`，官方鲸鱼标志 #4D6BFE），不自行设计：

- `pnpm icons`：用 Electron 离屏渲染把官方 SVG 栅格化为 `assets/icon.png`（1024，白底 squircle）、`build/icon.png`（512，打包用）与 `assets/tray.png`（32，透明底）。
- 启动页直接引用官方 SVG 副本 `desktop/renderer/public/deepseek.svg`。
- DeepSeek 名称与标志归 DeepSeek 所有；本作品是社区桌面壳，标志使用遵循上游 MIT 仓库的分发条款。

## 目录结构

```
desktop/
├── main/            # Electron 主进程
│   ├── index.ts     # 入口：单实例锁、启动流程、退出序列
│   ├── dsh-contract.ts  # ★ 上游契约适配层（升级上游时唯一要检查的文件）
│   ├── dsh-manager.ts   # dsh 侧车：spawn/就绪解析/崩溃重启/优雅退出
│   ├── upstream.ts  # 上游状态检测 + 同步流水线（fetch→ff-only→install→build）
│   ├── plugins.ts   # 插件桥：profile 层叠清单 + GitHub dsh-plugin 发现 + 安装转发
│   ├── windows.ts   # shell 窗口（无 preload，纯浏览器）与面板窗口
│   ├── menu.ts / ipc.ts / store.ts
├── preload/         # contextBridge 白名单（window.dshDesktop）
├── renderer/        # 本地面板（hash 路由，无框架）
└── shared/          # IPC 契约类型（主/渲染两侧唯一事实源）
scripts/
├── setup.sh         # 终端版首次引导
├── sync-upstream.sh # 终端版上游同步
└── make-icons.cjs   # 官方图标栅格化（Electron 离屏渲染）
deepseek-harness/    # 上游克隆（.gitignore 排除，绝不提交、绝不修改）
```

## 关键设计

### 集成点：HTTP 侧车而非 fork

上游 Web 前端依赖 host 注入的 `window.__DSH_BOOT__` 启动清单与同源 `/api` 路由、WebSocket 事件流（见上游 `docs/subsystems/web-server.md`、`docs/api-gateway.md`）。因此桌面端以 `--port 0` 拉起 `dsh web`，从 stdout 就绪行解析地址后 `loadURL`——所有上游功能零改动可用，上游升级自动跟随。

> 上游文档同样预留了另一条路线："Electron 通过 `file://` 加载已构建文件，并经 IPC 桥接发送 fetch 请求"。该路线需要上游实现 IPC carrier（当前代码中尚无），待其落地后可在 `dsh-contract.ts` 适配跟进。

### 安全边界

- shell 窗口：`sandbox: true`、无 preload、`webSecurity` 开启；`will-navigate` 只允许停留在 `127.0.0.1`，外链转系统浏览器；权限请求一律拒绝。
- 面板窗口：contextIsolation + 白名单 IPC（见 `desktop/shared/ipc-contract.ts`），渲染端零 Node 能力。

### 进程纪律

- `--port 0` 由 OS 分配端口，不与用户自起的 `dsh web`（默认 3080）冲突。
- 退出序列：SIGTERM → 5s 宽限 → SIGKILL，绝不留孤儿 dsh 进程。
- 崩溃自动重启（指数退避，最多 3 次），失败转设置页引导。

### 一切皆插件的桌面化

- 已装插件 = profile 层叠（`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`）。
- 安装/卸载/更新直接转发上游 CLI：`dsh plugin --profile web add|remove|update <pkg>`（pnpm 转发器，声明 `dsh.bundle` 的包自动入栈）。
- 社区发现：GitHub Search API（`topic:dsh-plugin`），5 分钟内存缓存规避限额。
- 插件变更属于 profile 组合（启动时组装的插件树），面板提供“重启 dsh 生效”。

### 自动更新（electron-updater + GitHub Releases）

发布源为本仓库的 GitHub Releases（`electron-builder.yml` 的 `publish` 配置）；发布新版本：`pnpm dist` 产出 dmg/zip 后上传 Release（或 `GH_TOKEN=… pnpm dist --publish always`）。行为：

1. 启动后 8s 静默检测新版本（仅打包版；开发模式在诊断面板提示不支持）；
2. 发现新版本 → **后台默认下载**（`autoDownload`），不弹窗不打断；
3. 下载完成 → 主窗口侧边栏 logo 旁出现安装按钮（隐藏式，平时不存在）——注入器向上上游 Web UI 的 `logoRow` 动态插入，零修改上游代码；菜单/托盘同步出现“安装更新并重启”；
4. 用户点击 → 先优雅关停 dsh 侧车 → `quitAndInstall` 退出安装 → 自动重启新版。

注入依赖上游 DOM 契约：侧边栏 `SidebarRoot.module.css` 的 `logoRow` / `collapsed` 类名（编译后哈希前缀不影响 `[class*=…]` 匹配）。上游变更后可运行：

```sh
pnpm exec electron scripts/verify-inject.cjs http://127.0.0.1:<dsh端口>
```

快速验证注入器是否仍然有效。

## 跟进上游

上游处于 developer preview，会有破坏性变更。同步流程：

```sh
# 应用内：菜单「上游 → 同步上游仓库…」，或终端：
pnpm sync-upstream
```

同步 = `git fetch` → 脏检查（有本地改动即拒绝）→ `git pull --ff-only` → `pnpm install` → `pnpm run build` → 自动重启 dsh。

### 升级契约检查清单（`desktop/main/dsh-contract.ts`）

上游若变更以下约定，只需更新该文件：

| 契约 | 依据 |
|---|---|
| 就绪行 `dsh web: http://127.0.0.1:<port>` | `packages/bundle/web-app/src/index.ts` `printUrl` |
| CLI flags `web --port 0` | `packages/bundle/web-app/src/startup.ts` |
| 构建产物 `apps/cli/lib/bin.js` | `apps/cli/package.json` `bin` |
| Harness home `~/.dsh` / `DSH_HOME` | `packages/util/home-paths` |
| 插件管理 `dsh plugin --profile <name> <pnpm args>` | `apps/cli/src/plugin.ts` |
| Profile 层叠 `dsh.profile.bundles` | `packages/boot/app-boot/src/profile.ts` |
| 侧边栏 `logoRow` / `collapsed` DOM 类名 | `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`（`scripts/verify-inject.cjs` 可验证） |
| 主题落点 `body[data-ds-dark-theme]` + `documentElement.style.colorScheme` | `packages/client/ui-theme/src/client/index.ts`（`scripts/verify-theme.cjs` 可验证） |
| 标题栏色 token sidebar-fill（深 `#1B1B1C` = neutral-bluish-900 / 浅 `#F9FAFB` = 50）与根布局 `html,body,#root{height:100%}` | `packages/client/ui-theme/src/styles/design-platform.css` + `packages/client/web/src/base.css`（标题栏用 WCO 覆盖条着色，页面注入等高 padding 下移） |
| Node 版本要求 `engines.node` | 根 `package.json`（不满足时自动回退 Electron 内置 node / 提示） |

### 仓库卫生

- `deepseek-harness/` 被 `.gitignore` 排除：上游是独立 git 克隆（remote 指向 deepseek-ai），本仓库不提交、不修改其中任何文件（含 lockfile）。
- 对上游的一切定制通过官方扩展点（patch / 插件 / profile）实现，不做 vendor fork。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_BIN` | 显式指定 dsh 启动命令（优先于本地克隆与 PATH） |
| `DSH_HOME` | 覆盖 dsh 数据目录（默认 `~/.dsh`） |

## Roadmap

- [ ] electron-updater 自动更新
- [ ] 全局快捷键唤起、deep link（`dsh-desktop://`）
- [ ] 文件/文件夹拖入会话（经上游 attachment 通道）
- [ ] 上游 IPC carrier 落地后迁移至 `file://` + IPC 桥（见上文）
- [ ] Windows / Linux 打包

## License

MIT（上游 deepseek-harness 亦为 MIT，见其 THIRD_PARTY_NOTICES.md）
