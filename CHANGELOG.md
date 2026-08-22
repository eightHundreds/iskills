# 更新日志

本文件记录 `iskills` 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 修复

- Claude Code MCP 开关改为写当前项目的 `disabledMcpServers` / `disabledMcpjsonServers`，不再在服务器对象上写 `disabled`。

### 变更

- MCP 密钥填写改为同屏多 Tab（键名、值），不再连续弹出两个输入框。

## [0.2.54] - 2026-08-21

### 变更

- MCP 收藏夹 Enter 安装改为与技能安装相同的审查：先选当前项目或全局，再选可写 Agent，确认后才写入。

## [0.2.53] - 2026-08-21

### 修复

- 对 Pi 上借来的 MCP 做开关，不再把停用桩当成项目/全局里的自有拷贝。
- MCP 安装不再给本机未出现、项目里也没有配置文件的 Agent 新建 MCP 配置；Pi / Grok 停用层删光后不再留下空文件。
- `iskills mcp add` 未指定 `--agent` 时跳过不可写 Agent，不再在第一个不可写目标处整批失败。
- 收藏夹多选更新：同一来源仓库只 clone 一次；每项更新成功后立即去掉待更新标记（↑）。
- MCP 从 JSON 导入：剪贴板没有可用 JSON 时，后备输入可粘贴多行。

### 变更

- 词汇表：MCP 的「位置」改为「MCP 位置」，并补上「停用层」。
- MCP 位置详情里，从项目 `.mcp.json` 借来的来源显示为 `<rootDir>/.mcp.json`，不再用 `shared-mcp-json`。
- MCP 位置详情「开关」同时显示 🟢/🔴 与启用/停用。

## [0.2.52] - 2026-08-20

### 新增

- `iskills mcp` 列表按 `m` 打开更多操作，可从 JSON（剪贴板或文件）导入 MCP 到收藏夹。
- MCP 收藏夹详情列可改名；协议登录（HTTP 401 发现）与静态密钥（配方 header/env 键）分开展示。

### 修复

- MCP 浏览：焦点在主 Tab、Agent 或标签列时，右栏不再预览当前项。

### 变更

- MCP 收藏夹列表不再提供 `r` 改名和 `l` 登录；改名、登录、填密钥都在详情列。

## [0.2.51] - 2026-08-18

### 修复

- 收藏/导入远程 skill 时使用 `git clone --depth=1`，避免为单个 Skill 完整 clone 大型仓库。指定 commit SHA 时仍完整 clone。

## [0.2.50] - 2026-08-16

### 新增

- `iskills mcp`：MCP 配置收藏夹 TUI（当前项目 / 全局 / 收藏夹），以及 `mcp create` / `mcp import` / `mcp add`。
- `iskills config` 可编辑收藏夹 Git 远程（`origin`）；远程地址输入框第一次 `Ctrl+C` 清空，1 秒内再按一次才中断。
- 收藏夹详情可打开 GitHub 来源并导入同仓其它技能。
- 收藏夹来源标签展示 Git 主机与仓库名。

### 修复

- 项目 / 全局 peek 名称区分「引用」与「本地」。
- import 源列表从最后一项回到第一项。
- footer 长错误省略，点击可看全文。
- 打开来源时状态文案不再误写成导入中。
- 收藏夹 Git 忽略 `.DS_Store`。

### 变更

- 最低 Node.js 版本降至 20.6（`module.register` / `AbortSignal.any` 等 API 地板；完整 TUI 仍推荐 Bun）。
- 收藏夹 `config.json` 纳入 Git 跟踪；远程地址仍只写 `origin`，不进 `config.json`。
- 备注、改名、搜索、筛选、设置列表等其它输入仍一次 `Ctrl+C` 即中断。

## [0.2.49] - 2026-08-06

### 修复

- 收藏夹同步：前台 merge 在 worktree 中隔离，避免未暂存改动导致 `pull --rebase` 静默失败；失败以 DomainError 展示在 footer。
- 批量 `t` 打标签成功后清空多选，避免切到新标签后仍显示选中态。

### 新增

- 底部状态栏健康入口 `⚠ N`（异步实时探测 Git 冲突/分叉与 source 冲突工作区）；点击或 `!` 打开告警 Modal。不再写入 `collection-conflict.json` 缓存。

### 变更

- 宽屏 `g` 聚焦左侧标签列（隐藏快捷键，不出现在 footer）；窄屏仍可跳转分组。

## [0.2.48] - 2026-08-04

### 修复

- 启动时若弹出收编确认，不再因 OverlayHost 尚未注册而二次 `createCliRenderer`，避免 `stdin is already used by another CliRenderer` 崩溃。

## [0.2.47] - 2026-08-04

### 新增

- 浏览器「更多」菜单：跨 agent 安装（收藏夹引用 → 收藏夹链接；本地目录 → 指向源的符号链接），含同源路径保护、安全替换与 usage 清理。
- 启动时若 `skills/` 下存在缺少收藏元数据的技能树，提示一次并写入 create 形态的 unknown-source 元数据。

### 修复

- 项目/全局详情显示路径是否已在收藏夹；`i` 导入前确认弹窗，取消不写盘。

### 变更

- 项目/全局不再用 `→` 聚焦详情列，右栏保持预览。
- 收藏写入：首次安装与替换统一为 `installCollectionSkill`；本地 realpath 同源判定；import plan/confirm/apply 共用；成功文案仅在 post-write Git commit 成功后打印。
- DomainError、shell footer、OpenTUI Node bootstrap 统一；合并安装改为事务式。
- 双仓 CI：私有仓完整测试 + 过滤同步公开仓；公开仓 `v*` 标签发布 npm。

## [0.2.46] - 2026-07-30

### 新增

- 界面中英文：默认跟随系统 locale（`zh*` 中文，其余英文）。
- `iskills config`：设置列表（UI 语言等），切换即写入 `~/.config/iskills/config.json`（支持 JSON5 读取）。
- 主浏览器收藏夹详情：标签 / 备注弹窗与详情列字段 focus 编辑。

### 变更

- CLI/TUI 用户可见文案迁入 `src/i18n` 目录；测试固定中文断言。

## [0.2.45] - 2026-07-30

### 修复

- CI 测试流水线安装 Bun，使 OpenTUI 原生 FFI / UI 帧测试可在完整测试中运行。标签发布 job 仍为 type-check + build + pack + publish（整套 UI 测试在推送前完成，不在 publish job 内重跑）。
- PTY 交互测试按可见屏幕网格匹配文案（兼容 OpenTUI 逐字 CUP 重绘与中文宽字符）。
- TTY 套件串行执行并放宽 wait 沉降时间，降低 CI 上 OpenTUI 多会话竞态。

### 新增

- TUI 从 Ink 迁移到 OpenTUI（Bun 原生 FFI），支持主题感知 Modal/面板与终端 light/dark。
- `create` 命令：在收藏夹新建技能并打开目录。
- 扩展 agent 安装/扫描目标：`zcode`、`trae`、`qoder`、`grok`；按 agent 根目录判定是否已安装。
- 列表/agent 鼠标交互、列内滚轮滚动、主题化 panel 与本地 braille spinner。

### 变更

- 去掉 Box 适配层与 Ink 命名 API，直接使用 OpenTUI `box`。
- 项目安装默认勾选：仅当当前项目已有对应 skills 目录时预选，避免首次把新 agent 全选。
- README 改为英文主文档，并附带 `README.zh-CN.md`。

## [0.2.41] - 2026-07-27

### 变更

- 三栏 master-detail 下筛选词不再折叠布局；Enter/→ 不进全屏详情（右栏即预览）。
- 顶栏去掉「/ 搜索技能…」；底栏前缀「Space 选中」、并露出「/ 筛选」。
- 三栏详情列用固定宽度标签（描述/备注/标签等）展示字段。
- 筛选输入改为单行 inline footer。

## [0.2.40] - 2026-07-27

### 修复

- CI 跳过易抖动的 TTY 详情框用例，保证发布流水线可完成（本地与其它 detail TTY 仍覆盖）。

## [0.2.39] - 2026-07-27

### 修复

- CI/Release 设置 `ISKILLS_DISABLE_MOUSE=1`，避免 PTY 套件开启 xterm 鼠标模式导致详情导航超时。

## [0.2.38] - 2026-07-27

### 修复

- TTY 详情用例用 Enter 打开详情，避免 CI 上右键导航竞态。

## [0.2.37] - 2026-07-27

### 修复

- TTY 详情用例等待稳定 footer 文案（`n 备注`），避免仅在可滚动时出现的 `↑/↓ 滚动` 导致发布失败。

## [0.2.36] - 2026-07-27

### 修复

- `useInput` 用 ref 稳定 handler，避免每次 render 重绑 stdin 导致 CI 丢键。
- 标签侧栏 ↑/↓ 使用 `tagCursorRef`，与列表 cursor 一致，避免连按停在同一标签。

## [0.2.35] - 2026-07-27

### 修复

- 筛选打开后等待 TextInput 挂载再输入，避免 CI 丢掉首字符导致发布失败。

## [0.2.34] - 2026-07-27

### 修复

- 稳定 ink UI 测试在 CI 下的输入/帧等待（更长 flush 与筛选逐字输入）。

## [0.2.33] - 2026-07-27

### 新增

- 主浏览器顶部 Tab 支持鼠标点击切换；指针命中按交互面栈（base / filter / layer / modal）裁定，独占上下文无需组件级 `mouseActive`。
- 自有 `useInput` 封装：自动丢弃终端鼠标报告，避免键盘 handler 吃到 SGR 序列。

### 变更

- 部分浏览器 UI 契约测试迁出 PTY，改由 ink-testing-library 覆盖。

## [0.2.32] - 2026-07-25

### 修复

- 发布流水线：`pnpm publish --no-git-checks`，避免 tag 检出 detached HEAD 被 git-checks 拦截。
- 稳定 TTY 发布阻塞用例：分组跳转 wait、混合选择 footer 断言与导航路径。

## [0.2.31] - 2026-07-25

### 修复

- 稳定 TTY 发布阻塞用例：分组跳转 wait、混合选择 footer 断言与导航路径。

## [0.2.30] - 2026-07-25

### 修复

- 稳定若干 TTY 交互测试：分组跳转等待与混合选择导航，避免 CI 发布流水线误杀。

## [0.2.29] - 2026-07-25

### 修复

- 稳定 TTY「跳转到分组」交互测试：避免与帮助文案中的同名短语竞态。

## [0.2.28] - 2026-07-25

### 变更

- 以主 TUI 统一浏览、删除、更新和 Git 同步，移除重复的 `list`、`remove`、`update`、`sync` 子命令。
- 保留独立 `search [关键词]` TUI，移除 `search --json` 与 `search --collect` 自动化入口。
- UI 按产品能力分包：`browser` / `search` / `import` / `install` / `prompts` / `overlay` / `shell`。
- 抽出独立 `overlay` 包（Layer / Modal 槽引擎）；`AppShell` 仅作壳层组合。
- 命令侧 `confirm` 与 Browser 共用 Modal 面板路径。
- 主浏览器迁 Ink 单树；标签侧栏按当前 Agent 统计与导航。

### 修复

- 修复 AppShell layer 确认与连续 prompt 的生命周期问题。

## [0.2.27] - 2026-07-16

### 修复

- 稳定技能浏览器详情区域的终端帧渲染。

## [0.2.26] - 2026-07-16

### 变更

- 拆分终端 UI 层次，明确渲染与交互责任。

### 修复

- 修复技能浏览器批量更新时绕过 Ink 清屏的问题。

## [0.2.25] - 2026-07-15

### 修复

- 确保 CLI 正确输出当前包版本。
- 稳定技能引用转换的中断测试。

## [0.2.24] - 2026-07-15

### 变更

- 发布 0.2.24 维护版本。

## [0.2.23] - 2026-07-15

### 新增

- 支持 Pi 的全局技能目录。
- 技能浏览器的安装流程改为项目与全局目标分页选择。

## [0.2.22] - 2026-07-14

### 新增

- 收藏夹浏览器支持将技能链接转换为本地副本（`c` 快捷键），便于在不脱离版本控制的前提下自定义修改技能。

## [0.2.21] - 2026-07-12

### 新增

- 收藏夹浏览器支持使用 `u` 批量更新已选技能中所有可更新的技能。

### 变更

- 升级 TypeScript 7，并显式加载 Node.js 与 React 类型定义。
- 优化技能导入确认流程，统一确认界面的视觉和交互行为。
- 优化技能更新进度展示，批量更新时显示当前项与总进度。
- 使用 pnpm 锁文件记录依赖解析结果。

## [0.2.20] - 2026-07-10

### 修复

- 修复相对路径或已存在的本地路径被误识别为 GitHub 仓库简写的问题。

## [0.2.19] - 2026-07-10

### 新增

- 支持从项目技能浏览器删除项目技能。
- 支持从全局 Agent 浏览器删除全局技能。

## [0.2.18] - 2026-07-09

### 修复

- 避免技能浏览器底部重复显示删除操作提示。

## [0.2.17] - 2026-07-09

### 变更

- 优化技能导入和浏览器操作的确认界面，使提示语义和选择行为更加一致。

## [0.2.16] - 2026-07-09

### 变更

- 优化技能浏览器快捷键帮助和详情页导航。
- 仅有一个未分组区域时隐藏冗余的分组标题。

## [0.2.15] - 2026-07-09

### 新增

- Git 导入确认界面显示仓库来源标识。
- 更新收藏技能时显示进度状态。

### 变更

- 优化长技能名称在浏览器中的展示。

## [0.2.14] - 2026-07-08

### 变更

- 最低 Node.js 版本提升至 24。
- 测试框架迁移至 Vitest，并调整集成测试超时配置。
- 修复跨平台 npm 锁文件问题。

## [0.2.13] - 2026-07-08

### 新增

- 收藏夹浏览器按 Agent 目录对项目技能进行分组。
- 增加浏览器、Git 和交互终端集成测试。

### 变更

- 将测试拆分为可并行测试与串行敏感测试，提高测试稳定性。
- 稳定收藏夹同步和直接打开收藏夹的 PTY 流程。

## [0.2.12] - 2026-07-08

### 新增

- 收藏技能时可选择安装方式。

## [0.2.11] - 2026-07-08

### 新增

- 新增 `iskills search` 命令，可从 skills.sh 搜索并收藏技能。

### 变更

- 统一搜索自动化路径、收藏替换事务和终端生命周期管理。
- 增加仓库开发指南，移除过期的符合性报告。

## [0.2.10] - 2026-07-07

### 新增

- 支持检查并更新来源为 Git 分支的收藏技能。

## [0.2.9] - 2026-07-06

### 变更

- 优化收藏夹中的技能查找体验。

## [0.2.8] - 2026-07-06

### 变更

- 改进 Skill 安装目标的选择流程。

## [0.2.7] - 2026-07-06

### 修复

- 移除 `@inkjs/ui` 引发的多 React 副本问题，修复终端界面崩溃。

## [0.2.6] - 2026-07-05

### 变更

- 将收藏夹添加流程的 PTY 测试改为集成测试，提高测试稳定性。

## [0.2.5] - 2026-07-05

### 变更

- 将不稳定的 PTY 测试改为非交互集成测试。

## [0.2.4] - 2026-07-05

### 新增

- 技能浏览器新增全局 Agent 标签页。
- 支持将全局 Agent 技能批量加入收藏夹。

### 修复

- 修正三标签页浏览器 PTY 测试的导航步骤。

## [0.2.3] - 2026-07-05

### 新增

- 无子命令启动时直接进入收藏夹浏览器，并可从界面添加技能。
- 技能浏览器支持按标签分组、多选和批量添加标签。
- 新增可视化标签编辑器。
- 项目技能页标记本地技能，并支持一键导入收藏夹。

### 变更

- 收藏夹列表优先展示技能备注。

## [0.2.2] - 2026-07-04

### 变更

- 改进导入流程中的技能选择体验。

## [0.2.1] - 2026-07-04

### 修复

- 精简并修正 CLI 帮助和初始化命令输出。

## [0.2.0] - 2026-07-04

### 新增

- 初始化收藏夹 Git 仓库，为技能收藏的版本控制和同步提供基础能力。

## [0.1.0] - 2026-07-04

### 新增

- 首次发布 `iskills` CLI。
- 支持技能的导入、安装、列出、删除和收藏夹管理。
- 提供基于 Ink 的终端技能浏览器和交互式提示。
- 集成 Git 收藏夹同步能力。
- 配置 npm 自动发布和跨平台 CI 测试。

### 修复

- 确保 npm 发布包保留 CLI 可执行权限。

[未发布]: https://github.com/eightHundreds/iskills/compare/v0.2.51...HEAD
[0.2.51]: https://github.com/eightHundreds/iskills/compare/v0.2.50...v0.2.51
[0.2.27]: https://github.com/eightHundreds/iskills/compare/v0.2.26...v0.2.27
[0.2.26]: https://github.com/eightHundreds/iskills/compare/v0.2.25...v0.2.26
[0.2.25]: https://github.com/eightHundreds/iskills/compare/v0.2.24...v0.2.25
[0.2.24]: https://github.com/eightHundreds/iskills/compare/v0.2.23...v0.2.24
[0.2.23]: https://github.com/eightHundreds/iskills/compare/v0.2.22...v0.2.23
[0.2.22]: https://github.com/eightHundreds/iskills/compare/v0.2.21...v0.2.22
[0.2.21]: https://github.com/eightHundreds/iskills/compare/v0.2.20...v0.2.21
[0.2.20]: https://github.com/eightHundreds/iskills/compare/v0.2.19...v0.2.20
[0.2.19]: https://github.com/eightHundreds/iskills/compare/v0.2.18...v0.2.19
[0.2.18]: https://github.com/eightHundreds/iskills/compare/v0.2.17...v0.2.18
[0.2.17]: https://github.com/eightHundreds/iskills/compare/v0.2.16...v0.2.17
[0.2.16]: https://github.com/eightHundreds/iskills/compare/v0.2.15...v0.2.16
[0.2.15]: https://github.com/eightHundreds/iskills/compare/v0.2.14...v0.2.15
[0.2.14]: https://github.com/eightHundreds/iskills/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/eightHundreds/iskills/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/eightHundreds/iskills/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/eightHundreds/iskills/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/eightHundreds/iskills/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/eightHundreds/iskills/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/eightHundreds/iskills/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/eightHundreds/iskills/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/eightHundreds/iskills/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/eightHundreds/iskills/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/eightHundreds/iskills/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/eightHundreds/iskills/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/eightHundreds/iskills/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/eightHundreds/iskills/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/eightHundreds/iskills/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eightHundreds/iskills/releases/tag/v0.1.0
