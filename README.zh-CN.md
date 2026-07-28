# iskills

[![npm](https://img.shields.io/npm/v/iskills)](https://www.npmjs.com/package/iskills)
[![Node.js](https://img.shields.io/node/v/iskills)](https://www.npmjs.com/package/iskills)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/eightHundreds/iskills)

[English](./README.md)

**面向 AI coding agent 的个人 Skill 收藏夹** — 发现、收藏、安装并维护可通过 `SKILL.md` 被 Agent 加载的技能。

`iskills` 以终端为中心：日常使用全屏 TUI，并保留少量 CLI 入口用于搜索、导入、安装与 Git 初始化。每个收藏夹由单个开发者维护；无云账号、无团队权限面。

## 为什么用 iskills

技能往往散落在仓库、Agent 全局目录和项目目录里。`iskills` 用**一份个人收藏夹**作为真相源，再安装到 Agent 已经会扫描的位置：

| 你想… | 做法 |
| --- | --- |
| **发现** | 实时搜索 [skills.sh](https://skills.sh)，或扫描本地 / Agent 全局目录 |
| **收藏** | 将本地路径或 Git 来源导入收藏夹，带 metadata、标签与同源判定 |
| **安装** | 默认软链（或复制）到当前项目或 Agent 全局目录 |
| **维护** | 在 TUI 中浏览、更新、删除、备注、打标签，并可选用 Git 同步收藏夹 |

数据完整性优先：关键写入可回滚；冲突不会写入正在使用的技能。

## 环境要求

- **Node.js** 24+
- **macOS** 或 **Linux**
- 交互界面需要 TTY（`stdin` 与 `stdout`）
- **Git** 可选 — 仅在需要收藏夹版本管理 / 远端同步时启用

> **界面语言：** 当前 TUI 与 CLI 帮助为中文。

## 安装

```bash
npm install -g iskills
# 或
pnpm add -g iskills
```

验证：

```bash
iskills --version
iskills --help
```

## 快速开始

```bash
# 打开主浏览器（当前项目 · 全局 · 收藏夹）
iskills

# 搜索 skills.sh 并保存到收藏夹
iskills search react

# 导入本地技能或 Git 仓库
iskills import ./my-skill
iskills import https://github.com/org/skills-repo.git

# 扫描 Agent 全局技能目录
iskills import -g
iskills import -g --agent pi

# 在收藏夹新建技能并打开目录
iskills create my-skill

# 从收藏夹安装到当前项目（软链）
iskills add my-skill

# 安装到 Agent 全局目录，或以副本脱离收藏夹
iskills add my-skill -g --agent claude
iskills add my-skill --copy

# 可选：将收藏夹初始化为 Git 仓库（并配置 origin）
iskills init
iskills init --remote git@github.com:you/my-skills.git
```

日常操作（浏览、删除、更新、备注、标签、同步）在主 TUI 的键盘浏览中完成。配置远程后，在收藏夹 Tab 按 **`s`** 同步。

## 命令

| 命令 | 说明 |
| --- | --- |
| `iskills` | 主 TUI — 当前项目 / 全局 / 收藏夹浏览 |
| `iskills search [关键词]` | 独立搜索 TUI（skills.sh），选择后写入收藏夹 |
| `iskills create [名称]` | 在收藏夹新建技能并打开目录 |
| `iskills import [来源]` | 导入本地路径或 Git URL |
| `iskills add [技能…]` | 从收藏夹安装到项目或 Agent 全局目录 |
| `iskills init` | 初始化收藏夹 Git（可选远程） |

常用参数（完整列表见 `iskills help <命令>`）：

- **`import`：** `-g` / `--global`、`--agent <名称>`、`--all`、`--replace`、`-y`
- **`add`：** `-g` / `--global`、`--agent <名称>`、`--to <目录>`、`--copy`、`--replace`、`-y`
- **`init`：** `--remote <git-url>`
- **`search`：** `--replace`

`--agent` 可选：`agents`、`codex`、`claude`、`cursor`、`opencode`、`pi`、`zcode`、`trae`、`qoder`、`grok`。

## 收藏夹布局

| 项 | 位置 |
| --- | --- |
| 收藏根目录 | `$XDG_CONFIG_HOME/iskills`；未设置时为 `~/.config/iskills` |
| Git | 可选。收藏夹本身是 Git 仓库时，变更会自动提交，并可异步同步 |
| 来源冲突 | 收藏夹下 `.local/conflicts` — 用编辑器 + Git 手动解决 |

提交合并结果后，下次启动主 TUI（或运行保留的收藏操作）会自动应用。冲突内容不会写入正在使用的技能。

## 开发

```bash
git clone https://github.com/eightHundreds/iskills.git
cd iskills
pnpm install --frozen-lockfile
pnpm run build
pnpm start -- --help
pnpm run type-check
pnpm test
pnpm pack --dry-run
```

技术栈：严格模式 TypeScript、Ink、React。发布包仅包含编译后的 `dist/src`。

## 非目标

- 技能市场、托管、账号体系或云同步产品
- 桌面 / Web GUI
- 以 CI/CD 或无人脚本 / 机器 API 为主界面
- 多用户 / 组织级权限

## 贡献

欢迎 Issue 与 Pull Request。改动请对齐 `docs/` 下的交互与领域规范，提交前运行 `pnpm test`。

## 许可

许可与第三方声明见仓库根目录。
