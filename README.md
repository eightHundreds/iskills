# iskills

独立的个人 Skill 收藏夹 CLI。命令名和配置目录名为 `iskills`，支持 macOS、Linux 和 Node.js 20+。

实现使用严格 TypeScript、Ink 和按 copy-owned 模式引入的 termcn 组件，按收藏操作、浏览交互、存储/发现、Git 生命周期和 CLI 路由拆分；发布包只包含编译后的 `dist/src`。

## 本地试用

```bash
pnpm link
iskills --help
```

默认收藏目录为 `$XDG_CONFIG_HOME/iskills`，未设置时使用 `~/.config/iskills`。收藏目录本身是 Git 仓库时自动提交变更并异步同步；Git 不是必需依赖。

## 命令

```bash
iskills                         # 交互式主界面
iskills search [关键词]          # 实时搜索 skills.sh，选择后保存到收藏夹
iskills list                    # 当前项目 / 全局 / 收藏夹列表，全局按 Agent 分 Tab
iskills import [路径或 Git URL]  # 导入到收藏夹，原本地位置保留软链
iskills import -g               # 扫描常见 Agent 全局目录
iskills import -g --agent pi    # 扫描 Pi 专属全局目录 ~/.pi/agent/skills
iskills add <技能>               # 从收藏夹添加到当前项目
iskills add <技能> -g            # 从收藏夹添加到一个或多个 Agent 全局目录
iskills add <技能> -g --agent pi # 添加到 Pi 专属全局目录 ~/.pi/agent/skills
iskills add <技能> --copy        # 复制并脱离收藏夹
iskills remove <技能>            # 从当前项目移除
iskills remove <技能> -g         # 从收藏夹移除或还回原始位置
iskills update [技能]            # 主动更新 Git 来源
iskills init                     # 初始化收藏夹 Git，并可选配置远程仓库
iskills init --remote <Git URL>  # 配置或更新 origin
iskills sync                    # 阻塞式同步收藏夹 Git
```

`iskills init` 首次运行时会询问是否配置远程仓库；配置后运行 `iskills sync` 开始同步。

冲突不会写入正在使用的 Skill。来源冲突保留在 `.local/conflicts`，由用户使用编辑器和 Git 手动解决；后续运行 CLI 时自动应用已提交的合并结果。

## 开发文档

- [CLI/TUI 交互规范](docs/cli-tui-guidelines.md)
- [终端 UI 架构 ADR](docs/adr/0001-terminal-ui-runtime.md)
- [收藏数据完整性契约](docs/data-integrity.md)
- [Agent Skills 目录支持调研](docs/agent-skills-support.md)

## 验证

```bash
pnpm test
pnpm pack --dry-run
```
