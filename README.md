# iskills

[![npm](https://img.shields.io/npm/v/iskills)](https://www.npmjs.com/package/iskills)
[![Node.js](https://img.shields.io/node/v/iskills)](https://www.npmjs.com/package/iskills)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/eightHundreds/iskills)

[中文](./README.zh-CN.md)

**Personal skill collection for AI coding agents** — discover, collect, install, and maintain skills that agents load via `SKILL.md`.

`iskills` is a terminal-first app: a full-screen TUI for day-to-day work, plus a small set of CLI commands for search, import, install, and Git setup. One collection per developer; no cloud account, no team admin surface.

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

- **Node.js** 24+
- **macOS** or **Linux**
- A TTY for the interactive UI (`stdin` and `stdout`)
- **Git** optional — enable only if you want collection versioning / remote sync

> **UI language:** TUI and CLI help are currently Chinese.

## Install

```bash
npm install -g iskills
# or
pnpm add -g iskills
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

# Install from your collection into this project (symlink)
iskills add my-skill

# Install into agent global dirs, or as a detached copy
iskills add my-skill -g --agent claude
iskills add my-skill --copy

# Optional: turn the collection into a Git repo (and set origin)
iskills init
iskills init --remote git@github.com:you/my-skills.git
```

In the main TUI, day-to-day work (browse, delete, update, notes, tags, sync) lives on the keyboard-driven browser. With a remote configured, press **`s`** on the Collection tab to sync.

## Commands

| Command | Description |
| --- | --- |
| `iskills` | Main TUI — project / global / collection browser |
| `iskills search [query]` | Search TUI against skills.sh; save selections to the collection |
| `iskills import [source]` | Import a local path or Git URL |
| `iskills add [skill…]` | Install from the collection into a project or global agent dir |
| `iskills init` | Initialize Git for the collection (optional remote) |

Common flags (see `iskills help <command>` for the full set):

- **`import`:** `-g` / `--global`, `--agent <name>`, `--all`, `--replace`, `-y`
- **`add`:** `-g` / `--global`, `--agent <name>`, `--to <dir>`, `--copy`, `--replace`, `-y`
- **`init`:** `--remote <git-url>`
- **`search`:** `--replace`

Supported `--agent` values: `agents`, `codex`, `claude`, `cursor`, `opencode`, `pi`.

## Collection layout

| Item | Location |
| --- | --- |
| Collection root | `$XDG_CONFIG_HOME/iskills`, or `~/.config/iskills` if unset |
| Git | Optional. When the collection is a Git repo, changes are auto-committed and can sync asynchronously |
| Source conflicts | `.local/conflicts` under the collection — resolve with an editor + Git |

After you commit a merge resolution, the next main TUI start (or a retained collection command) applies the result. Active in-use skills are never overwritten by conflict material.

## Development

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

Stack: TypeScript (strict), Ink, React. The published package ships compiled `dist/src` only.

## Non-goals

- Skill marketplace, hosting, accounts, or cloud sync as a product
- Desktop or web GUI
- CI/CD or headless machine API as the primary interface
- Multi-user / org permissions

## Contributing

Issues and pull requests are welcome. Please keep changes aligned with the interaction and domain specs under `docs/`, and run `pnpm test` before submitting.

## License

See the repository root for license and third-party notices.
