// Compare JSON data structurally: object key order is insignificant, array
// ordering and every value remain significant. Never merge imported objects.
export function hasJSONKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function sameJSON(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (a === b) return true;
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && a.every((v, i) => sameJSON(v, b[i], depth + 1));
  if (b !== null && typeof b === 'object' && !Array.isArray(b)) {
    const expected = b as Record<string, unknown>;
    return hasJSONKeys(a, Object.keys(expected)) && Object.keys(expected).every(key => sameJSON(a[key], expected[key], depth + 1));
  }
  return false;
}
