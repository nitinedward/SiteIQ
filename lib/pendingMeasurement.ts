// Tiny in-memory handoff for returning an AR-measured value from the
// AR measure screen back to the observation screen that opened it
// (expo-router has no built-in way to return data through router.back()).
let pendingMeasurement: { value: string; unit: string } | null = null;

export function setPendingMeasurement(value: string, unit: string) {
  pendingMeasurement = { value, unit };
}

export function consumePendingMeasurement(): { value: string; unit: string } | null {
  const m = pendingMeasurement;
  pendingMeasurement = null;
  return m;
}
