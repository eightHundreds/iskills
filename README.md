# iskills

[![npm](https://img.shields.io/npm/v/iskills)](https://www.npmjs.com/package/iskills)
[![Node.js](https://img.shields.io/node/v/iskills)](https://www.npmjs.com/package/iskills)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/eightHundreds/iskills)

[中文](./README.zh-CN.md)

**Personal skill collection for AI coding agents** — discover, collect, install, and maintain skills that agents load via `SKILL.md`.

`iskills` provides a full-screen TUI for people and a non-interactive JSON CLI for agents and scripts. Both manage skills and MCP configurations in one personal collection.

## Why iskills

Agent skills scatter across repos, global dirs, and project folders. `iskills` keeps a **single personal collection** as the source of truth, then installs into the places your agents already look:

| You want to… | How |
| --- | --- |
| **Discover** | Live search [skills.sh](https://skills.sh), or scan local / agent global directories |
| **Collect** | Import paths or Git sources into your collection with metadata, tags, and same-origin checks |
| **Install** | Link (default) or copy skills into the current project or agent global dirs |
| **Maintain** | Browse, update, delete, note, tag, and optionally sync the collection with Git — all in the TUI |

Data integrity comes first: writes are transactional where it matters; conflicts never land in skills you are actively using.

## Requirements

- **Node.js** 20.6+
- **Bun** recommended for the full-screen TUI (OpenTUI native FFI). Interactive entries re-exec under Bun when Node lacks `node:ffi`. Agent commands run on Node alone, without loading React or OpenTUI.
- **macOS** or **Linux**
- A TTY for the interactive UI (`stdin` and `stdout`)
- **Git** optional — enable only if you want collection versioning / remote sync

> **UI language:** Defaults to the system locale — Chinese (`zh*`) for Chinese UI, English otherwise. Override with `iskills config` (Chinese / English / follow system).

## Install

```bash
bun install -g iskills
```

Verify:

```bash
iskills --version
iskills --help
```

## Quick start

```bash
# Open the main browser (project · global · collection)
iskills

# Search skills.sh and save into your collection
iskills search react

# Import a local skill or a Git repository
iskills import ./my-skill
iskills import https://github.com/org/skills-repo.git

# Scan agent global skill directories
iskills import -g
iskills import -g --agent pi

# Create a new skill in the collection
iskills skill create my-skill

# Install from your collection into this project (symlink)
iskills skill install my-skill --agent codex --scope project

# Install into agent global dirs, or as a detached copy
iskills skill install my-skill --agent claude --scope global
iskills skill install my-skill --to ./copies --copy

# Optional: turn the collection into a Git repo (and set origin)
iskills collection init
iskills collection init --remote git@github.com:you/my-skills.git

# Configure UI language (follow system / Chinese / English)
iskills config

# MCP collection TUI (project / global / collection)
iskills mcp
```

In the main TUI, day-to-day work (browse, delete, update, notes, tags, sync) lives on the keyboard-driven browser. With a remote configured, press **`s`** on the Collection tab to sync.

## Commands

| Command | Description |
| --- | --- |
| `iskills` | Main TUI — project / global / collection browser |
| `iskills search [query]` | Search TUI against skills.sh; save selections to the collection |
| `iskills import [source]` | Import a local path or Git URL |
| `iskills config` | Configure UI preferences (language, collection Git remote) |
| `iskills mcp` | MCP collection TUI — project / global / collection |
| `iskills skill <action>` | Discover, import, create, install, update and maintain skills; JSON |
| `iskills mcp <action>` | Collect, write, update, enable/disable and maintain MCP entries and secrets; JSON |
| `iskills collection <action>` | Initialize Git, inspect/change origin, explicitly sync; JSON |
| `iskills config get\|set` | Read/change locale and secret tracking preferences; JSON |
| `iskills agents` / `iskills status` | Inspect supported targets and collection health; JSON |

Common flags (see `iskills help <command>` for the full set):

- **`import`:** `-g` / `--global`, `--agent <name>`, `--all`, `--replace`, `-y`
- **`skill install`:** explicit `--agent <id> --scope project|global` or `--to <dir>`, `--copy`, `--replace`
- **Writes:** `--dry-run` plans without changing persistent state; `--replace` authorizes replacement and `--yes` authorizes deletion
- **`search`:** `--replace`
- **`mcp create`:** `--input <UTF-8-file|->`; **`mcp add`:** explicit `--agent <id> --scope project|global`

Agent commands always emit one JSON document, including errors. Exit codes: `0` completed/unchanged, `2` usage or authorization, `3` preflight conflict, `1` execution failure, `130` interrupted. Check item statuses and `warnings` separately: a local Git commit can fail after the business write succeeds. Read commands never initialize or repair the collection. Agent writes do not start background remote sync; use `iskills collection sync` explicitly. See [the shipped agent guide](./AGENT-CLI.md) for examples.

Supported `--agent` values: `agents`, `codex`, `claude`, `cursor`, `opencode`, `pi`, `zcode`, `trae`, `qoder`, `grok`.

## Collection layout

| Item | Location |
| --- | --- |
| Collection root | `$XDG_CONFIG_HOME/iskills`, or `~/.config/iskills` if unset |
| Git | Optional. Writes commit locally; interactive flows may sync in the background, agent commands sync only explicitly |
| Source conflicts | `.local/conflicts` under the collection — resolve with an editor + Git, or copy a handoff from Alerts via **Copy for Agent** |

After you commit a merge resolution, the next main TUI start (or a retained collection command) applies the result. Active in-use skills are never overwritten by conflict material.

## Development

```bash
git clone https://github.com/eightHundreds/iskills.git
cd iskills
pnpm install --frozen-lockfile
pnpm run build
pnpm start -- --help
pnpm run type-check
pnpm pack --dry-run
```

Stack: TypeScript (strict), OpenTUI, React. The published package ships compiled `dist/src` only.

## Non-goals

- Skill marketplace, hosting, accounts, or cloud sync as a product
- Desktop or web GUI
- Multi-user / org permissions

## Contributing

Tests and internal documentation live outside this public tree. **Issues are welcome** — bugs, ideas, and questions.

## License

[MIT](./LICENSE)
