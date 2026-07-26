# 更新日志

本文件记录 `iskills` 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

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

[未发布]: https://github.com/eightHundreds/iskills/compare/v0.2.27...HEAD
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
