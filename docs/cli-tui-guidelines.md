# CLI/TUI 交互规范

本文是 `iskills` CLI/TUI **交互行为的唯一规范入口**。实现、测试和 AI agent 以本文为交互验收依据；外部链接、ADR、符合性报告和当前代码都不能覆盖本文。Accepted ADR 可以约束内部实现，但从属于本文且不能改变交互行为。

本文使用 **MUST**、**SHOULD**、**MAY** 表示必须、默认应当和可选。偏离 MUST 不得合并；偏离 SHOULD 必须在 PR 中说明理由。若规则冲突，优先级依次为：用户对当前任务的明确要求、仓库根目录 `AGENTS.md`、本文。

## 1. 范围与依据

本文约束可观察行为和跨实现的工程不变量，不规定必须使用哪个 hook、组件、session 类或 React 树结构。

规则来源分为三类：

- CLI 社区惯例：[Command Line Interface Guidelines](https://clig.dev/) 用于输出、自动化、错误和确认；它明确不覆盖全屏终端程序。
- 平台与框架事实：[POSIX Utility Syntax Guidelines](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html#tag_12_02) 只用于参数语法；[Ink 6.8.0](https://github.com/vadimdemedes/ink/blob/v6.8.0/readme.md) 和 [React](https://react.dev/reference/react) 文档只用于解释 API 与生命周期。
- `iskills` 产品决策：本文中关于中文文案、搜索、收藏冲突和具体按键的选择。

[Ink UI](https://github.com/vadimdemedes/ink-ui)、[terminal-ui skill 固定版本](https://github.com/pproenca/dot-skills/tree/8e3b42f8898762501ae14496b542efdf64a6e4a3/skills/.curated/terminal-ui) 及其他实现仅供调研。它们的规则不会因被链接而自动生效。ADR 记录实现选择，不是第二份规范。

## 2. CLI 契约

### CLI-1 参数与帮助

- 每个公共子命令 MUST 支持 `-h`、`--help` 和 `iskills help <command>`。
- 参数错误 MUST 在文件、metadata 或 Git 发生持久变更前报告。
- 帮助中的 `<required>`、`[optional]` 和参数名称 MUST 与实际解析一致。

### CLI-2 输出与退出状态

- 普通命令的结果写 stdout；警告、诊断和错误写 stderr。
- `--json` MUST 只向 stdout 写一个有效 JSON 文档，不混入颜色、进度、提示或解释文字。
- 成功为 0，预期执行失败为非零。意外错误默认显示简洁消息；调试模式 MAY 显示堆栈。

### CLI-3 自动化路径

- 每个核心状态变更 MUST 有不依赖 Prompt 的确定性调用方式。
- 可复用的远程搜索数据 MUST 能以机器可读格式取得，但无需把每个 Tab、cursor 或浏览步骤映射为参数。
- `search <query> --json` 是非交互查询接口。每条结果 MUST 带稳定的 `resultId`；后续收藏接受该 ID，或接受规范化 Git 来源加仓库内 Skill 路径，不得依赖当前排名、序号或仅凭显示名称。

### CLI-4 终端能力

- 只有交互输入流和 UI 实际渲染流都具备 TTY 能力时，才 MAY 启动 TUI。
- 能力检测 MUST 针对实现实际使用的流，不能固定假设 UI 一定渲染到 stdout。
- 条件不满足时 MUST 不输出动态 ANSI、不等待输入，并执行 plain/JSON 路径或给出一条可直接执行的替代命令。

## 3. 取消、中断与按键

### KEY-1 Esc

`Esc` MUST 只取消最内层上下文并恢复进入该上下文前的状态。在根页面取消整个命令时退出 0。取消当前流程不得产生该流程计划中的持久变更。

### KEY-2 Ctrl+C

当 `iskills` 持有终端时，`Ctrl+C` MUST 中断整个命令，而不是关闭局部模态框。程序完成有界清理、恢复终端后，CLI 顶层 MUST 返回 130。前台子进程已取得终端时，传播其退出结果。

### KEY-3 输入所有权

- 一个 active focus scope 内，一个按键组合 MUST 只产生一个语义动作；不要求只能存在一个输入 hook。
- 模态层激活时，背景层会响应相同按键的 handler MUST 停用。
- 同一种 view、focus 和对象中，Enter、Space、方向键的语义 MUST 稳定。上下文变化时 footer 必须同步变化。

### KEY-4 通用键盘语法

| 场景 | 按键 | 语义 |
| --- | --- | --- |
| 单选列表 | `↑/↓` | 移动当前项 |
| 单选列表 | Enter | 激活当前项 |
| 多选列表 | Space | 切换当前项 |
| 多选列表 | Enter | 提交已选项 |
| 文本输入 | Enter | 提交当前输入 |
| 文本输入 | Esc | 放弃输入并恢复原值 |
| 根浏览页 | `q` | 退出；文本输入激活时不得截获字符 `q` |

## 4. Prompt 与反馈

### PROMPT-1 确认

确认使用单行传统格式，默认值只出现一次：

```text
? 替换 wayfinder：old/source → mattpocock/skills？ (y/N)
```

- `y` 确认，`n` 取消，Enter 采用大写项，Esc 返回，Ctrl+C 中断。
- 覆盖、删除和可能丢失数据的操作 MUST 默认 `N`。
- footer 不得再重复 `Y/n`、`Enter 确认` 等说明。
- 已经明确选择的可逆操作不应额外确认；严重不可逆操作 SHOULD 要求输入资源名。

### PROMPT-2 状态与 footer

- idle/pending、loading、empty、error 和 success MUST 是不同状态，文案不得互相冒充。
- footer MUST 与实际 handler 和可用性一致；不可执行的动作不得显示为可用。
- footer SHOULD 只保留当前主要动作。进度、结果、警告和错误使用独立状态区域，不堆进快捷键行。
- 网络或 Git 操作一旦产生可感知等待，SHOULD 及时显示当前阶段；可恢复失败 SHOULD 保留上下文并允许重试。

### PROMPT-3 收藏夹添加方式

- 从收藏夹浏览器添加到当前项目或全局 Agent 目录时，MUST 在写入前选择软链或复制，并默认选中软链。单次批量添加的所有技能和目标使用同一方式。
- 取消方式选择不得创建目标目录、技能或链接状态。

### PROMPT-4 导入分组确认

- 交互式 `import` 在选择技能后、第一次持久写入前，MUST 进入带 `选择分组` 和 `确认` Tab 的导入确认界面。
- `选择分组` Tab MUST 可选择已有收藏分组（底层存储为标签），并可输入新增分组；完成分组选择后切到 `确认` Tab。
- `确认` Tab MUST 展示将导入的技能和本次应用的分组；用户确认后才开始写收藏夹，取消不得创建收藏夹、metadata、链接状态或 Git commit。
- `--yes` 自动化路径 MUST 不启动该 TUI，默认不添加分组。

### BROWSER-1 项目与全局分组

- “当前项目”和“全局”Tab MUST 按 Agent 目录显示子 Tab；`↑/↓` 在主 Tab、Agent 子 Tab和技能列表之间移动，`←/→` 切换当前层级的 Tab。
- “当前项目”Agent 子 Tab 内仍按收藏标签分组；同一技能出现在多个 Agent 目录时，MUST 在对应子 Tab 中分别可见。
- 三个 Tab 内按 `d` 或 Delete MUST 在浏览器内弹出默认取消的删除确认；已选择技能时删除已选技能，否则删除当前技能。
- “收藏夹”Tab 确认后 MUST 使用收藏夹移除流程，还原原始位置、清理使用软链、metadata、baseline 和 Git 记录。
- “当前项目”和“全局”Tab 确认后 MUST 只删除展示的技能位置并保留收藏夹内容；收藏夹软链、复制安装和普通本地技能都可删除。确认弹窗 MUST 展示实际路径，并明确本地内容会被永久删除。删除位置后 MUST 清理与该路径完全匹配的链接状态。
- “收藏夹”Tab 中存在已选技能时，`u` MUST 更新其中所有已检测到可更新的技能，并忽略已选但无更新的技能；没有已选技能时，`u` 更新当前可更新技能。批量更新 MUST 显示当前项及总进度。
- 全屏浏览器内触发的二次确认 MUST 使用浏览器内弹窗，不得退出 alternate screen 或刷出普通确认界面。
- 浏览器内确认弹窗 MUST 使用紧凑默认提示（如 `(y/N)`），footer 不得展开罗列 `n`、Enter、Esc 等取消键。

## 5. 异步、生命周期与布局

### ASYNC-1 过期状态隔离

- 有效查询变化后，旧查询结果 MUST 立即变为不可提交。
- 请求结果 MUST 绑定 query 或 request identity；过期响应不得修改当前结果、cursor、错误或 loading 状态。
- 清空旧结果和“保留但明确禁用”都可接受；不强制具体防抖时长或 spinner。

### TERM-1 终端恢复

- 正常退出、Esc、Ctrl+C、错误及可处理信号路径 MUST 恢复 raw mode、光标和 alternate screen。
- Promise 已 resolve 不等于 UI 已释放终端；实现必须显式完成屏幕生命周期。
- `SIGKILL` 等不可捕获终止不在恢复保证范围内。

### TERM-2 子进程交接

向继承 stdio 或直接连接同一 TTY 的前台子进程交出终端前，UI MUST 停止消费输入和渲染，并恢复子进程需要的终端状态。UI 保持挂载时，需要呈现的子进程输出必须 capture/pipe 后由 UI 的单一渲染通道输出；不接触终端的子进程不受本条限制。

### LAYOUT-1 可用性退化

- 终端尺寸缺失时按 80×24 计算。验收矩阵至少覆盖 40×10、80×24、160×48；40×10 必须可用 compact layout。低于 40×10 时 MAY 切换 plain 模式，或显示一行无 ANSI 的尺寸要求后失败，不能产生 `NaN`、越界或无限换行。
- compact layout MUST 至少保留页面标题、当前项或 empty/error 状态，以及当前上下文的一行主要动作。
- 当前项、选择、默认确认和错误 MUST 有不依赖颜色的标记。
- 结果行和 footer MUST 截断或分区布局，不得因默认 wrap 破坏 viewport。
- 文本编辑 MUST 不损坏 Unicode 输入；若暴露 Delete、Home、End 等键，其行为应符合常见终端输入习惯。

## 6. `search` 产品契约

### SEARCH-1 相关性与结果状态

- 默认 MUST 保留搜索服务返回的相关性顺序，不得按安装量对全部结果重新排序。
- 若增加大小写不敏感的精确名称优先，只能做稳定分区；同名结果之间仍保留服务端顺序，并用测试固定该产品决策。
- pending 时旧结果不得选择；错误后可重试，且不得丢失查询。

### SEARCH-2 收藏身份

- 远端收藏身份由规范化 Git 仓库来源和仓库内 Skill 路径共同确定，不能只比较显示名称。GitHub search 来源按小写 `owner/repo` 归一；路径使用无 `.`、`..` 的 POSIX 相对路径。其他来源的归一规则见数据完整性契约。
- 在执行动作前 MUST 区分：未收藏、同一远端身份已收藏、不同远端身份同名冲突。
- 未收藏项的 Enter 开始校验并收藏；同一身份已收藏项不可重复收藏，并提示改用 update；不同身份冲突的 Enter 在 staging/校验后进入替换确认。确认提示 MUST 展示双方完整身份；仓库相同时至少显示各自的仓库内路径。

### SEARCH-3 收藏流程

- 远端 clone、Skill 发现、名称和 Skill 树校验 MUST 在第一次破坏性持久变更前完成。
- 不同来源同名替换使用默认取消的确认，非交互路径要求显式 `--replace`。
- Clone、导入和提交期间 SHOULD 显示阶段；成功消息只能在收藏树、metadata/state 和适用的 Git 结果一致后输出。

## 7. 数据完整性

所有收藏写操作同时遵守 [数据完整性契约](data-integrity.md)。该文档细化本节，不得改变本文优先级。

### DATA-1 确认边界

第一次破坏性持久变更必须发生在校验和必要确认之后。只读预检和临时 staging 可以先执行；无关的 metadata 修复、初始化或 Git commit 不得借“预检”发生。

### DATA-2 替换结果不变量

“安全替换”指结果保证，不承诺某一次 `rename`：提交前失败后旧 Skill、metadata、links 和可用状态完整保留；成功后新 Skill tree、metadata、state/links，以及适用于当前来源和收藏模式的 baseline 与 Git 记录彼此一致。

### DATA-3 消息真实性

完成消息只能描述已经提交的结果。提交前的回滚或提交失败不得先打印“已删除”“已替换”或“已收藏”；提交后的清理失败作为警告单独报告，不能把已提交结果描述为未发生。

## 8. 验收

交互行为变更 MUST 按影响覆盖：

- PTY：嵌套 Esc、根级取消、Ctrl+C=130、快速按键和 modal 输入所有权。
- 能力：重定向 stdin/stdout、`--json` 纯净输出、缺失尺寸、40×10/80×24/160×48 和无颜色。
- 异步：防抖期间、乱序响应、取消、失败、重试和旧结果不可提交。
- 终端：正常/异常退出、alternate screen 恢复和继承 stdio 子进程交接。
- 数据：同源/异源、默认取消、显式替换、各失败点回滚和临时目录清理。

测试断言可观察行为、文件状态和退出码，不能只断言快照。PTY 与 Git 测试保持串行，优先等待可观察事件而不是延长固定 sleep。

## 9. 文档维护

- 新规则先修改本文，再实现并补充对应测试。不得为了让现有代码“符合”而降低规则。
- 框架、依赖和组件边界写入 [终端 UI 架构 ADR](adr/0001-terminal-ui-runtime.md)，不能伪装成社区 MUST。
- 外部资料变化只触发重新评估；维护者把决定写入本文后才生效。
