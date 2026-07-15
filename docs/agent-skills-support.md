# Agent Skills 目录支持调研

> 调研日期：2026-07-06；范围：`iskills` 当前支持的 Codex、Cursor、OpenCode 和 Claude Code。

## 结论

| Agent | 兼容 Agent Skills 格式 | 项目级 `.agents/skills` | 用户级 `~/.agents/skills` | `iskills` 安装目标 |
| --- | --- | --- | --- | --- |
| OpenAI Codex | 是 | 是 | 是 | 标准目录 |
| Cursor | 是 | 是 | 是 | 标准目录 |
| OpenCode | 是 | 是 | 是 | 标准目录 |
| Claude Code | 是 | 官方文档未列出 | 官方文档未列出 | `.claude/skills` |
| Pi | 是 | -- | 是 | `~/.pi/agent/skills`（仅全局） |

因此，交互式安装不应分别列出 Codex、Cursor 和 OpenCode，而应只列出实际目标目录：

- 标准 Agent Skills：项目 `.agents/skills`，全局 `~/.agents/skills`。
- Claude Code：项目 `.claude/skills`，全局 `~/.claude/skills`。
- Pi：全局 `~/.pi/agent/skills`。Pi 同时兼容标准全局目录，但 `iskills` 保留该专属目录作为独立安装、导入和浏览目标。

## 官方依据

### OpenAI Codex

Codex 官方手册明确说明 Skills 基于开放的 Agent Skills 标准，并从仓库层级的 `.agents/skills` 以及用户层级的 `$HOME/.agents/skills` 发现技能。

来源：[OpenAI Codex — Agent Skills](https://developers.openai.com/codex/skills)

### Cursor

Cursor 官方文档将 Agent Skills 称为开放标准，并列出四个发现位置：项目级 `.agents/skills` 与 `.cursor/skills`，以及用户级 `~/.agents/skills` 与 `~/.cursor/skills`。

来源：[Cursor — Agent Skills](https://cursor.com/docs/skills)

近期 Cursor 版本曾有一个已确认的注入阶段问题：`.agents/skills` 中的 Skill 已能被 Settings 和斜杠命令发现，但可能没有进入模型的 `<available_skills>` 上下文。这是运行时注入缺陷，不改变官方对 `.agents/skills` 的发现支持结论。

补充依据：[Cursor 官方社区回复](https://forum.cursor.com/t/cursor-agent-skills-in-agents-skills/161142/9)

### OpenCode

OpenCode 官方文档明确发现项目级 `.agents/skills` 和全局 `~/.agents/skills`；同时兼容 `.opencode/skills`、`.claude/skills` 及它们的全局位置。

来源：[OpenCode — Agent Skills](https://opencode.ai/docs/skills/)

### Claude Code

Claude Code 官方文档说明其 Skill 格式遵循 Agent Skills 开放标准，但“Where skills live”只列出项目级 `.claude/skills` 和用户级 `~/.claude/skills`，没有列出 `.agents/skills`。因此它在文件格式上兼容标准，但在自动发现目录上需要单列。

来源：[Claude Code — Extend Claude with skills](https://code.claude.com/docs/en/slash-commands#where-skills-live)

## 规范与目录约定

[Agent Skills Specification](https://agentskills.io/specification) 规定的核心是 Skill 目录结构、`SKILL.md` 及其 frontmatter，并不强制宿主 Agent 必须从某个固定根目录发现 Skill。`.agents/skills` 是 Codex、Cursor、OpenCode 共同实现的跨工具目录约定；本项目在 UI 中将它称为“标准 Agent Skills”。

## 实现决策

- 项目和全局安装都显示“标准 Agent Skills”和实际需要专属目录的 Agent 目标；Pi 只在全局安装目标中显示。
- 已存在的目标目录默认选中；不存在则默认不选中。
- `.cursor/skills`、`.opencode/skills` 等厂商目录可继续用于扫描和旧数据兼容，但不作为新的交互式安装目标。
- `--agent pi` 只可与 `--global` 一起使用；项目级标准目录仍使用 `--agent agents`。
