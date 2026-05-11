// Utility helpers used by workers and services
export function chunk(array, size) {
  if (!Array.isArray(array)) return [];
  if (size <= 0) return [array];
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

export function calculateThroughput(count, durationMs) {
  if (!durationMs || durationMs <= 0) return 0;
  return count / (durationMs / 1000);
}

export default { chunk, calculateThroughput };
