// Tiny in-memory handoff for returning a value from a modal picker screen
// back to the screen that opened it (expo-router has no built-in way to
// return data through router.back()).
let pendingDrawingSelection: string[] | null = null;

export function setPendingDrawingSelection(ids: string[]) {
  pendingDrawingSelection = ids;
}

export function consumePendingDrawingSelection(): string[] | null {
  const ids = pendingDrawingSelection;
  pendingDrawingSelection = null;
  return ids;
}
