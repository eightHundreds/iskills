# Agent CLI

Run `iskills help <command path>` for options, for example `iskills help skill import`. Agent commands run under Node, never prompt, and return one JSON document. Human entries are `iskills`, `iskills mcp`, `iskills config`, `iskills search` and `iskills import`.

## Skills

```sh
iskills agents
iskills skill search review --limit 10
iskills skill discover --git owner/repository
iskills skill import --git owner/repository --path skills/review --expect-commit <reviewed-sha> --dry-run
iskills skill import --git owner/repository --path skills/review --expect-commit <reviewed-sha>
iskills skill install review --agent codex --scope project --dry-run
iskills skill install review --agent codex --scope project
iskills skill show review --body
iskills skill locations --scope project
```

`--project <directory>` sets project context and the base for relative input paths. Install requires explicit Agent/scope or `--to <skill-root>`. Local import moves the source directory into the collection and leaves a symlink; inspect its dry-run first. `--expect-commit` verifies HEAD without changing branch tracking; `source#sha` pins the source.

Maintenance actions: `create`, `adopt`, `edit`, `tag rename`, `source bind`, `source unbind`, `update`, `remove`, `uninstall`, `materialize`. Names are exact. Uninstall/materialize take the absolute installation paths returned by `skill locations`. Remove/uninstall/source unbind require `--yes`; source replacement requires `--replace`.

## MCP

Create an input file:

```json
{"recipe":{"transport":"http","url":"https://example.com/mcp","envKeys":[],"headerKeys":["Authorization"]},"description":"Documentation"}
```

```sh
iskills mcp create docs --input docs.json
iskills mcp secret set docs --header Authorization --value-file authorization.txt
iskills mcp add docs --agent claude --scope project
iskills mcp locations --agent claude --scope project
iskills mcp disable '<selector-from-locations>'
iskills mcp update docs --location '<selector-from-locations>' --replace
iskills mcp secret status docs
```

Pass selectors unchanged. They include project, Agent, scope, ownership, source file and native key. Borrowed entries cannot be updated or uninstalled. Secret values only enter via stdin/files; JSON output reports keys and configured state. `mcp import --input` accepts native JSON snippets, while `mcp create --input` uses the strict creation shape above. Same-source import fills missing secrets without overwriting existing values. Replacing an endpoint clears old credentials.

Other actions: `list`, `show`, `import`, `edit`, `rename`, `tag rename`, `enable`, `disable`, `uninstall`, `remove`, `probe`, `secret set|unset|status`.

## Results and retries

The envelope contains `schemaVersion`, `command`, `outcome`, `context`, `result`, `warnings`, `error`. Machine decisions use stable `error.code`/`details`; messages are English. Writes report every selected item's status: `committed`, `unchanged`, `conflict`, `failed`, `not-run`; dry-run uses `planned`. `committed` means business completion, independently of `result.git`.

Exit codes: `0` completed/unchanged or only Git soft failure; `2` usage/selection/authorization; `3` preflight conflict; `1` runtime failure; `130` interrupted. A runtime failure can preserve earlier committed items. Inspect unknown recovery state before retrying; repeat unchanged operations safely. MCP recipe and secret stages are reported separately so failed secrets can be completed on retry. Read lists retain valid entries and report damaged ones in `issues` with `partial`/exit `1`.

`--replace` permits selected replacement; `--yes` permits deletion. All writes support `--dry-run`. Queries and dry-run do not create persistent state. Agent writes commit locally when Git exists and never sync in the background.

```sh
iskills status
iskills collection init --remote <git-source>
iskills collection remote get
iskills collection sync --dry-run
iskills collection sync
iskills config get
iskills config set locale en
```
