/** Chinese message catalog — source of truth for MessageKey shape. */
export const zh = {
  // ── common ──────────────────────────────────────────────────────────────
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.none': '无',
  'common.noneIndented': '  无',
  'common.help': '帮助',
  'common.quit': '退出',
  'common.filter': '筛选',
  'common.filterLabel': '筛选: ',
  'common.switch': '切换',
  'common.enter': '进入',
  'common.back': '返回',
  'common.move': '移动',
  'common.edit': '编辑',
  'common.list': '列表',
  'common.select': '选中',
  'common.delete': '删除',
  'common.add': '添加',
  'common.detail': '详情',
  'common.view': '查看',
  'common.collect': '收藏',
  'common.more': '更多',
  'common.tags': '标签',
  'common.jumpTag': '跳转标签',
  'common.sync': '同步',
  'common.update': '更新',
  'common.materialize': '转换',
  'common.expand': '展开',
  'common.local': '本地',
  'common.git': 'Git',
  'common.unknown': '未知',
  'common.skill': '技能',
  'common.copy': '复制',
  'common.symlink': '软链',
  'common.project': '当前项目',
  'common.global': '全局',
  'common.origin': '原始',
  'common.usage': '使用',
  'common.dependent': '依赖',
  'common.originIndented': '  原始',
  'common.usageIndented': '  使用',
  'common.dependentIndented': '  依赖',
  'common.noDescription': '无描述',
  'common.interrupted': '操作已中断',
  'common.failed': '失败：{error}',
  'common.version': '版本',
  'common.source': '来源',
  'common.note': '备注',
  'common.description': '描述',
  'common.location': '位置',
  'common.path': '路径',
  'common.collectionStatus': '收藏状态',
  'common.relatedLocations': '关联位置',
  'common.all': '全部',
  'common.untagged': '未标签',
  'common.listSep': '、',
  'common.itemJoin': '；',

  // ── collection match ────────────────────────────────────────────────────
  'match.sameSource': '已收藏（同一来源）',
  'match.conflictingSource': '同名冲突（来源不同）',
  'match.unverifiedSource': '同名技能（来源未验证）',

  // ── CLI / help ──────────────────────────────────────────────────────────
  'cli.unknownCommand': '未知命令：{command}',
  'cli.errorPrefix': '错误：{message}',
  'cli.bunStartFailed': '无法启动 Bun 运行时：{message}',
  'cli.mainTtyRequired': '主 TUI 需要 stdin 和 stdout TTY；当前终端不支持。',
  'cli.configTtyRequired': '配置界面需要 stdin 和 stdout TTY；当前终端不支持。',
  'cli.pendingConflicts': '警告：存在 {count} 个待处理冲突。',
  'cli.searchTtyRequired': '独立搜索 TUI 需要 stdin 和 stdout TTY；当前终端不支持。',
  'help.search': `用法：
  iskills search [关键词]

实时搜索 skills.sh，选择后保存到收藏夹。

选项：
  --replace          替换异源同名收藏
  -h, --help         显示帮助
`,
  'help.add': `用法：
  iskills add [技能...] [选项]

从收藏夹添加技能到当前项目或 Agent 全局目录。

选项：
  --agent <名称>     限定 Agent，可重复使用（{agents}）
  -g, --global       添加到 Agent 全局 Skill 目录
  --to <目录>        指定目标目录
  --copy             复制而非创建软链
  --replace          替换已存在的技能
  -y, --yes          跳过确认
  -h, --help         显示帮助
`,
  'help.create': `用法：
  iskills create [名称]

在收藏夹新建技能，并打开技能目录。

选项：
  -h, --help         显示帮助
`,
  'help.import': `用法：
  iskills import [路径或 Git URL] [选项]

导入本地路径或 Git 来源到收藏夹。

选项：
  -g, --global       扫描 Agent 全局 Skill 目录
  --agent <名称>     限定 Agent，可重复使用（{agents}）
  --all              导入发现的全部技能
  --replace          替换收藏夹中的同名技能
  -y, --yes          跳过确认
  -h, --help         显示帮助
`,
  'help.init': `用法：
  iskills init [选项]

初始化收藏夹 Git 仓库并创建首次提交。

选项：
  --remote <Git URL>  配置或更新 origin
  -h, --help         显示帮助
`,
  'help.config': `用法：
  iskills config

打开配置界面，设置 UI 语言（跟随系统 / 中文 / English）。

选项：
  -h, --help         显示帮助
`,
  'help.root': `Skill 收藏夹

用法：
  iskills [命令] [选项]

命令：
  search [关键词]    搜索技能并保存到收藏夹
  add [技能...]      从收藏夹添加到当前项目
  create [名称]      在收藏夹新建技能并打开目录
  import [来源]      导入本地路径或 Git 来源
  init               初始化收藏夹 Git
  config             打开配置界面（UI 语言等）

选项：
  -h, --help         显示帮助（可用 iskills help <命令>）
  -v, --version      显示版本

`,
  'config.localeTitle': 'UI 语言',
  'config.localeSystem': '跟随系统',
  'config.localeZh': '中文',
  'config.localeEn': 'English',
  'config.settingsTitle': ' 设置 ',
  'config.settingsFooter': '←→ 切换 · Esc 关闭',
  'config.changeValue': '切换',

  // ── domain core ─────────────────────────────────────────────────────────
  'domain.unsafeSkillName': '不安全的技能名称：{name}',
  'domain.unsafeSourcePath': '不安全的来源子路径：{path}',
  'domain.symlinkEscapesTree': '技能包含逃出目录的软链：{path}',
  'domain.skillExistsInCollection': '收藏夹已存在同名技能：{name}',
  'domain.gitCommitFailed': '警告：收藏夹 Git 提交失败：{error}',
  'domain.originNotCollectionLink': '原始位置已不是指向收藏夹的软链，已中止：{path}',
  'domain.importFailedRollback': '导入失败：{error}；回滚失败：{rollback}',
  'domain.warnConflictCleanup': '警告：旧冲突目录清理失败：{error}',
  'domain.warnReplaceBackupCleanup': '警告：替换备份清理失败：{error}',
  'domain.noUsageInScope': '当前范围没有使用技能：{name}',
  'domain.usageNotExpectedLink': '使用位置已不是预期软链，未删除：{path}',
  'domain.notInCollection': '收藏夹中不存在：{name}',
  'domain.removeNeedsConfirm': '删除收藏需要确认',
  'domain.removedWithRestore': '已从收藏夹移除 {name}，并还回 {path}。',
  'domain.removed': '已从收藏夹移除 {name}。',
  'domain.cyclicSymlink': '技能包含循环软链：{path}',
  'domain.unresolvableSymlink': '技能包含无法解析的软链：{path}',
  'domain.symlinkOutside': '技能包含指向目录外的软链：{path}',
  'domain.copyStillHasSymlink': '副本仍包含软链：{path}',
  'domain.cannotOpCollectionByPath': '不能通过位置{operation}收藏夹内容：{path}',
  'domain.locationGone': '技能位置已不存在：{path}',
  'domain.locationChangedNotDeleted': '技能位置已发生变化，未删除：{path}',
  'domain.locationChanged': '技能位置已发生变化：{path}',
  'domain.notAReference': '技能位置不是引用：{path}',
  'domain.referenceUnresolvable': '技能引用无法解析：{path}',
  'domain.referenceNotDir': '技能引用目标不是目录：{path}',
  'domain.copyNameChanged': '复制结果中的技能名称已发生变化：{path}',
  'domain.materializeFailedRollbackItem':
    '转换失败：{error}；回滚失败：{path}: {rollback}',
  'domain.stateRollback': '状态：{error}',
  'domain.materializeFailedRollback': '转换失败：{error}；回滚失败：{rollback}',
  'domain.warnMaterializeTempCleanup': '警告：转换临时目录清理失败：{error}',
  'domain.collectionLinkChanged': '收藏夹链接已发生变化，未删除：{path}',
  'domain.mergeNotValidSkill': '合并结果不是有效技能：{name}',
  'domain.opDelete': '删除',
  'domain.opMaterialize': '转换',

  // ── git ─────────────────────────────────────────────────────────────────
  'git.initFailed': '无法初始化收藏夹 Git：{error}',
  'git.remoteEmpty': '远程仓库地址不能为空',
  'git.cloneFailed': '无法克隆 Git 来源：{error}',
  'git.conflictResolved': '收藏夹 Git 冲突已解决。',
  'git.appliedManualUpdate': '已应用手动解决的更新：{skill}',
  'git.conflictWithOrigin': '收藏夹与 origin 存在冲突，请在主 TUI 中同步后手动解决',
  'git.backgroundSyncFailed': '收藏夹后台同步失败：{error}',
  'git.branchMissing': '来源分支不存在：{ref}',
  'git.commitMissing': '来源历史中找不到上次同步 Commit：{commit}',
  'git.upstreamDeletedNeedsConfirm':
    '上游已删除 {name}；调用方必须确认或显式允许移除',
  'git.missingBaseline': '缺少首次更新所需的导入基线，请重新导入或重新绑定来源',
  'git.notARepo': '收藏夹不是 Git 仓库',
  'git.syncConflictManual': '收藏夹 Git 同步冲突，请使用 Git 手动解决',
  'git.syncFailed': '收藏夹 Git 同步失败：{error}',
  'git.initDone': '已初始化收藏夹 Git。',
  'git.alreadyInit': '收藏夹 Git 已初始化。',
  'git.configureRemotePrompt': '是否配置远程仓库？',
  'git.remoteAddressPrompt': '远程仓库地址：',
  'git.remoteConfigured': '已配置远程仓库 origin。',

  // ── commands / library ──────────────────────────────────────────────────
  'cmd.sameNameExistsReplace': '收藏夹已存在同名技能：{name}，请确认后使用 --replace',
  'cmd.oneSkillNameOnly': '一次只能指定一个技能名称',
  'cmd.skillNamePrompt': '技能名称：',
  'cmd.createdSkill': '已创建技能：{name}',
  'cmd.warnOpenPathFailed': '警告：无法打开目录：{error}',
  'cmd.skillMissingInSource': '来源仓库中不存在技能：{name}',
  'cmd.skillDuplicateInSource': '来源仓库中存在多个同名技能：{name}',
  'cmd.conflictingSourceExists': '收藏夹已存在异源同名技能：{name}；请使用 --replace',
  'cmd.unverifiedSourceExists':
    '收藏夹已存在同名技能（来源未验证）：{name}；请确认后使用 --replace',
  'cmd.conflictsExistReplace': '收藏夹已存在：{names}；确认后使用 --replace',
  'cmd.replaceSameNameConfirm': '替换同名收藏 {names} 吗？',
  'cmd.importedCount': '已导入 {count} 个技能。',
  'cmd.unknownAgent': '未知 Agent：{name}',
  'cmd.noPresentAgents': '未检测到已安装的 Agent 根目录，请使用 --agent 指定',
  'cmd.agentDisplayAgents': '标准 Agent Skills',
  'cmd.cannotSourceAndGlobal': '不能同时指定来源和 -g',
  'cmd.oneImportRootOnly': '一次只能指定一个导入根目录',
  'cmd.noSkillMd': '没有找到 SKILL.md',
  'cmd.useAllOrInteractive': '请使用 --all 或交互选择要导入的技能',
  'cmd.scanGlobalSkills': '扫描全局 Skill 目录',
  'cmd.selectRepoSkills': '选择当前仓库技能',
  'cmd.foundSkills': '发现以下技能',
  'cmd.useYesToConfirmImport': '请使用 --yes 确认导入',
  'cmd.globalNeedsAgent': '添加到全局目录时请指定 --agent',
  'cmd.selectGlobalAgent': '选择全局 Agent 目录：',
  'cmd.agentGlobalOnly': 'Agent {name} 只支持全局 Skill 目录，请使用 --global',
  'cmd.multipleAgentDirs': '检测到多个 Agent 目录：',
  'cmd.missingInCollection': '收藏夹中不存在：{names}',
  'cmd.specifySkillNames': '请指定技能名称',
  'cmd.scanCurrentDir': '扫描当前目录',
  'cmd.scanGlobalAgents': '扫描常见全局 Agent 目录',
  'cmd.enterPathOrGit': '输入本地路径或 Git 来源',
  'cmd.emptyCollectionImportWhere': '收藏夹还是空的，先从哪里导入技能？',
  'cmd.pathOrGitPrompt': '路径或 Git 来源：',
  'cmd.searchCollection': '搜索收藏夹：',
  'cmd.selectSkills': '选择技能：',
  'cmd.targetPointsSelf': '目标会指向技能自身：{target}',
  'cmd.replaceTargetConfirm': '目标已存在，替换 {target} 吗？',
  'cmd.targetExistsReplace': '目标已存在：{target}，请确认后使用 --replace',
  'cmd.addedSkillsToDirs': '已添加 {skills} 个技能到 {dirs} 个目录{copy}。',
  'cmd.addedCopySuffix': '（复制）',
  'cmd.invalidGitSource': '不是有效的 Git 来源：{input}',
  'cmd.syncDone': '同步完成',
  'cmd.upstreamDeleted': '上游删除',
  'cmd.upstreamDeletedConfirm': '上游已删除 {name}，执行收藏夹移除流程吗？',
  'cmd.linkKindLine': '{kind}：{path}',
  'cmd.updateFailedLine': '{name}: 更新失败 — {error}',
  'cmd.updatedCount': '已更新 {count}',
  'cmd.updatedWithFailed': '已更新 {updated}，失败 {failed}',
  'cmd.addTagsForSkills': '为 {count} 个技能添加标签',
  'cmd.tagged': '已加标签',
  'cmd.replaceTargetTitle': '替换目标',
  'cmd.addedCount': '已添加 {count}',
  'cmd.removedOne': '已移除 {name}',
  'cmd.removedCount': '已移除 {count}',
  'cmd.deletedOne': '已删除 {name}',
  'cmd.deletedCount': '已删除 {count} 处',
  'cmd.materializedOne': '已转副本',
  'cmd.materializedCount': '已转副本 {count}',
  'cmd.replaceCollectionTitle': '替换收藏',
  'cmd.importedShort': '已导入 {count}',
  'cmd.editNoteTitle': '编辑备注',
  'cmd.editNoteLabel': '备注（Enter 保存，Esc 取消）',
  'cmd.editTags': '编辑标签',
  'cmd.gitSourcePrompt': 'Git 来源（Enter 继续，Esc 取消）',
  'cmd.refPrompt': '分支、Tag 或 Commit（Enter 继续，Esc 取消）',
  'cmd.noSkillMdInRepo': '目标仓库中没有找到 SKILL.md',
  'cmd.selectSkillInRepo': '选择仓库内 Skill：',
  'cmd.installAgentsProject': '标准 Agent Skills (.agents/skills)',
  'cmd.installAgentsGlobal': '标准 Agent Skills (~/.agents/skills)',
  'cmd.collected': '已收藏 {name}。',
  'cmd.collectedSameSource': '{name} 已收藏自同一来源；可在主 TUI 中更新。',
  'cmd.searchHttpFailed': '搜索失败（HTTP {status}）',
  'cmd.searchInvalidPayload': '搜索服务返回了无效数据',
  'cmd.validatingCollect': '正在校验并收藏…',
  'cmd.replaceIdentityConfirm': '替换 {name}：{from} → {to}？',
  'cmd.collectFailed': '收藏失败：{error}',
  'cmd.retryCollect': '重试收藏吗？',

  // ── footer ──────────────────────────────────────────────────────────────
  'footer.updateWithCount': '更新({count})',
  'footer.selectedCount': '已选 {count}',
  'footer.working': '正在{action}{progress}',
  'footer.workingProgress': ' {current}/{total}',
  'footer.checkFailed': '{count} 个检查失败',
  'footer.checkingUpdates': '检查更新中',

  // ── browser ─────────────────────────────────────────────────────────────
  'browser.moreActionsTitle': ' 更多操作 ',
  'browser.moreActionsFooter': 'Enter 执行 · Esc 返回',
  'browser.localSkill': '本地 · {name}',
  'browser.inCollection': '已在收藏夹',
  'browser.notInCollection': '未收藏',
  'browser.selectSkillToView': '选择技能查看',
  'browser.selectedSkills': '已选择 {count} 个技能',
  'browser.skillLine': '技能：{names}',
  'browser.importCollectionTitle': '加入收藏夹',
  'browser.importCollectionOne': '将 {name} 加入收藏夹吗？',
  'browser.importCollectionMany': '将 {count} 个技能加入收藏夹吗？',
  'browser.removeCollectionTitle': '删除收藏',
  'browser.removeCollectionOne': '从收藏夹移除 {name} 吗？',
  'browser.removeCollectionMany': '从收藏夹移除 {count} 个技能吗？',
  'browser.removeLocationsTitle': '删除技能',
  'browser.removeLocationOne': '删除 {name} 的当前位置吗？',
  'browser.removeLocationsMany': '删除所选 {count} 个技能位置吗？',
  'browser.removeLocationsHint': '将永久删除以下位置；收藏夹内容（如有）保留。',
  'browser.tabProject': '当前项目 {count}',
  'browser.tabGlobal': '全局 {count}',
  'browser.tabCollection': '收藏夹 {count}',
  'browser.jumpToGroup': '跳转到标签：',
  'browser.detailFooterScroll': '↑/↓ 滚动 · ',
  'browser.detailFooterCollection': 'n 备注 · t 标签 · s 来源 · Esc 返回',
  'browser.detailFooterEsc': 'Esc 返回',
  'browser.noMatchingSkills': '没有匹配的技能',
  'browser.referenceName': '引用 · {name}',
  'browser.referencePrefix': '引用 · ',
  'browser.spaceSelect': 'Space 选中',
  'browser.enterViewSpaceSelect': 'Enter 查看 · Space 选中',
  'browser.materializeAction': '› 将引用转为副本',
  'browser.shortcutHelpTitle': ' 完整快捷键 ',
  'browser.shortcutHelpFooterScroll':
    '↑/↓/滚轮 移动 · e/Space 展开/收起 · ← 收起 · Esc 关闭  {range}',
  'browser.shortcutHelpFooter': '↑/↓/滚轮 移动 · e/Space 展开/收起 · ← 收起 · Esc 关闭',
  'browser.helpNav': '导航',
  'browser.helpNavMove': '移动焦点或列表项',
  'browser.helpNavTab': '切换当前层级 Tab',
  'browser.helpNavDetail': '窄屏打开详情（三栏右栏即预览，不进全屏）',
  'browser.helpNavFilter': '筛选技能',
  'browser.helpNavGroup': '跳转标签（有标签时）',
  'browser.helpSelect': '选择',
  'browser.helpSelectToggle': '切换选中（标签列：该标签下全部）',
  'browser.helpSelectEnter': '添加已选；窄屏打开详情（三栏右栏即预览）',
  'browser.helpCollect': '收藏与安装',
  'browser.helpCollectImport': '加入收藏夹（项目 / 全局已选本地技能）',
  'browser.helpMaintain': '维护',
  'browser.helpMaintainTag': '批量加标签（收藏夹已选）',
  'browser.helpMaintainUpdate': '更新：已选可更新者，否则当前项',
  'browser.helpMaintainMore': '更多操作 · 引用转副本（项目软链）',
  'browser.helpMaintainSync': '同步收藏夹 Git（可同步时）',
  'browser.helpMaintainDelete': '删除已选；无已选则删除当前项',
  'browser.helpGlobal': '全局',
  'browser.helpGlobalHelp': '打开本帮助',
  'browser.helpGlobalQuit': '退出浏览器',
  'browser.helpGlobalEsc': '取消最内层上下文',

  // ── components ──────────────────────────────────────────────────────────
  'comp.scrollRange': '↑/↓/滚轮 滚动 {from}–{to} / {total}',
  'comp.quickSelect': '1–{max} 快选 · ',
  'comp.newTagsComma': '新增标签（逗号分隔）',

  // ── import UI ───────────────────────────────────────────────────────────
  'import.confirmTitle': '确认导入',
  'import.selectGroups': '选择标签',
  'import.newGroupsComma': '新增标签（逗号分隔）',
  'import.groupInputFooter': 'Enter 完成标签 · Tab 返回已有标签 · Esc 取消',
  'import.groupListFooter':
    '↑/↓ 移动 · Space 选择 · Tab 切换输入 · Enter 完成标签 · → 确认 · Esc 取消',
  'import.fromAgentPath': '来自 {agent} · {path}',
  'import.detailFooterScroll': '↑/↓ 滚动 · ',
  'import.detailFooter': 'Esc 返回 · Space 选择 · Enter 确认导入',
  'import.selectSkillsTitle': '选择技能',
  'import.selectSkillsHeader': '{label} · 已选 {selected} / 共 {total}',
  'import.skillListFooter':
    '↑/↓ 移动 · Space 选择 · → 详情 · a 全选 · Enter 确认 · Esc 取消',
  'import.agentTabsFooter': '←/→ 切换 Agent · ↓ 返回技能列表 · Esc 取消',
  'import.skillListFooterAgent':
    '↑/↓ 移动 · Space 选择 · → 详情 · a 全选当前 · Enter 确认 · Esc 取消',

  // ── install UI ──────────────────────────────────────────────────────────
  'install.location': '安装位置',
  'install.method': '添加方式',
  'install.targetDirs': '目标目录',
  'install.nextStep': 'Enter 下一步',
  'install.selectAtLeastOne': '至少选择一个目录',

  // ── search UI ───────────────────────────────────────────────────────────
  'search.title': '搜索技能',
  'search.retryFooter': 'Enter 重试 · Esc 取消',
  'search.cancelFooter': 'Esc 取消',
  'search.listFooter': '↑/↓ 选择 · Enter 收藏 · Esc 取消',
  'search.minChars': '输入至少 2 个字符开始搜索',
  'search.searching': '正在搜索…',
  'search.noResults': '没有找到技能',

  // ── extra UI chrome ─────────────────────────────────────────────────────
  'ui.loading': '加载中…',
  'ui.multiSelectFooter': 'Space/空格 勾选 · Enter 确认 · Esc 取消',
  'ui.selectFooter': '↑/↓ 选择 · Enter 确认 · Esc 取消',
  'ui.selectedCount': '已选 {count}',
  'ui.existingTags': '已有标签',
  'ui.noExistingTags': '暂无已有标签',
  'ui.tagEditorFooter': '↑/↓ 移动 · Space 选择 · Tab 切换区域 · Enter 保存 · Esc 取消',
  'import.selectedGroups': '已选标签：{tags}',
  'import.noExistingGroups': '暂无已有标签',
  'import.willImport': '将导入 {count} 个技能；标签：',
  'import.moreItems': '… 还有 {count} 个',
  'import.confirmFooter': 'Enter 确认导入 · ← 返回标签 · n 取消 · Esc 取消',
  'import.noSkillsForAgent': '当前 Agent 没有可导入的技能',
  'install.locationStepFooter': '↑/↓ 选择 · Enter 下一步 · Esc 取消',
  'install.symlinkRecommended': '软链（推荐）',
  'install.methodStepFooter': '↑/↓ 选择 · ← 返回 · Enter 下一步 · Esc 取消',
  'install.targetsFooter':
    '↑/↓ 移动 · Space 选择 · ← 返回 · {next} · Esc 取消',
  'install.skillLine': '技能：{names}',
  'install.locationLine': '安装位置：{value}',
  'install.methodLine': '添加方式：{value}',
  'install.targetsLine': '目标目录：{value}',
  'install.confirmFooter': 'Enter 确认安装 · ← 返回 · n 取消 · Esc 取消',
  'install.title': '安装技能',
} as const;
