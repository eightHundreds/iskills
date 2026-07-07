# Repository Guidelines

## 项目结构

`src/` 是严格模式的 TypeScript 源码。`src/cli.ts` 负责命令入口，`src/core.ts` 和 `src/git.ts` 处理存储与 Git 逻辑，`src/commands/` 放各子命令，`src/ui/` 放 Ink 界面和 termcn 相关组件。`bin/iskills.js` 是可执行入口。集成测试在 `test/cli.test.ts`，补充说明在 `docs/`，构建产物输出到 `dist/`，不要手改或提交。

## 构建、测试与开发

- `npm ci`：按锁定版本安装依赖，要求 Node.js 20+。
- `npm run build`：清空 `dist/` 并执行 `tsc` 编译。
- `npm start -- <args>`：本地运行 CLI，例如 `npm start -- list`。
- `npm run type-check`：只做严格类型检查，不输出文件。
- `npm test`：先构建，再运行串行的 `node:test` 集成测试。
- `npm pack --dry-run`：检查最终会进入 npm 包的文件。

## 代码风格

保持现有 TypeScript 风格：两空格缩进、分号、单引号、多行结构尾逗号、导出函数和重要函数写显式返回类型。变量和函数用 `camelCase`，类型和组件用 `PascalCase`。相对导入保留 `.js` 后缀，因为项目使用 NodeNext ESM。仓库没有统一 formatter 或 linter，改动要贴近周边代码，避免顺手重排。

## 测试要求

测试使用 `node:test` 和 `node:assert/strict`。用可观察行为命名，例如 `test('imports multiple Skills ...')`。涉及 CLI 流程时，使用临时 `HOME` 和 `XDG_*` 目录，并在 `finally` 中清理。PTY 和 Git 交互是串行敏感的，不要并发化这些测试。

## 提交与 PR

提交信息通常使用 `feat:`、`fix:`、`test:`、`chore:` 这类前缀，每个提交只做一件事。PR 需要说明改了什么、为什么改、影响什么、怎么验证；涉及可视化 UI 时附终端截图。合并前应通过 `npm test` 和 `npm pack --dry-run`。

## 发布约定

当我说“发布”，默认就是发布 npm 包，并且走 GitHub CI/CD，不是只打本地 tag。发布前要确认版本号与 `package.json` 一致，且生成的发布内容来自 `v*` 标签流程。
