# ADR 0001：终端 UI runtime 与组件所有权

- 状态：Accepted
- 日期：2026-07-08
- 适用规范：[CLI/TUI 交互规范](../cli-tui-guidelines.md)

本 ADR 是有效的内部实现决策，但不是独立交互规范。它从属于主规范，不能改变用户可观察行为；若冲突，以主规范为准。

## 背景

`iskills` 同时包含行内 Prompt、搜索页和 alternate-screen 浏览器。当前代码使用 Ink + React、自有 termcn 组件和一个跨屏复用的 session coordinator。审查发现，框架选择本身不是主要风险；风险来自 Promise 完成与 UI 退出混为一谈、重叠输入 handler、同类型 rerender 保留旧 state，以及 UI 未释放终端时运行继承 stdio 的 Git 操作。

## 决策

1. 继续使用 Ink + React 作为终端渲染 runtime。
2. 继续维护 copy-owned `src/ui/termcn.tsx`。新增依赖需要证明可观的可访问性、输入法、布局或维护收益；“社区有组件”本身不足以引入依赖。
3. 普通组件不直接写 ANSI；alternate screen、clear 和终端交接由页面或 session 协调层负责。
4. 简单 Prompt 使用行内模式；主浏览器 MAY 使用 alternate screen。
5. 长驻 React 树和 coordinator loop 都是允许的实现。无论采用哪种方式，每个逻辑 screen 都必须有明确 identity，完成时必须真正结束或切换其输入与渲染生命周期，不能只 resolve 一个 Promise。
6. 复用同类型组件时必须通过明确的 state owner、`key` 或 unmount 防止上一个 screen 的 cursor、selection 和 effect 泄漏。
7. 继承 stdio 或直接连接同一 TTY 的前台子进程运行前卸载 UI 并归还终端。需要保留 UI 且呈现子进程输出时，capture/pipe 输出并由 Ink 的单一通道渲染；不接触终端的子进程不受此约束。
8. 当前不引入 Clack、第二套 Prompt runtime、自定义 ANSI diff 或 60fps 渲染目标；有实际需求时另写 ADR。

## 不属于本 ADR 的内容

Esc/Ctrl+C 语义、确认格式、TTY/自动化、搜索排序、冲突展示、数据回滚和 footer 行为由主规范定义。本 ADR 不授权用 `InkSession`、termcn 或现有代码覆盖那些规则。

## 后果

- 可以渐进修正现有 session，而不要求为了形式统一重写成单一 React 树。
- session API 需要区分“业务产生结果”和“UI 已退出/终端已释放”。
- 组件测试之外还必须有 PTY 生命周期和子进程交接测试。
- 如果 copy-owned TextInput 不能可靠处理 Unicode、Delete、尺寸退化等要求，应改进它或通过新 ADR 评估成熟组件，而不是降低规范。

## 参考

- [Ink 6.8.0 官方文档](https://github.com/vadimdemedes/ink/blob/v6.8.0/readme.md)
- [React 官方文档](https://react.dev/reference/react)

这些链接解释 API，不额外产生规则。
