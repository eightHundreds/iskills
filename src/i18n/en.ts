import type { zh } from './zh.js';

/** English catalog — must share the same keys as {@link zh}. */
export const en: { readonly [K in keyof typeof zh]: string } = {
  // ── common ──────────────────────────────────────────────────────────────
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.clear': 'Clear',
  'common.none': 'None',
  'common.noneIndented': '  None',
  'common.help': 'Help',
  'common.quit': 'Quit',
  'common.filter': 'Filter',
  'common.filterLabel': 'Filter: ',
  'common.switch': 'Switch',
  'common.enter': 'Enter',
  'common.back': 'Back',
  'common.move': 'Move',
  'common.edit': 'Edit',
  'common.list': 'List',
  'common.select': 'Select',
  'common.delete': 'Delete',
  'common.add': 'Add',
  'common.detail': 'Detail',
  'common.view': 'View',
  'common.collect': 'Collect',
  'common.openSource': 'Opening source',
  'common.more': 'More',
  'common.tags': 'Tags',
  'common.jumpTag': 'Jump',
  'common.sync': 'Sync',
  'common.update': 'Update',
  'common.materialize': 'To copy',
  'common.expand': 'Expand',
  'common.local': 'Local',
  'common.git': 'Git',
  'common.unknown': 'Unknown',
  'common.skill': 'Skill',
  'common.copy': 'Copy',
  'common.symlink': 'Symlink',
  'common.project': 'Project',
  'common.global': 'Global',
  'common.origin': 'Origin',
  'common.usage': 'Usage',
  'common.dependent': 'Dependent',
  'common.originIndented': '  Origin',
  'common.usageIndented': '  Usage',
  'common.dependentIndented': '  Dependent',
  'common.noDescription': 'No description',
  'common.interrupted': 'Operation interrupted',
  'common.failed': 'Failed: {error}',
  'common.version': 'Version',
  'common.source': 'Source',
  'common.note': 'Note',
  'common.description': 'Description',
  'common.location': 'Location',
  'common.path': 'Path',
  'common.collectionStatus': 'Collection status',
  'common.reference': 'Reference',
  'common.relatedLocations': 'Related locations',
  'common.all': 'All',
  'common.untagged': 'Untagged',
  'common.listSep': ', ',
  'common.itemJoin': '; ',

  // ── collection match ────────────────────────────────────────────────────
  'match.sameSource': 'Collected (same source)',
  'match.conflictingSource': 'Name conflict (different source)',
  'match.unverifiedSource': 'Same name (source unverified)',

  // ── CLI / help ──────────────────────────────────────────────────────────
  'cli.unknownCommand': 'Unknown command: {command}',
  'cli.errorPrefix': 'Error: {message}',
  'cli.logWritten': 'Complete log: {path}',
  'cli.bunStartFailed': 'Failed to start Bun runtime: {message}',
  'cli.mainTtyRequired':
    'The main TUI requires a TTY for stdin and stdout; this terminal is not supported.',
  'cli.configTtyRequired':
    'The config UI requires a TTY for stdin and stdout; this terminal is not supported.',
  'cli.pendingConflicts': 'Warning: {count} pending conflict(s).',
  'cli.searchTtyRequired':
    'Standalone search TUI requires a TTY for stdin and stdout; this terminal is not supported.',
  'help.search': `Usage:
  iskills search [query]

Search skills.sh live and save selections into your collection.

Options:
  --replace          Replace same-name collection entry from a different source
  -h, --help         Show help
`,
  'help.add': `Usage:
  iskills add [skills...] [options]

Add skills from your collection to the current project or agent global dirs.

Options:
  --agent <name>     Limit to agent(s); repeatable ({agents})
  -g, --global       Add to agent global skill directories
  --to <dir>         Target directory
  --copy             Copy instead of symlink
  --replace          Replace existing skills
  -y, --yes          Skip confirmation
  -h, --help         Show help
`,
  'help.create': `Usage:
  iskills create [name]

Create a new skill in the collection and open its directory.

Options:
  -h, --help         Show help
`,
  'help.import': `Usage:
  iskills import [path or Git URL] [options]

Import a local path or Git source into your collection.

Options:
  -g, --global       Scan agent global skill directories
  --agent <name>     Limit to agent(s); repeatable ({agents})
  --all              Import every discovered skill
  --replace          Replace same-name skills in the collection
  -y, --yes          Skip confirmation
  -h, --help         Show help
`,
  'help.init': `Usage:
  iskills init [options]

Initialize the collection Git repository and create the first commit.

Options:
  --remote <Git URL>  Set or update origin
  -h, --help         Show help
`,
  'help.config': `Usage:
  iskills config

Open the config UI to set UI language and the collection Git remote.

Options:
  -h, --help         Show help
`,
  'help.mcp': `Usage:
  iskills mcp
  iskills mcp create [name]
  iskills mcp import [options]
  iskills mcp add [names...] [options]

Manage the MCP config collection. With no subcommand, opens the project / global / collection browser.

create options:
  --transport <stdio|http|sse>  Transport
  --command <cmd>               stdio command
  --url <URL>                   http/sse URL
  --args <arg>                  Repeatable

import / add options:
  -g, --global       Global location (default: current project)
  --agent <name>     Limit to agent(s); repeatable
  --all              Import every discovered entry
  --replace          Replace same-name collection entry
  -y, --yes          Skip confirmation
  -h, --help         Show help
`,
  'help.root': `Skill collection

Usage:
  iskills [command] [options]

Commands:
  search [query]     Search skills and save into the collection
  add [skills...]    Add from collection to the current project
  create [name]      Create a new skill in the collection and open it
  import [source]    Import a local path or Git source
  init               Initialize collection Git
  config             Open config UI (UI language, Git remote, MCP secrets)
  mcp                MCP config collection

Options:
  -h, --help         Show help (or: iskills help <command>)
  -v, --version      Show version

`,
  'config.localeTitle': 'UI language',
  'config.localeSystem': 'Follow system',
  'config.localeZh': '中文',
  'config.localeEn': 'English',
  'config.remoteTitle': 'Collection remote',
  'config.remoteUnset': 'Not set',
  'config.settingsTitle': ' Settings ',
  'config.settingsFooter': '←→ change · Esc close',
  'config.changeValue': 'Change',
  'config.editValue': 'Edit',

  // ── domain core ─────────────────────────────────────────────────────────
  'domain.unsafeSkillName': 'Unsafe skill name: {name}',
  'domain.unsafeSourcePath': 'Unsafe source subpath: {path}',
  'domain.symlinkEscapesTree': 'Skill contains a symlink that escapes its tree: {path}',
  'domain.skillExistsInCollection': 'Skill already exists in collection: {name}',
  'domain.gitCommitFailed': 'Warning: collection Git commit failed: {error}',
  'domain.originNotCollectionLink':
    'Origin is no longer a symlink into the collection; aborted: {path}',
  'domain.importFailedRollback': 'Import failed: {error}; rollback failed: {rollback}',
  'domain.warnConflictCleanup': 'Warning: failed to clean old conflict directory: {error}',
  'domain.warnReplaceBackupCleanup': 'Warning: failed to clean replace backup: {error}',
  'domain.warnOriginNotRestored':
    'Warning: origin is no longer a symlink into the collection; left unchanged: {path}',
  'domain.noUsageInScope': 'No usage of skill in current scope: {name}',
  'domain.usageNotExpectedLink':
    'Usage path is not the expected symlink; not deleted: {path}',
  'domain.notInCollection': 'Not in collection: {name}',
  'domain.removeNeedsConfirm': 'Removing from collection requires confirmation',
  'domain.removedWithRestore': 'Removed {name} from collection and restored {path}.',
  'domain.removed': 'Removed {name} from collection.',
  'domain.cyclicSymlink': 'Skill contains a cyclic symlink: {path}',
  'domain.unresolvableSymlink': 'Skill contains an unresolvable symlink: {path}',
  'domain.symlinkOutside': 'Skill contains a symlink pointing outside its tree: {path}',
  'domain.copyStillHasSymlink': 'Copy still contains a symlink: {path}',
  'domain.cannotOpCollectionByPath':
    'Cannot {operation} collection content by location: {path}',
  'domain.locationGone': 'Skill location no longer exists: {path}',
  'domain.locationChangedNotDeleted': 'Skill location changed; not deleted: {path}',
  'domain.locationChanged': 'Skill location changed: {path}',
  'domain.notAReference': 'Skill location is not a reference: {path}',
  'domain.referenceUnresolvable': 'Skill reference could not be resolved: {path}',
  'domain.referenceNotDir': 'Skill reference target is not a directory: {path}',
  'domain.copyNameChanged': 'Copied skill name changed: {path}',
  'domain.materializeFailedRollbackItem':
    'Convert to copy failed: {error}; rollback failed: {path}: {rollback}',
  'domain.stateRollback': 'State: {error}',
  'domain.materializeFailedRollback':
    'Convert to copy failed: {error}; rollback failed: {rollback}',
  'domain.warnMaterializeTempCleanup':
    'Warning: failed to clean convert-to-copy temp directory: {error}',
  'domain.collectionLinkChanged': 'Collection link changed; not deleted: {path}',
  'domain.mergeNotValidSkill': 'Merge result is not a valid skill: {name}',
  'domain.opDelete': 'delete',
  'domain.opMaterialize': 'convert to copy',
  'mcp.unsafeName': 'Unsafe MCP name: {name}',
  'mcp.sameNameExistsReplace':
    'Collection already has MCP {name}; confirm and use --replace',
  'mcp.missingInCollection': 'MCP not in collection: {name}',
  'mcp.unknownAgent': 'Unknown agent: {name}',
  'mcp.notWritable': 'Cannot write MCP config for agent {name}',
  'mcp.borrowedNotMutable': 'Cannot change source config from a borrowed row: {name}',
  'mcp.probeUnsupported': 'Only http transport can be probed: {name}',
  'mcp.specifyNames': 'Specify an MCP name',
  'mcp.useYesToConfirm': 'Use --yes to confirm',
  'mcp.noEntries': 'No importable MCP configs',
  'mcp.useAllOrInteractive': 'Use --all or choose MCPs interactively',
  'mcp.selectImport': 'Select MCPs to import',
  'mcp.importConfirm': 'Import {count} into the collection?',
  'mcp.replaceConfirm': 'Replace collection MCP {name}?',
  'mcp.importFromJson': 'Import from JSON',
  'mcp.jsonSourcePrompt': 'JSON file path, or JSON:',
  'mcp.jsonInvalid': 'Not valid MCP JSON',
  'mcp.jsonNoServers': 'No recognizable MCP in the JSON',
  'mcp.jsonReviewTitle': 'Import from JSON',
  'mcp.jsonSecretKeys': 'Overlay: {keys}',
  'mcp.jsonSecretPlaceholders': 'Secret keys: {keys}',
  'mcp.jsonConflict': 'Name conflict',
  'mcp.jsonCollectedAs': 'Already collected as {name}',
  'mcp.jsonUnchanged': 'Already collected (same endpoint)',
  'mcp.jsonNoneSelectable': 'No MCP to import',
  'mcp.createNeedsFields': 'Creating an MCP requires a transport and launch details',
  'mcp.ttyRequired': 'The MCP UI needs stdin and stdout TTYs; this terminal cannot.',
  'cli.unknownMcpCommand': 'Unknown mcp subcommand: {command}',
  'mcp.namePrompt': 'MCP name:',
  'mcp.transportPrompt': 'Transport',
  'mcp.commandPrompt': 'Command (with args)',
  'mcp.urlPrompt': 'URL',
  'mcp.keysPrompt': 'Secret key names (optional, comma-separated)',
  'mcp.created': 'Created MCP: {name}',
  'mcp.alreadyCollectedAs': 'Already collected as {name}; skipped.',
  'mcp.importedCount': 'Imported {count} MCP(s).',
  'mcp.selectAdd': 'Select MCPs to install',
  'mcp.selectAgents': 'Select target agents',
  'mcp.addConfirm': 'Install {count} MCP(s)?',
  'mcp.addedCount': 'Installed at {count} location(s).',
  'mcp.noWritableAgents': 'No writable agents',
  'mcp.installTitle': 'Install MCP',
  'mcp.targetsTab': 'Target agents',
  'mcp.mcpLine': 'MCP: {names}',
  'mcp.targetsLine': 'Target agents: {value}',
  'mcp.borrowedMark': '↪',
  'mcp.fromSource': 'From {source}',
  'mcp.toggle': 'Toggle',
  'mcp.login': 'Sign in',
  'mcp.signedIn': 'Signed in',
  'mcp.signedOut': 'Not signed in',
  'mcp.secrets': 'Secrets',
  'mcp.secretsSet': 'Set',
  'mcp.secretsUnset': 'Not set',
  'mcp.secretsSaved': 'Saved secrets',
  'mcp.secretsTitle': 'Fill secrets',
  'mcp.secretKeyStep': 'Key',
  'mcp.secretValueStep': 'Value',
  'mcp.accessTokenPrompt': 'Access token (Bearer):',
  'mcp.rename': 'Rename',
  'mcp.enabled': 'On',
  'mcp.disabled': 'Off',
  'mcp.owned': 'Owned',
  'mcp.borrowed': 'Borrowed',
  'mcp.transport': 'Transport',
  'mcp.endpoint': 'Endpoint',
  'mcp.nativeKey': 'Location key',
  'mcp.probe': 'Probe',
  'mcp.probeReachable': 'reachable',
  'mcp.probeNeedsAuth': 'needs auth',
  'mcp.probeFailed': 'failed',
  'mcp.emptyCollection': 'No MCPs in the collection yet',
  'mcp.emptyLocations': 'No MCP configs here',
  'mcp.selectToView': 'Select an MCP to view',
  'mcp.deleteCollectionConfirm': 'Remove {name} from the collection? Installed locations stay.',
  'mcp.deleteLocationConfirm': 'Delete {name} from {agent}?',
  'mcp.updateDriftConfirm': '{name} on {agent} differs from the collection. Overwrite?',
  'mcp.tokenPrompt': 'Secret (e.g. Bearer token)',
  'mcp.headerPrompt': 'Header name',
  'mcp.loginSaved': 'Saved sign-in secret',
  'mcp.renamed': 'Renamed to {name}',
  'mcp.helpNavMove': 'Change layer, or move in the list / tag column',
  'mcp.helpNavTab': 'Move within the main tabs, agent row, or tag column',
  'mcp.helpNavAgent': 'Switch agent from any layer',
  'mcp.helpNavFilter': 'Filter',
  'mcp.helpNavDetail': 'Collection: enter the detail column to rename, sign in, or fill secrets',
  'mcp.helpSelectToggle': 'Toggle selection',
  'mcp.helpSelectEnter': 'Collection: install current or selected (choose project/global and agents first)',
  'mcp.helpCollectImport': 'Import current or selected from Project / Global',
  'mcp.helpMore': 'More actions (import from JSON)',
  'mcp.helpProbe': 'Probe HTTP endpoint',
  'config.mcpSecretsTitle': 'Put MCP secrets in Git',
  'config.mcpSecretsYes': 'Yes',
  'config.mcpSecretsNo': 'No (default)',

  // ── git ─────────────────────────────────────────────────────────────────
  'git.initFailed': 'Could not initialize collection Git: {error}',
  'git.remoteEmpty': 'Remote URL cannot be empty',
  'git.cloneFailed': 'Could not clone Git source: {error}',
  'git.conflictResolved': 'Collection Git conflict resolved.',
  'git.appliedManualUpdate': 'Applied manually resolved update: {skill}',
  'git.conflictWithOrigin':
    'Collection conflicts with origin; sync in the main TUI then resolve manually',
  'git.backgroundSyncFailed': 'Background collection sync failed: {error}',
  'git.branchMissing': 'Source branch does not exist: {ref}',
  'git.commitMissing': 'Previous sync commit not found in source history: {commit}',
  'git.upstreamDeletedNeedsConfirm':
    'Upstream deleted {name}; caller must confirm or explicitly allow removal',
  'git.missingBaseline':
    'Missing import baseline for first update; re-import or rebind the source',
  'git.notARepo': 'Collection is not a Git repository',
  'git.syncConflictManual':
    'Collection Git sync conflict; resolve manually with Git',
  'git.syncFailed': 'Collection Git sync failed: {error}',
  'git.initDone': 'Initialized collection Git.',
  'git.alreadyInit': 'Collection Git already initialized.',
  'git.configureRemotePrompt': 'Configure a remote repository?',
  'git.remoteAddressPrompt': 'Remote repository URL:',
  'git.remoteConfigured': 'Configured remote origin.',

  // ── commands / library ──────────────────────────────────────────────────
  'cmd.sameNameExistsReplace':
    'Collection already has skill {name}; confirm and use --replace',
  'cmd.oneSkillNameOnly': 'Only one skill name is allowed',
  'cmd.skillNamePrompt': 'Skill name:',
  'cmd.createdSkill': 'Created skill: {name}',
  'cmd.warnOpenPathFailed': 'Warning: could not open directory: {error}',
  'cmd.skillMissingInSource': 'Skill not found in source repository: {name}',
  'cmd.skillDuplicateInSource':
    'Multiple skills with the same name in source repository: {name}',
  'cmd.conflictingSourceExists':
    'Collection already has skill {name} from a different source; use --replace',
  'cmd.unverifiedSourceExists':
    'Collection already has skill {name} (source unverified); confirm and use --replace',
  'cmd.conflictsExistReplace':
    'Already in collection: {names}; confirm and use --replace',
  'cmd.replaceSameNameConfirm': 'Replace same-name collection entries {names}?',
  'cmd.importedCount': 'Imported {count} skill(s).',
  'cmd.unknownAgent': 'Unknown agent: {name}',
  'cmd.noPresentAgents':
    'No installed agent root detected; pass --agent to specify one',
  'cmd.agentDisplayAgents': 'Standard Agent Skills',
  'cmd.cannotSourceAndGlobal': 'Cannot specify both a source and -g',
  'cmd.oneImportRootOnly': 'Only one import root is allowed',
  'cmd.noSkillMd': 'No SKILL.md found',
  'cmd.useAllOrInteractive': 'Use --all or choose skills interactively',
  'cmd.scanGlobalSkills': 'Scan global skill directories',
  'cmd.selectRepoSkills': 'Select skills in this repository',
  'cmd.foundSkills': 'Skills found',
  'cmd.useYesToConfirmImport': 'Use --yes to confirm import',
  'cmd.globalNeedsAgent': 'Specify --agent when adding to global directories',
  'cmd.selectGlobalAgent': 'Select global agent directories:',
  'cmd.agentGlobalOnly':
    'Agent {name} only supports global skill directories; use --global',
  'cmd.multipleAgentDirs': 'Multiple agent directories detected:',
  'cmd.missingInCollection': 'Not in collection: {names}',
  'cmd.specifySkillNames': 'Specify skill name(s)',
  'cmd.scanCurrentDir': 'Scan current directory',
  'cmd.scanGlobalAgents': 'Scan common global agent directories',
  'cmd.enterPathOrGit': 'Enter a local path or Git source',
  'cmd.emptyCollectionImportWhere':
    'Collection is empty. Where should skills be imported from?',
  'cmd.pathOrGitPrompt': 'Path or Git source:',
  'cmd.searchCollection': 'Search collection:',
  'cmd.selectSkills': 'Select skills:',
  'cmd.targetPointsSelf': 'Target would point at the skill itself: {target}',
  'cmd.replaceTargetConfirm': 'Target already exists. Replace {target}?',
  'cmd.replaceTargetsConfirm':
    'The following {count} target(s) already exist. Replace all?',
  'cmd.targetExistsReplace':
    'Target already exists: {target}; confirm and use --replace',
  'cmd.crossAgentUnsupported':
    'Cannot install "{name}" across agents ({path}): only collection refs or real directories',
  'cmd.crossAgentAmbiguousSource':
    'Multiple different sources for "{name}" would install to the same target: {target}',
  'cmd.noOtherAgentTargets': 'No other agent with a different path to install to',
  'cmd.selectInstallAgents': 'Install to other agents:',
  'cmd.addedSkillsToDirs':
    'Added {skills} skill(s) to {dirs} directory(ies){copy}.',
  'cmd.addedCopySuffix': ' (copy)',
  'cmd.invalidGitSource': 'Not a valid Git source: {input}',
  'cmd.syncDone': 'Sync complete',
  'cmd.upstreamDeleted': 'Upstream deleted',
  'cmd.upstreamDeletedConfirm':
    'Upstream deleted {name}. Run collection removal?',
  'cmd.linkKindLine': '{kind}: {path}',
  'cmd.updateFailedLine': '{name}: update failed — {error}',
  'cmd.updatedCount': 'Updated {count}',
  'cmd.updatedWithFailed': 'Updated {updated}, failed {failed}',
  'cmd.addTagsForSkills': 'Add tags for {count} skill(s)',
  'cmd.tagged': 'Tags added',
  'cmd.replaceTargetTitle': 'Replace target',
  'cmd.addedCount': 'Added {count}',
  'cmd.removedOne': 'Removed {name}',
  'cmd.removedCount': 'Removed {count}',
  'cmd.deletedOne': 'Deleted {name}',
  'cmd.deletedCount': 'Deleted {count} location(s)',
  'cmd.materializedOne': 'Converted to a copy',
  'cmd.materializedCount': 'Converted {count} to copies',
  'cmd.replaceCollectionTitle': 'Replace collection entry',
  'cmd.importedShort': 'Imported {count}',
  'cmd.editNoteTitle': 'Edit note',
  'cmd.editNoteLabel': 'Note (Enter save, Esc cancel)',
  'cmd.editTags': 'Edit tags',
  'cmd.gitSourcePrompt': 'Git source (Enter continue, Esc cancel)',
  'cmd.refPrompt': 'Branch, tag, or commit (Enter continue, Esc cancel)',
  'cmd.noSkillMdInRepo': 'No SKILL.md found in target repository',
  'cmd.selectSkillInRepo': 'Select skill in repository:',
  'cmd.installAgentsProject': 'Standard Agent Skills (.agents/skills)',
  'cmd.installAgentsGlobal': 'Standard Agent Skills (~/.agents/skills)',
  'cmd.collected': 'Collected {name}.',
  'cmd.collectedSameSource':
    '{name} is already collected from the same source; update it in the main TUI.',
  'cmd.searchHttpFailed': 'Search failed (HTTP {status})',
  'cmd.searchInvalidPayload': 'Search service returned invalid data',
  'cmd.validatingCollect': 'Validating and collecting…',
  'cmd.replaceIdentityConfirm': 'Replace {name}: {from} → {to}?',
  'cmd.collectFailed': 'Collect failed: {error}',
  'cmd.retryCollect': 'Retry collect?',

  // ── footer ──────────────────────────────────────────────────────────────
  'footer.updateWithCount': 'Update({count})',
  'footer.selectedCount': 'Selected {count}',
  'footer.working': '{action}{progress}',
  'footer.workingProgress': ' {current}/{total}',
  'footer.checkFailed': '{count} check(s) failed',
  'footer.checkingUpdates': 'Checking for updates',
  'footer.healthCount': '⚠ {count}',
  'footer.errorTitle': 'Error',

  // ── health ──────────────────────────────────────────────────────────────
  'health.gitRebase': 'Collection Git rebase in progress',
  'health.gitRebaseDetail': 'Finish or abort the rebase in the collection directory, then retry',
  'health.gitMerge': 'Collection Git merge in progress',
  'health.gitMergeDetail': 'Finish or abort the merge in the collection directory, then retry',
  'health.gitDiverged': 'Collection diverged from origin/{branch}',
  'health.gitDivergedDetail': 'Press s to sync; if it still fails, resolve with Git in the collection directory',
  'health.sourceConflict': 'Skill update pending: {skill}',
  'health.sourceConflictDetail': 'Resolve the conflict workspace, then reopen the app or wait for startup finalize',

  // ── browser ─────────────────────────────────────────────────────────────
  'browser.healthTitle': 'Alerts',
  'browser.healthEmpty': 'No alerts',
  'browser.moreActionsTitle': ' More actions ',
  'browser.moreActionsFooter': 'Enter run · Esc back',
  'browser.localSkill': 'Local · {name}',
  'browser.inCollection': 'In collection',
  'browser.notInCollection': 'Not collected',
  'browser.selectSkillToView': 'Select a skill to view',
  'browser.copyPath': 'Copy path',
  'browser.pathCopied': 'Path copied',
  'browser.copyPathFailed': 'Failed to copy path',
  'browser.selectedSkills': 'Selected {count} skill(s)',
  'browser.skillLine': 'Skill: {names}',
  'browser.importCollectionTitle': 'Add to collection',
  'browser.importCollectionOne': 'Add {name} to the collection?',
  'browser.importCollectionMany': 'Add {count} skills to the collection?',
  'browser.removeCollectionTitle': 'Remove from collection',
  'browser.removeCollectionOne': 'Remove {name} from the collection?',
  'browser.removeCollectionMany': 'Remove {count} skills from the collection?',
  'browser.adoptMissingTitle': 'Adopt incomplete skills',
  'browser.adoptMissingMessage':
    'Found {count} skill folder(s) missing collection metadata (often dropped into skills/). Adopt writes default metadata (unknown source); does not invent Git/local provenance.',
  'browser.adoptedCount': 'Adopted {count} skill(s)',
  'browser.removeLocationsTitle': 'Delete skills',
  'browser.removeLocationOne': 'Delete the current location of {name}?',
  'browser.removeLocationsMany': 'Delete the {count} selected skill locations?',
  'browser.removeLocationsHint':
    'These locations will be permanently deleted; collection content (if any) is kept.',
  'browser.tabProject': 'Project {count}',
  'browser.tabGlobal': 'Global {count}',
  'browser.tabCollection': 'Collection {count}',
  'browser.jumpToGroup': 'Jump to tag:',
  'browser.detailFooterScroll': '↑/↓ scroll · ',
  'browser.detailFooterCollection': 'n note · t tags · s source · Esc back',
  'browser.detailFooterEsc': 'Esc back',
  'browser.noMatchingSkills': 'No matching skills',
  'browser.referenceName': 'Reference · {name}',
  'browser.referencePrefix': 'Reference · ',
  'browser.spaceSelect': 'Space select',
  'browser.enterViewSpaceSelect': 'Enter view · Space select',
  'browser.materializeAction': 'Convert reference to copy',
  'browser.installToAgentsAction': 'Install to other agents',
  'browser.shortcutHelpTitle': ' All shortcuts ',
  'browser.shortcutHelpFooterScroll':
    '↑/↓/wheel move · e/Space expand/collapse · ← collapse · Esc close  {range}',
  'browser.shortcutHelpFooter':
    '↑/↓/wheel move · e/Space expand/collapse · ← collapse · Esc close',
  'browser.helpNav': 'Navigation',
  'browser.helpNavMove': 'Move focus or list item',
  'browser.helpNavTab': 'Switch tab at current level',
  'browser.helpNavDetail':
    'Collection: open detail on narrow screens; enter detail column in three-pane (project/global right column is preview only)',
  'browser.helpNavFilter': 'Filter skills',
  'browser.helpNavGroup': 'Jump to tag column / groups (when tags exist)',
  'browser.helpSelect': 'Selection',
  'browser.helpSelectToggle':
    'Toggle selection (tag column: all under that tag); list click focuses only, does not multi-select',
  'browser.helpSelectEnter':
    'Collection with selection: add. No selection: open detail (narrow) or focus detail column (three-pane). Project/global three-pane is preview-only; narrow Enter views fullscreen',
  'browser.helpCollect': 'Collect & install',
  'browser.helpCollectImport':
    'Add to collection (project / global selected local skills)',
  'browser.helpCollectSource': 'Open a GitHub source and import skills',
  'browser.helpMaintain': 'Maintain',
  'browser.helpMaintainTag': 'Batch tag (selected in collection)',
  'browser.helpMaintainUpdate':
    'Update: selected updatable skills, else current item',
  'browser.helpMaintainMore':
    'More · convert reference to copy / install to other agents',
  'browser.helpMaintainSync': 'Sync collection Git (when available)',
  'browser.helpMaintainDelete':
    'Delete selected; if none selected, delete current item',
  'browser.helpGlobal': 'Global',
  'browser.helpGlobalHelp': 'Open this help',
  'browser.helpGlobalQuit': 'Quit browser',
  'browser.helpGlobalEsc': 'Cancel innermost context',

  // ── components ──────────────────────────────────────────────────────────
  'comp.scrollRange': '↑/↓/wheel scroll {from}–{to} / {total}',
  'comp.quickSelect': '1–{max} quick · ',
  'comp.newTagsComma': 'New tags (comma-separated)',

  // ── import UI ───────────────────────────────────────────────────────────
  'import.confirmTitle': 'Confirm import',
  'import.selectGroups': 'Select tags',
  'import.newGroupsComma': 'New tags (comma-separated)',
  'import.groupInputFooter':
    'Enter finish tags · Tab back to existing · Esc cancel',
  'import.groupListFooter':
    '↑/↓ move · Space select · Tab switch input · Enter finish tags · → confirm · Esc cancel',
  'import.fromAgentPath': 'From {agent} · {path}',
  'import.detailFooterScroll': '↑/↓ scroll · ',
  'import.detailFooter': 'Esc back · Space select · Enter confirm import',
  'import.selectSkillsTitle': 'Select skills',
  'import.selectSkillsHeader':
    '{label} · selected {selected} / total {total}',
  'import.skillListFooter':
    '↑/↓ move · Space select · → detail · a select all · Enter confirm · Esc cancel',
  'import.agentTabsFooter':
    '←/→ switch agent · ↓ back to skill list · Esc cancel',
  'import.skillListFooterAgent':
    '↑/↓ move · Space select · → detail · a select current · Enter confirm · Esc cancel',

  // ── install UI ──────────────────────────────────────────────────────────
  'install.location': 'Install location',
  'install.method': 'Install method',
  'install.targetDirs': 'Target directories',
  'install.nextStep': 'Enter next',
  'install.selectAtLeastOne': 'Select at least one directory',

  // ── search UI ───────────────────────────────────────────────────────────
  'search.title': 'Search skills',
  'search.retryFooter': 'Enter retry · Esc cancel',
  'search.cancelFooter': 'Esc cancel',
  'search.listFooter': '↑/↓ select · Enter collect · Esc cancel',
  'search.minChars': 'Type at least 2 characters to search',
  'search.searching': 'Searching…',
  'search.noResults': 'No skills found',

  // ── extra UI copy ─────────────────────────────────────────────────────
  'ui.loading': 'Loading…',
  'ui.multiSelectFooter': 'Space toggle · Enter confirm · Esc cancel',
  'ui.selectFooter': '↑/↓ select · Enter confirm · Esc cancel',
  'ui.selectedCount': 'Selected {count}',
  'ui.existingTags': 'Existing tags',
  'ui.noExistingTags': 'No existing tags',
  'ui.tagEditorFooter':
    '↑/↓ move · Space select · Tab switch · Enter save · Esc cancel',
  'import.selectedGroups': 'Selected tags: {tags}',
  'import.noExistingGroups': 'No existing tags',
  'import.willImport': 'Will import {count} skill(s); tags: ',
  'import.moreItems': '… and {count} more',
  'import.confirmFooter':
    'Enter confirm import · ← back to tags · n cancel · Esc cancel',
  'import.noSkillsForAgent': 'No importable skills for this agent',
  'install.locationStepFooter': '↑/↓ select · Enter next · Esc cancel',
  'install.symlinkRecommended': 'Symlink (recommended)',
  'install.methodStepFooter': '↑/↓ select · ← back · Enter next · Esc cancel',
  'install.targetsFooter':
    '↑/↓ move · Space select · ← back · {next} · Esc cancel',
  'install.skillLine': 'Skills: {names}',
  'install.locationLine': 'Install location: {value}',
  'install.methodLine': 'Install method: {value}',
  'install.targetsLine': 'Target directories: {value}',
  'install.confirmFooter':
    'Enter confirm install · ← back · n cancel · Esc cancel',
  'install.title': 'Install skills',
};
