const notifications = {
  themeChanged: 'Theme: {theme}',
  localeChanged: 'Language: {language}',
  layoutChanged: 'Project layout: {layout}',
  settingsReset: 'Settings reset to defaults.',
  extensions: {
    manifestInvalid: 'Extension {id} failed to load: invalid manifest — {detail}',
    engineIncompatible: 'Extension {id} needs a compatible Grafalith version — skipped',
    archiveNoManifest: 'Extension skipped: no manifest found in the .grlt archive',
    archiveManifestInvalid: 'Extension archive failed to load: invalid manifest — {detail}',
    entryMissing: 'Extension {id}: entry point file not found',
    invalidEntry: 'Extension {id}: activate() is missing or not a function',
    activationFailed: 'Extension {id} failed during activation: {message}',
    activationTimeout: 'Extension {id} timed out during activation — disabled',
    permissionDenied: 'Extension {id} tried to use an undeclared permission — access denied',
    missingDependency: 'Extension {id} skipped: dependency {dependency} is not installed',
    blockedDependency: 'Extension {id} skipped because dependency {dependency} failed',
    circularDependency: 'Circular dependency detected: {cycle}. These extensions were skipped',
    dependencyIncompatible: 'Extension {id} skipped: dependency {dependency} is incompatible',
    contributionsSkipped: 'Extension {id}: {count} invalid contributions skipped, the rest stay active',
    disabled: 'Extension {id} disabled',
    reloaded: 'Extension {id} reloaded',
    uninstalled: 'Extension {id} uninstalled',
    reloadFailed: 'Extension {id} reload failed — staying disabled until it succeeds',
    toolFailed: 'Extension tool failed: {title} — {reason}',
  },
};

export default notifications;
