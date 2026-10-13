// Manifest contribution registration: static `contributes` → runtime stores.
//
// Extensions declare UI in `grafalith.extension.json`; handlers are code
// (`activate()` registers commands), but every declarative surface lands
// here at install so palettes, menus, rails, docks, toolbars, and Home
// render extension rows without shell changes. One invalid entry skips
// alone (problem collected, host toasts); the package stays usable.
//
// Unregistration mirrors registration per package id so disable,
// uninstall, and editor-scope unload remove exactly their own rows.
import {
  registerExtensionEditorTools,
  registerExtensionMenuRows,
  registerExtensionViews,
  removeExtensionEditorTools,
  removeExtensionMenuRows,
  removeExtensionViews,
  type ExtensionMenuRow,
  type ExtensionViewContribution,
} from './extensionContributions';
import {
  registerHomeWidgets,
  registerProjectTemplates,
  removeHomeContributions,
} from './homeContributions';
import type { GrltContributes, GrltManifest } from './extensionManifest';
import type { MenuLocation } from '../../registries/menus';
import { menuLocations } from '../../registries/menus';

/** Raw declares kept per package for UI queries (themes, nodes, assets). */
const catalog = new Map<string, GrltContributes>();

/** Raw contributes of one package (diagram nodes, themes, asset providers). */
export function manifestCatalogFor(packageId: string): GrltContributes | undefined {
  return catalog.get(packageId);
}

/** Parse a manifest menu group (`"9_hello"` → 9, anything else → 9). */
function parseGroup(raw: string | undefined): number {
  if (!raw) return 9;
  const match = /^(\d+)/.exec(raw);
  return match ? Number(match[1]) : 9;
}

function menuRowsFor(packageId: string, contributes: GrltContributes): ExtensionMenuRow[] {
  const rows: ExtensionMenuRow[] = [];
  for (const [location, placements] of Object.entries(contributes.menus ?? {})) {
    if (!menuLocations().includes(location as MenuLocation)) continue;
    placements.forEach((placement, index) => {
      rows.push({
        location: location as MenuLocation,
        commandId: placement.command,
        group: parseGroup(placement.group),
        order: index,
        extensionId: packageId,
      });
    });
  }
  return rows;
}

function viewsFor(
  packageId: string,
  contributes: GrltContributes,
): ExtensionViewContribution[] {
  const views: ExtensionViewContribution[] = [];
  const sections: [keyof GrltContributes, ExtensionViewContribution['surface']][] = [
    ['views', 'view'],
    ['activity', 'activity'],
    ['panels', 'panel'],
    ['status', 'status'],
    ['tools', 'tool'],
    ['activityBarItems', 'activity'],
    ['statusBarItems', 'status'],
  ];
  for (const [section, surface] of sections) {
    const items = contributes[section] as readonly { id: string; title: string; icon?: string }[] | undefined;
    for (const item of items ?? []) {
      views.push({ surface, id: item.id, title: item.title, icon: item.icon, extensionId: packageId });
    }
  }
  for (const item of contributes.toolbarItems ?? []) {
    views.push({ surface: 'tool', id: item.id, title: item.title, icon: item.icon, command: item.command, extensionId: packageId });
  }
  return views;
}

/**
 * Register one package's declarative contributions. Returns one problem
 * per skipped entry (invalid contribution skips alone, never the package).
 */
export function registerManifestContributions(packageId: string, manifest: GrltManifest): string[] {
  const problems: string[] = [];
  const contributes = manifest.contributes;
  if (!contributes) return problems;
  catalog.set(packageId, contributes);

  for (const row of menuRowsFor(packageId, contributes)) {
    try {
      registerExtensionMenuRows([row]);
    } catch (error) {
      problems.push(`menu "${row.location}" row "${row.commandId}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const views = viewsFor(packageId, contributes);
  if (views.length > 0) {
    try {
      registerExtensionViews(views);
    } catch {
      // Duplicate ids throw as a batch; fall back to per-view registration
      // so one collision skips alone instead of dropping the whole surface.
      for (const view of views) {
        try {
          registerExtensionViews([view]);
        } catch (single) {
          problems.push(
            `${view.surface} "${view.id}": ${single instanceof Error ? single.message : String(single)}`,
          );
        }
      }
    }
  }
  for (const [kind, tools] of Object.entries(contributes.editorTools ?? {})) {
    if (kind !== 'design' && kind !== 'whiteboard' && kind !== 'slides') {
      problems.push(`unknown editorTools kind "${kind}"`);
      continue;
    }
    try {
      registerExtensionEditorTools(
        (tools ?? []).map((tool) => ({
          kind,
          id: tool.id,
          title: tool.title,
          command: tool.command,
          extensionId: packageId,
          icon: tool.icon,
        })),
      );
    } catch (error) {
      problems.push(`editorTools.${kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    registerHomeWidgets(
      (contributes.homeWidgets ?? []).map((widget) => ({ ...widget, extensionId: packageId })),
    );
  } catch (error) {
    problems.push(`homeWidgets: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    registerProjectTemplates(
      (contributes.projectTemplates ?? []).map((template) => ({ ...template, extensionId: packageId })),
    );
  } catch (error) {
    problems.push(`projectTemplates: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}

/** Remove every contribution owned by one package (disable/uninstall/unload). */
export function unregisterManifestContributions(packageId: string): void {
  catalog.delete(packageId);
  removeExtensionMenuRows(packageId);
  removeExtensionViews(packageId);
  removeExtensionEditorTools(packageId);
  removeHomeContributions(packageId);
}

/** Drop every catalog entry (tests and full host teardown). */
export function resetManifestCatalog(): void {
  catalog.clear();
}
