# CLI/TUI 规范符合性报告

> 审查日期：2026-07-08；对象：当前工作树。本文只记录现状，不产生规范，也不能作为保留缺陷的依据。

## 结论

本轮审查识别出的缺口已经修复。搜索、替换事务、终端生命周期和自动化路径均有行为测试；本报告不代表以后新增行为会自动符合主规范。

## 已识别缺口

| 优先级 | 规范 | 状态 | 当前证据与差距 |
| --- | --- | --- | --- |
| P0 | DATA-2 | 已修复 | 替换先 staging 并快照 tree、metadata、baseline 和 state；严格提交失败会恢复旧版本、origin 和 usage links。测试注入 commit hook 失败并验证完整回滚。 |
| P1 | TERM-1 | 已修复 | `InkSession` 给每个 screen 独立 identity，完成后等待卸载/输入清理；界面只在输入监听和 raw mode 就绪后显示。Ctrl+C 由 session 统一转为退出码 130。 |
| P1 | TERM-2 | 已修复 | browser sync 前关闭 Ink session、离开 alternate screen，sync 完成后再恢复页面；PTY Git sync 测试覆盖该交接。 |
| P1 | CLI-3 | 已修复 | `search <query> --json` 返回稳定 `resultId`；`--collect <resultId>` 提供确定性收藏，替换要求显式 `--replace`。 |
| P1 | CLI-4 | 已修复 | 交互搜索同时检查 stdin/stdout TTY；失败消息直接给出 `search <关键词> --json` 替代路径。 |
| P1 | ASYNC-1 | 已修复 | 查询变化立即清空结果并递增 request identity；所有结果、错误和 loading 写入都校验当前 request。 |
| P1 | SEARCH-1 | 已修复 | 保留服务端返回顺序；JSON 测试固定顺序，安装量只作展示。 |
| P1 | SEARCH-2 | 已修复 | 入库前用规范化仓库 URL 加仓库内路径判断身份；同源返回 unchanged，异源显示双方完整身份后确认。 |
| P1 | KEY-1 / DATA-1 | 已修复 | CLI 在 collection 初始化和 Git preflight 前分流 search；JSON 查询和 Esc 取消测试验证不创建收藏目录。 |
| P2 | PROMPT-2 | 已修复 | browser 把导航、动作和状态分行，只展示当前可执行动作；搜索收藏显示阶段，失败保留上下文并允许重试。 |
| P2 | LAYOUT-1 | 已修复 | 尺寸缺失按 80×24/24 行回退，列表按 viewport 截断；40×10 搜索取消有 PTY 覆盖。 |
| P2 | LAYOUT-1 | 已修复 | TextInput 用 grapheme cluster 编辑，区分 Backspace/Delete，并支持 Home/End 和组合粘贴输入。 |

## 当前可保留的设计

- 单行 `(y/N)`，Enter 采用大写默认项。
- 搜索防抖和 effect cleanup 的方向。
- 当前项使用 `›`，不只依赖颜色。
- Browser 用 `isActive` 划分背景页与模态输入 scope，且关闭了 session 级 Esc handler。
- alternate screen 放在浏览器协调层并通过 `finally` 离开。
- Ink + React 和 copy-owned termcn；它们是 ADR 决策，不是 UX 规范。

## 验证

- `npm test`：覆盖 CLI、PTY、Git 和回滚行为。
- `npm pack --dry-run`：验证发布包内容。
- 后续改动若重新引入缺口，应把对应状态改回“不符合”，不得修改主规范来迁就实现。

主规范中的 SHOULD 项仍需在具体 PR 中按变更范围检查；“已修复”仅指本表记录的现有缺口。
