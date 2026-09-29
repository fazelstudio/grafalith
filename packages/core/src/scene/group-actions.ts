import { Scene } from './scene';

/**
 * Create a new group from the given element IDs.
 * Sets the groupId on all elements (innermost-to-outermost order).
 * @returns The newly created group ID.
 */
export function groupElements(scene: Scene, elementIds: string[]): string {
  const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) {
      scene.upsertElement({
        ...el,
        groupIds: [...el.groupIds, groupId],
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }

  return groupId;
}

/**
 * Remove a group, clearing the groupId from all member elements.
 * If elements belong to nested groups, only the specified groupId is removed.
 */
export function ungroupElements(scene: Scene, groupId: string): void {
  const elements = scene.getAllElements();

  for (const el of elements) {
    if (el.groupIds.includes(groupId)) {
      scene.upsertElement({
        ...el,
        groupIds: el.groupIds.filter((id) => id !== groupId),
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * Get all element IDs that share any group with the given element.
 * Returns the outermost group's members.
 */
export function getGroupMembers(scene: Scene, elementId: string): string[] {
  const el = scene.getElement(elementId);
  if (!el || el.groupIds.length === 0) return [elementId];

  // Use the outermost group to find all members
  const outermostGroupId = el.groupIds[el.groupIds.length - 1];
  const members: string[] = [];

  for (const member of scene.getAllElements()) {
    if (!member.isDeleted && member.groupIds.includes(outermostGroupId)) {
      members.push(member.id);
    }
  }

  return members;
}

/**
 * Get the outermost group ID for an element, or null if not grouped.
 */
export function getOutermostGroupId(scene: Scene, elementId: string): string | null {
  const el = scene.getElement(elementId);
  if (!el || el.groupIds.length === 0) return null;
  return el.groupIds[el.groupIds.length - 1];
}
