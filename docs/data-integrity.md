# 收藏数据完整性契约

本文细化 [CLI/TUI 交互规范的数据完整性章节](cli-tui-guidelines.md)。它是从属于主规范的数据层契约，适用于 `import`、`search` 收藏、update、remove 等收藏写操作；若发生冲突，以主规范为准。

## 1. 同源与状态

- Git/远端 Skill 的同源依据是规范化仓库来源加仓库内 Skill 路径。显示名称、当前 commit 或安装量不能单独证明同源。
- skills.sh 的 `resultId` 是选择器，不替代同源依据；clone 和发现后必须解析为规范化仓库来源与来源路径。Git 来源先解析为 `(host, repositoryPath)`：去掉 transport、凭据、默认端口和尾部 `.git`/`/`，并把 SCP 风格分隔符规范化。host 一律小写；GitHub 的 `owner/repo` 也小写，其他 host 的 repository path 保留大小写。仓库内 Skill 路径必须是无 `.`、`..` 的 POSIX 相对路径。
- 本地 Skill 使用 `realpath` 后的 origin path；能从已知 lock 取得 Git provenance 时使用 Git 的同源依据。unknown provenance 不能推断为同源，同名时按来源冲突处理。
- 同名且同源属于已收藏/可更新；同名但异源或无法证明同源属于来源冲突。
- 写操作涉及的状态包括 Skill tree、metadata、state/links、baseline 和收藏夹 Git 工作树。

## 2. 确认前边界

在第一次可能破坏现有状态的写入前，流程必须已经完成：

1. 取得并校验输入或远端内容；
2. 发现唯一目标 Skill，并验证名称和目录树；
3. 判断是否同源和冲突类型；
4. 获得必要确认或校验显式 `--replace`。

确认前允许网络请求、临时 clone 和只读检查。用户取消后必须清理不再需要的临时 clone/workdir；不得顺带初始化收藏夹、改 metadata、移除旧 Skill 或创建无关 Git commit。只有恢复上一次中断事务所必需、幂等且独立报告的 integrity recovery 可以例外。

## 3. 替换事务结果

实现可以使用 staging、备份、rename、补偿操作或其他机制，但必须满足：

- 提交点之前或提交过程中任一步失败后，旧 Skill tree、metadata、links 和活动软链仍指向完整可用的旧版本。
- 成功后，新 tree、metadata、state/links，以及适用于该来源和收藏模式的 baseline 与 Git 记录描述同一版本；可选产物不存在时不要求创建。
- 不暴露半新半旧状态；回滚失败必须作为高优先级错误报告，不能继续输出成功。
- 临时 clone/workdir 在不再需要时清理。用于回滚的 staging/backup 在成功提交或完成回滚前不得清理。
- 提交后的 cleanup 失败不回滚已经提交的新版本；它以警告报告，并保留足够信息供后续幂等清理。

“原子替换”在项目文档中只表示上述结果不变量，不表示整个多文件/Git 流程由一个文件系统原子操作完成。

## 4. 消息与测试

- 删除旧内容、写入新内容和提交 Git 的中间步骤不得冒充最终完成。
- 每个可注入失败点都应测试旧版本可用性和元数据一致性。
- 至少覆盖：clone/发现失败、校验失败、复制失败、metadata/state 写入失败、软链失败、适用时的 Git commit 失败，以及提交前和提交后的 cleanup 失败。
