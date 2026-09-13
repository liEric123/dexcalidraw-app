import { useCallback, useEffect, useState } from "react";
import { getStorageEstimate, getStorageLevel, type StorageEstimateResult, type StorageLevel } from "../lib/storageHealth";

// Ambient re-check interval; storage-affecting actions (video add/delete,
// import) aren't wired to call this directly. A 30 s staleness ceiling is
// good enough for an early-warning indicator and avoids threading a refresh
// call through every mutation path in usePresentation.
const POLL_INTERVAL_MS = 30_000;

export function useStorageHealth(): { estimate: StorageEstimateResult | null; level: StorageLevel } {
  const [estimate, setEstimate] = useState<StorageEstimateResult | null>(null);

  const refresh = useCallback(() => {
    getStorageEstimate().then(setEstimate);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  return { estimate, level: estimate ? getStorageLevel(estimate.percentUsed) : "ok" };
}
