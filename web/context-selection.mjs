/**
 * Right-click must not silently deselect a group of topology nodes.
 * A click on an unselected device replaces the selection with that device;
 * a click on any already selected device keeps the entire group intact.
 */
export function selectionForContextMenu(selectedIDs, targetID) {
  const result = new Set(selectedIDs);
  if (!result.has(targetID)) return new Set([targetID]);
  return result;
}

/** Selection is cleared by a normal left-click on empty canvas only. */
export function shouldClearCanvasSelection(button) {
  return button === 0;
}
