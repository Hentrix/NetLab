/**
 * Pick a port when an existing cable is edited. An empty select has no
 * previous value: Number('') is zero, but that must not steal preference from
 * the cable's actual interface (e.g. ether3 instead of ether1).
 */
export function selectedCablePort(available, previousValue, originalValue) {
  const hasPrevious = previousValue !== '' && previousValue !== null && previousValue !== undefined;
  const previous = hasPrevious ? Number(previousValue) : null;
  if (previous !== null && available.includes(previous)) return String(previous);
  if (available.includes(originalValue)) return String(originalValue);
  return available.length ? String(available[0]) : '';
}
