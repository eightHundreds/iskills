# iskills

[![npm](https://img.shields.io/npm/v/iskills)](https://www.npmjs.com/package/iskills)
[![Node.js](https://img.shields.io/node/v/iskills)](https://www.npmjs.com/package/iskills)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/eightHundreds/iskills)

[English](./README.md)

**面向 AI coding agent 的个人 Skill 收藏夹** — 发现、收藏、安装并维护可通过 `SKILL.md` 被 Agent 加载的技能。

`iskills` 同时提供供人使用的全屏 TUI，以及供 Agent 和脚本调用的非交互 JSON CLI。两者共同管理个人收藏夹中的技能和 MCP 配置。

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

- **Node.js** 20.6+
- **Bun** 推荐用于全屏 TUI（OpenTUI 原生 FFI）。Node 缺少 `node:ffi` 时，人用入口会 re-exec 到 Bun。Agent 命令直接运行于 Node，不加载 React 或 OpenTUI。
- **macOS** 或 **Linux**
- 交互界面需要 TTY（`stdin` 与 `stdout`）
- **Git** 可选 — 仅在需要收藏夹版本管理 / 远端同步时启用

> **界面语言：** 默认跟随系统 locale — 中文族（`zh*`）为中文，其余为英文。可用 `iskills config` 持久覆盖为中文 / English，或恢复跟随系统。

## 安装

```bash
bun install -g iskills
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

# 在收藏夹新建技能
iskills skill create my-skill

# 从收藏夹安装到当前项目（软链）
iskills skill install my-skill --agent codex --scope project

# 安装到 Agent 全局目录，或以副本脱离收藏夹
iskills skill install my-skill --agent claude --scope global
iskills skill install my-skill --to ./copies --copy

# 可选：将收藏夹初始化为 Git 仓库（并配置 origin）
iskills collection init
iskills collection init --remote git@github.com:you/my-skills.git

# 配置 UI 语言（跟随系统 / 中文 / English）
iskills config

# MCP 配置收藏夹 TUI（项目 / 全局 / 收藏夹）
iskills mcp
```

日常操作（浏览、删除、更新、备注、标签、同步）在主 TUI 的键盘浏览中完成。配置远程后，在收藏夹 Tab 按 **`s`** 同步。

## 命令

| 命令 | 说明 |
| --- | --- |
| `iskills` | 主 TUI — 当前项目 / 全局 / 收藏夹浏览 |
| `iskills search [关键词]` | 独立搜索 TUI（skills.sh），选择后写入收藏夹 |
| `iskills import [来源]` | 导入本地路径或 Git URL |
| `iskills config` | 配置界面偏好（UI 语言、收藏夹远程 Git） |
| `iskills mcp` | MCP 配置收藏夹 TUI — 项目 / 全局 / 收藏夹 |
| `iskills skill <动作>` | 发现、导入、新建、安装、更新与维护技能；JSON |
| `iskills mcp <动作>` | 收藏、写入、更新、开关及维护 MCP 与密钥；JSON |
| `iskills collection <动作>` | Git 初始化、查看/修改 origin、显式同步；JSON |
| `iskills config get\|set` | 读取/修改语言与密钥跟踪偏好；JSON |
| `iskills agents` / `iskills status` | 查看支持能力与收藏夹状态；JSON |

常用参数（完整列表见 `iskills help <命令>`）：

- **`import`：** `-g` / `--global`、`--agent <名称>`、`--all`、`--replace`、`-y`
- **`skill install`：** 显式 `--agent <id> --scope project|global` 或 `--to <目录>`，可加 `--copy`、`--replace`
- **写命令：** `--dry-run` 查看计划；`--replace` 授权替换，`--yes` 授权删除，两者互不蕴含
- **`search`：** `--replace`
- **`mcp create`：** `--input <UTF-8文件|->`；**`mcp add`：** 显式 `--agent <id> --scope project|global`

Agent 命令始终输出一个 JSON 文档，错误同样走 JSON。退出码：`0` 完成/无需变更、`2` 参数或授权、`3` 预检冲突、`1` 执行失败、`130` 中断。分别检查逐项状态与 warnings：业务成功后，本地 Git 提交仍可能失败。查询不初始化或修复收藏夹；Agent 写入不启动后台远端同步，需显式运行 `iskills collection sync`。调用示例见[随包 Agent 指南](./AGENT-CLI.md)。

`--agent` 可选：`agents`、`codex`、`claude`、`cursor`、`opencode`、`pi`、`zcode`、`trae`、`qoder`、`grok`。

## 收藏夹布局

| 项 | 位置 |
| --- | --- |
| 收藏根目录 | `$XDG_CONFIG_HOME/iskills`；未设置时为 `~/.config/iskills` |
| Git | 可选。写入保留本地提交；交互流程可后台同步，Agent 命令只显式同步 |
| 来源冲突 | 收藏夹下 `.local/conflicts` — 用编辑器 + Git 手动解决，或在告警里「复制给 Agent」交给其他 Agent |

提交合并结果后，下次启动主 TUI（或运行保留的收藏操作）会自动应用。冲突内容不会写入正在使用的技能。

## 开发

```bash
git clone https://github.com/eightHundreds/iskills.git
cd iskills
pnpm install --frozen-lockfile
pnpm run build
pnpm start -- --help
pnpm run type-check
pnpm pack --dry-run
```

技术栈：严格模式 TypeScript、OpenTUI、React。发布包仅包含编译后的 `dist/src`。

## 非目标

- 技能市场、托管、账号体系或云同步产品
- 桌面 / Web GUI
- 多用户 / 组织级权限

## 贡献

测试与内部文档不在本公开仓库中。**欢迎提 Issue**（缺陷、想法、问题均可）。

## 许可

许可与第三方声明见仓库根目录。
