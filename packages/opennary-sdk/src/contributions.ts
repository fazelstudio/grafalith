import type { OnryContributes } from "./manifest.js";

/** Known host surface a extension contribution targets. */
export interface ContributionHost {
  /** Menu locations the host renders (desktop: menubar, canvas/layers/statusbar/activity/home context, select). */
  readonly menuLocations: readonly string[];
  /** Icon ids a extension may reference. */
  readonly iconIds: readonly string[];
}

/**
 * Validate one manifest's contributions against a host. Returns one message
 * per problem; empty means the extension declares only surfaces that exist.
 * Duplicate command ids and menu targets without a matching command fail.
 */
export function validateContributions(
  contributes: OnryContributes | undefined,
  host: ContributionHost,
): string[] {
  const problems: string[] = [];
  if (!contributes) return problems;
  const commandIds = new Set<string>();
  for (const command of contributes.commands ?? []) {
    if (command.command === "") problems.push("contributed command id must not be empty");
    else if (commandIds.has(command.command)) {
      problems.push(`duplicate contributed command "${command.command}"`);
    } else commandIds.add(command.command);
    if (command.title === "") problems.push(`contributed command "${command.command}" needs a title`);
    if (command.icon !== undefined && !host.iconIds.includes(command.icon)) {
      problems.push(`unknown icon "${command.icon}" for command "${command.command}"`);
    }
  }
  for (const [location, placements] of Object.entries(contributes.menus ?? {})) {
    if (!host.menuLocations.includes(location)) {
      problems.push(`unknown menu location "${location}"`);
    }
    for (const placement of placements) {
      if (!commandIds.has(placement.command)) {
        problems.push(`menu "${location}" targets undeclared command "${placement.command}"`);
      }
    }
  }
  const viewSections = {
    views: contributes.views,
    activity: contributes.activity,
    panels: contributes.panels,
    status: contributes.status,
    tools: contributes.tools,
  } as const;
  for (const [section, items] of Object.entries(viewSections)) {
    const seen = new Set<string>();
    for (const item of items ?? []) {
      if (item.id === "") problems.push(`contributed ${section} id must not be empty`);
      else if (seen.has(item.id)) problems.push(`duplicate contributed ${section} "${item.id}"`);
      else seen.add(item.id);
      if (item.title === "") problems.push(`contributed ${section} "${item.id}" needs a title`);
      if (item.icon !== undefined && !host.iconIds.includes(item.icon)) {
        problems.push(`unknown icon "${item.icon}" for ${section} "${item.id}"`);
      }
    }
  }
  for (const binding of contributes.keybindings ?? []) {
    if (!commandIds.has(binding.command)) {
      problems.push(`keybinding targets undeclared command "${binding.command}"`);
    }
    if (binding.key === "") problems.push(`keybinding for "${binding.command}" needs a key`);
  }
  for (const setting of contributes.configuration ?? []) {
    if (setting.key === "") problems.push("contributed configuration key must not be empty");
  }
  return problems;
}
