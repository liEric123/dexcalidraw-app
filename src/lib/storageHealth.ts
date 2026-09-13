// Storage-quota reporting. `navigator.storage.estimate()` is a browser-wide
// figure covering localStorage and IndexedDB together (Safari does not
// support it at all, including in private browsing), so this can only ever
// be an early warning, not a guarantee that a given write will succeed.

export type StorageEstimateResult = {
  usage: number;
  quota: number;
  percentUsed: number;
};

export type StorageLevel = "ok" | "warning" | "critical";

export const STORAGE_WARNING_THRESHOLD = 0.8;
export const STORAGE_CRITICAL_THRESHOLD = 0.95;

export async function getStorageEstimate(): Promise<StorageEstimateResult | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return null;
    const used = usage ?? 0;
    return { usage: used, quota, percentUsed: used / quota };
  } catch {
    return null;
  }
}

export function getStorageLevel(percentUsed: number): StorageLevel {
  if (percentUsed >= STORAGE_CRITICAL_THRESHOLD) return "critical";
  if (percentUsed >= STORAGE_WARNING_THRESHOLD) return "warning";
  return "ok";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
