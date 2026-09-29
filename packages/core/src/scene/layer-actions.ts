import { Scene } from './scene';

/**
 * Bring elements to the front of the z-order (move to end of elementOrder).
 */
export function bringToFront(scene: Scene, elementIds: string[]): void {
  const order = scene.getElementOrder();
  const idSet = new Set(elementIds);

  // Remove the elements from their current positions
  const remaining = order.filter((id) => !idSet.has(id));
  // Append them at the end (front)
  scene.setElementOrder([...remaining, ...elementIds]);
}

/**
 * Send elements to the back of the z-order (move to beginning of elementOrder).
 */
export function sendToBack(scene: Scene, elementIds: string[]): void {
  const order = scene.getElementOrder();
  const idSet = new Set(elementIds);

  // Remove the elements from their current positions
  const remaining = order.filter((id) => !idSet.has(id));
  // Prepend them at the beginning (back)
  scene.setElementOrder([...elementIds, ...remaining]);
}

/**
 * Bring elements forward by one step in the z-order.
 */
export function bringForward(scene: Scene, elementIds: string[]): void {
  const order = scene.getElementOrder();
  const idSet = new Set(elementIds);
  const newOrder = [...order];

  // Process from top to bottom (high index to low) to avoid index shifting issues
  for (let i = newOrder.length - 2; i >= 0; i--) {
    if (idSet.has(newOrder[i]) && !idSet.has(newOrder[i + 1])) {
      // Swap with the element above
      const temp = newOrder[i];
      newOrder[i] = newOrder[i + 1];
      newOrder[i + 1] = temp;
    }
  }

  scene.setElementOrder(newOrder);
}

/**
 * Send elements backward by one step in the z-order.
 */
export function sendBackward(scene: Scene, elementIds: string[]): void {
  const order = scene.getElementOrder();
  const idSet = new Set(elementIds);
  const newOrder = [...order];

  // Process from bottom to top (low index to high) to avoid index shifting issues
  for (let i = 1; i < newOrder.length; i++) {
    if (idSet.has(newOrder[i]) && !idSet.has(newOrder[i - 1])) {
      // Swap with the element below
      const temp = newOrder[i];
      newOrder[i] = newOrder[i - 1];
      newOrder[i - 1] = temp;
    }
  }

  scene.setElementOrder(newOrder);
}
