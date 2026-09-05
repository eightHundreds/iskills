/** Chinese message catalog — source of truth for MessageKey shape. */
export const zh = {
  // ── common ──────────────────────────────────────────────────────────────
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.clear': '清空',
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
  'common.openSource': '打开来源',
  'common.more': '更多',
  'common.tags': '标签',
  'common.jumpTag': '跳转',
  'common.sync': '同步',
  'common.update': '更新',
  'common.materialize': '转副本',
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
  'common.reference': '引用',
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
  'cli.logWritten': '完整日志：{path}',
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

打开配置界面，设置 UI 语言与收藏夹远程 Git 地址。

选项：
  -h, --help         显示帮助
`,
  'help.mcp': `用法：
  iskills mcp
  iskills mcp create [名称]
  iskills mcp import [选项]
  iskills mcp add [名称...] [选项]

管理 MCP 配置收藏夹。无子命令时打开项目 / 全局 / 收藏夹浏览器。

create 选项：
  --transport <stdio|http|sse>  传输
  --command <命令>              stdio 启动命令
  --url <URL>                   http/sse 地址
  --args <参数>                 可重复

import / add 选项：
  -g, --global       全局位置（默认当前项目）
  --agent <名称>     限定 Agent，可重复
  --all              导入全部发现项
  --replace          替换同名收藏
  -y, --yes          跳过确认
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
  config             打开配置界面（UI 语言、远程 Git、MCP 密钥）
  mcp                MCP 配置收藏夹

选项：
  -h, --help         显示帮助（可用 iskills help <命令>）
  -v, --version      显示版本

`,
  'config.localeTitle': 'UI 语言',
  'config.localeSystem': '跟随系统',
  'config.localeZh': '中文',
  'config.localeEn': 'English',
  'config.remoteTitle': '收藏夹远程',
  'config.remoteUnset': '未设置',
  'config.settingsTitle': ' 设置 ',
  'config.settingsFooter': '←→ 切换 · Esc 关闭',
  'config.changeValue': '切换',
  'config.editValue': '编辑',

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
  'domain.warnOriginNotRestored': '警告：原始位置已不是指向收藏夹的软链，已保留未改：{path}',
  'domain.noUsageInScope': '当前范围没有使用技能：{name}',
  'domain.usageNotExpectedLink': '使用位置已不是预期软链，未删除：{path}',
  'domain.notInCollection': '收藏夹中不存在：{name}',
  'domain.sourceNotBound': '该技能没有可解绑的 Git 来源：{name}',
  'domain.unbindFailedRollback': '解绑来源失败：{error}；回滚失败：{rollback}',
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
    '引用转副本失败：{error}；回滚失败：{path}: {rollback}',
  'domain.stateRollback': '状态：{error}',
  'domain.materializeFailedRollback': '引用转副本失败：{error}；回滚失败：{rollback}',
  'domain.warnMaterializeTempCleanup': '警告：引用转副本临时目录清理失败：{error}',
  'domain.collectionLinkChanged': '收藏夹链接已发生变化，未删除：{path}',
  'domain.mergeNotValidSkill': '合并结果不是有效技能：{name}',
  'domain.opDelete': '删除',
  'domain.opMaterialize': '引用转副本',
  'mcp.unsafeName': '不安全的 MCP 名称：{name}',
  'mcp.sameNameExistsReplace': '收藏夹已存在同名 MCP：{name}；请确认后使用 --replace',
  'mcp.missingInCollection': '收藏夹中不存在 MCP：{name}',
  'mcp.unknownAgent': '未知 Agent：{name}',
  'mcp.notWritable': '无法写入 Agent {name} 的 MCP 配置',
  'mcp.borrowedNotMutable': '不能从借来的位置改源配置：{name}',
  'mcp.probeUnsupported': '只有 http 传输支持试探：{name}',
  'mcp.specifyNames': '请指定 MCP 名称',
  'mcp.useYesToConfirm': '请使用 --yes 确认',
  'mcp.noEntries': '没有可导入的 MCP 配置',
  'mcp.useAllOrInteractive': '请使用 --all 或交互选择要导入的 MCP',
  'mcp.selectImport': '选择要导入的 MCP',
  'mcp.importConfirm': '导入 {count} 条到收藏夹？',
  'mcp.replaceConfirm': '替换同名收藏 {name} 吗？',
  'mcp.importFromJson': '从 JSON 导入',
  'mcp.jsonSourcePrompt': 'JSON 文件路径，或 JSON：',
  'mcp.jsonInvalid': '无法解析为 MCP JSON',
  'mcp.jsonNoServers': 'JSON 里没有可识别的 MCP',
  'mcp.jsonReviewTitle': '从 JSON 导入',
  'mcp.jsonSecretKeys': '覆盖层：{keys}',
  'mcp.jsonSecretPlaceholders': '密钥键：{keys}',
  'mcp.jsonConflict': '同名冲突',
  'mcp.jsonCollectedAs': '已收藏为 {name}',
  'mcp.jsonUnchanged': '已收藏（同一端点）',
  'mcp.jsonNoneSelectable': '没有可导入的 MCP',
  'mcp.createNeedsFields': '创建 MCP 需要传输和启动方式',
  'mcp.ttyRequired': 'MCP 界面需要 stdin 和 stdout TTY；当前终端不支持。',
  'cli.unknownMcpCommand': '未知 mcp 子命令：{command}',
  'mcp.namePrompt': 'MCP 名称：',
  'mcp.transportPrompt': '传输',
  'mcp.commandPrompt': '命令（含参数）',
  'mcp.urlPrompt': 'URL',
  'mcp.keysPrompt': '密钥键名（可选，逗号分隔）',
  'mcp.created': '已创建 MCP：{name}',
  'mcp.alreadyCollectedAs': '已收藏为 {name}，未重复导入。',
  'mcp.importedCount': '已导入 {count} 条 MCP。',
  'mcp.selectAdd': '选择要安装的 MCP',
  'mcp.selectAgents': '选择目标 Agent',
  'mcp.addConfirm': '安装 {count} 条 MCP？',
  'mcp.addedCount': '已安装 {count} 处。',
  'mcp.noWritableAgents': '没有可写入的 Agent',
  'mcp.installTitle': '安装 MCP',
  'mcp.targetsTab': '目标 Agent',
  'mcp.mcpLine': 'MCP：{names}',
  'mcp.targetsLine': '目标 Agent：{value}',
  'mcp.borrowedMark': '↪',
  'mcp.fromSource': '来自 {source}',
  'mcp.toggle': '开关',
  'mcp.login': '登录',
  'mcp.signedIn': '已登录',
  'mcp.signedOut': '未登录',
  'mcp.secrets': '密钥',
  'mcp.secretsSet': '已填写',
  'mcp.secretsUnset': '未填写',
  'mcp.secretsSaved': '已保存密钥',
  'mcp.secretsTitle': '填写密钥',
  'mcp.secretKeyStep': '键名',
  'mcp.secretValueStep': '值',
  'mcp.accessTokenPrompt': 'Access token（Bearer）：',
  'mcp.rename': '改名',
  'mcp.enabled': '启用',
  'mcp.disabled': '停用',
  'mcp.owned': '自有',
  'mcp.borrowed': '借来',
  'mcp.transport': '传输',
  'mcp.endpoint': '端点',
  'mcp.nativeKey': '位置键',
  'mcp.probe': '试探',
  'mcp.probeReachable': '可达',
  'mcp.probeNeedsAuth': '要认证',
  'mcp.probeFailed': '失败',
  'mcp.emptyCollection': '收藏夹还没有 MCP',
  'mcp.emptyLocations': '这里没有 MCP 配置',
  'mcp.selectToView': '选择 MCP 查看',
  'mcp.deleteCollectionConfirm': '从收藏夹移除 {name}？已装位置会保留。',
  'mcp.deleteLocationConfirm': '从 {agent} 删除 {name}？',
  'mcp.updateDriftConfirm': '{agent} 上的 {name} 与收藏夹不一致，覆盖吗？',
  'mcp.tokenPrompt': '密钥（如 Bearer token）',
  'mcp.headerPrompt': 'Header 名',
  'mcp.loginSaved': '已保存登录凭证',
  'mcp.renamed': '已改名为 {name}',
  'mcp.helpNavMove': '换层，或在列表 / 标签列移动',
  'mcp.helpNavTab': '在主 Tab、Agent、标签列内移动',
  'mcp.helpNavAgent': '切换 Agent（任意层）',
  'mcp.helpNavFilter': '筛选',
  'mcp.helpNavDetail': '收藏夹：进入详情列改名、登录或填密钥',
  'mcp.helpSelectToggle': '切换选中',
  'mcp.helpSelectEnter': '收藏夹：安装当前项或已选（先选当前项目/全局和 Agent）',
  'mcp.helpCollectImport': '从项目 / 全局导入当前项或已选',
  'mcp.helpMore': '更多操作（从 JSON 导入）',
  'mcp.helpProbe': '试探 HTTP 端点',
  'config.mcpSecretsTitle': 'MCP 密钥进 Git',
  'config.mcpSecretsYes': '是',
  'config.mcpSecretsNo': '否（默认）',

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
  'cmd.replaceTargetsConfirm': '以下 {count} 个目标已存在，全部替换吗？',
  'cmd.targetExistsReplace': '目标已存在：{target}，请确认后使用 --replace',
  'cmd.crossAgentUnsupported': '无法跨 Agent 安装「{name}」（{path}）：仅支持收藏夹引用或实体目录',
  'cmd.crossAgentAmbiguousSource':
    '多个不同来源的「{name}」会安装到同一目标：{target}',
  'cmd.noOtherAgentTargets': '没有路径不同的其他 Agent 可安装',
  'cmd.selectInstallAgents': '安装到其他 Agent：',
  'domain.installRollbackFailed': '安装失败：{target}；错误：{error}；回滚失败：{rollback}。恢复材料：{backup}',
  'domain.installCleanupFailed': '已安装：{target}；清理失败：{error}。保留材料：{backup}',
  'cmd.installBatchFailed': '安装失败：{failed}；{error}\n已成功：{completed}\n未执行：{pending}\n已跳过：{skipped}',
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
  'footer.healthCount': '⚠ {count}',
  'footer.errorTitle': '错误',

  // ── health ──────────────────────────────────────────────────────────────
  'health.gitRebase': '收藏夹 Git rebase 未完成',
  'health.gitRebaseDetail': '在收藏夹目录完成或 abort rebase 后重试',
  'health.gitMerge': '收藏夹 Git merge 未完成',
  'health.gitMergeDetail': '在收藏夹目录完成或 abort merge 后重试',
  'health.gitDiverged': '收藏夹与 origin/{branch} 分叉',
  'health.gitDivergedDetail': '可按 s 同步；若仍失败请在收藏夹目录用 Git 处理',
  'health.sourceConflict': '技能 {skill} 更新待解决',
  'health.sourceConflictDetail': '解决冲突工作区后重新进入应用或等待启动收尾',
  'health.repairIntro':
    '把下列 iskills 收藏夹问题处理到完成标准。来源更新冲突只在冲突工作区里做 Git 合并；工作区干净后由 iskills 写入正在使用的技能，无需手工拷贝。',
  'health.repairCollection': '收藏夹目录：{root}',
  'health.repairSourceTitle': '技能 {skill}：来源更新冲突',
  'health.repairSourceWorkspace': '在冲突工作区完成三方 Git 合并：{path}',
  'health.repairSourceLive': '正在使用的技能目录由 iskills 在工作区干净后写入：{path}',
  'health.repairSourceShape':
    '冲突工作区是独立 Git 仓库：当前检出为收藏夹里的本地树，remote 分支是上游更新，base 是上次收藏基线。把 remote 合并进当前分支。',
  'health.repairSourceIncoming': '即将合并的来源：{source}',
  'health.repairSourceUnmerged': '当前未合并文件：',
  'health.repairSourceDone':
    '完成标准：在冲突工作区执行 git diff --name-only --diff-filter=U 与 git status --porcelain 均为空，且 git rev-parse MERGE_HEAD 失败（没有进行中的 merge）。然后 git commit 结束合并。之后重新打开 iskills 或等待启动收尾。',
  'health.repairGitRebaseDone':
    '在收藏夹目录完成 rebase（解决后 git rebase --continue）或 git rebase --abort：{root}',
  'health.repairGitMergeDone':
    '在收藏夹目录完成 merge（解决后 git commit）或 git merge --abort：{root}',
  'health.repairGitDivergedDone':
    '优先在 iskills 主界面按 s 同步。若仍失败，在收藏夹目录用 Git 处理与 origin 的分叉：{root}',

  // ── browser ─────────────────────────────────────────────────────────────
  'browser.healthTitle': '告警',
  'browser.healthEmpty': '当前无告警',
  'browser.moreActionsTitle': ' 更多操作 ',
  'browser.moreActionsFooter': 'Enter 执行 · Esc 返回',
  'browser.localSkill': '本地 · {name}',
  'browser.inCollection': '已在收藏夹',
  'browser.notInCollection': '未收藏',
  'browser.selectSkillToView': '选择技能查看',
  'browser.copyPath': '复制路径',
  'browser.pathCopied': '已复制路径',
  'browser.copyPathFailed': '复制路径失败',
  'browser.unbindSource': '解绑来源',
  'browser.unbindSourceTitle': '解绑来源',
  'browser.unbindSourceConfirm':
    '解绑 {name} 的来源后，将不再检测该仓库更新。技能仍留在收藏夹。',
  'browser.unbindSourceDone': '已解绑来源',
  'browser.copyForAgent': '复制给 Agent',
  'browser.copyForAgentCopied': '已复制，可贴给其他 Agent',
  'browser.copyForAgentFailed': '复制给 Agent 失败',
  'browser.selectedSkills': '已选择 {count} 个技能',
  'browser.skillLine': '技能：{names}',
  'browser.importCollectionTitle': '加入收藏夹',
  'browser.importCollectionOne': '将 {name} 加入收藏夹吗？',
  'browser.importCollectionMany': '将 {count} 个技能加入收藏夹吗？',
  'browser.removeCollectionTitle': '删除收藏',
  'browser.removeCollectionOne': '从收藏夹移除 {name} 吗？',
  'browser.removeCollectionMany': '从收藏夹移除 {count} 个技能吗？',
  'browser.adoptMissingTitle': '收编不完整技能',
  'browser.adoptMissingMessage':
    '发现 {count} 个技能目录缺少收藏元数据（可能是手动放入 skills/）。收编将写入默认元数据（来源未知），不猜测 Git/本地来源。',
  'browser.adoptedCount': '已收编 {count} 个技能',
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
  'browser.materializeAction': '引用转副本',
  'browser.installToAgentsAction': '安装到其他 Agent',
  'browser.shortcutHelpTitle': ' 完整快捷键 ',
  'browser.shortcutHelpFooterScroll':
    '↑/↓/滚轮 移动 · e/Space 展开/收起 · ← 收起 · Esc 关闭  {range}',
  'browser.shortcutHelpFooter': '↑/↓/滚轮 移动 · e/Space 展开/收起 · ← 收起 · Esc 关闭',
  'browser.helpNav': '导航',
  'browser.helpNavMove': '移动焦点或列表项',
  'browser.helpNavTab': '切换当前层级 Tab',
  'browser.helpNavDetail': '收藏夹：窄屏打开详情（↑/↓ 切换可编辑字段）；三栏进入详情列（项目/全局右栏仅预览）',
  'browser.helpNavFilter': '筛选技能',
  'browser.helpNavGroup': '跳转到标签列 / 分组（有标签时）',
  'browser.helpSelect': '选择',
  'browser.helpSelectToggle': '切换选中（标签列：该标签下全部）；点击列表仅聚焦，不切换多选',
  'browser.helpSelectEnter':
    '收藏夹有已选则添加；无已选：窄屏打开详情，三栏进入详情列（项目/全局三栏右栏仅预览，窄屏 Enter 查看）',
  'browser.helpCollect': '收藏与安装',
  'browser.helpCollectImport': '加入收藏夹（项目 / 全局已选本地技能）',
  'browser.helpCollectSource': '从 GitHub 来源进入仓库并导入',
  'browser.helpMaintain': '维护',
  'browser.helpMaintainTag': '批量加标签（收藏夹已选）',
  'browser.helpMaintainUpdate': '更新：已选可更新者，否则当前项',
  'browser.helpMaintainMore': '更多 · 引用转副本 / 安装到其他 Agent',
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

  // ── extra UI copy ─────────────────────────────────────────────────────
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
