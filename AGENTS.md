# AGENTS.md

## Cursor Cloud specific instructions

`iskills` 是一个纯本地 TypeScript CLI(Ink + React 终端 UI),没有需要长期运行的服务(无数据库、Web 服务器、docker)。开发只需 Node ≥ 20;`git` 需在 PATH 上以支持收藏夹版本化/同步;测试套件依赖 `python3`(用于 PTY 驱动交互式测试)。这些在 Cloud 环境中均已就绪。

标准命令见 `package.json` 的 `scripts`(`build` / `start` / `test` / `type-check`)与 `.github/workflows/ci.yml`。以下为非显而易见的注意事项:

- **测试必须去掉 `CI` 环境变量**:用 `env -u CI npm test`(与 CI 一致)。设置了 `CI` 时交互式测试行为不同,会失败。
- **测试前需配置 git 默认分支**:`git config --global init.defaultBranch main`(CI 也这样做),否则涉及 git 生命周期的测试可能失败。
- `npm test` / `npm start` 会先隐式 `npm run build`(编译到 `dist/`)。测试实际运行的是编译后的 `dist/test/cli.test.js`,不是源码。改完源码后重新跑脚本即可(脚本自带 build);直接 `node --test` 不会重新编译。
- **手动跑 CLI**:`node ./bin/iskills.js <命令>`(或 `npm link` 后用 `iskills`)。非交互式(无 TTY)环境下,`import`/`add`/`remove` 等需要确认的命令要加 `--yes`;`init` 不接受 `--yes`。
- 隔离运行/测试收藏夹时,用 `XDG_CONFIG_HOME` 指定收藏夹目录(默认 `~/.config/iskills`),`XDG_STATE_HOME` 指定锁文件目录,并设置 `SK_NO_BACKGROUND_SYNC=1` 关闭后台 git 同步子进程,避免残留进程。
- 远程 Git host 仅 `sync` / 远程导入才需要,本地核心流程无需任何 secret 或 `.env`。
