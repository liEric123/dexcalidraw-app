import { formatBytes, type StorageEstimateResult, type StorageLevel } from "../lib/storageHealth";

type Props = {
  estimate: StorageEstimateResult | null;
  level: StorageLevel;
};

const LEVEL_CLASSES: Record<StorageLevel, string> = {
  ok: "",
  warning: "text-amber-600 border-amber-200 bg-amber-50",
  critical: "text-red-600 border-red-200 bg-red-50",
};

// Stays silent below the warning threshold: an early-warning signal, not an
// always-on storage meter.
export default function StorageIndicator({ estimate, level }: Props) {
  if (!estimate || level === "ok") return null;

  const percent = Math.round(estimate.percentUsed * 100);
  const detail = `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} browser storage used`;
  const advice = "Export a backup and delete unused videos or presentations to free up space.";

  return (
    <span
      role="status"
      title={`${detail}${level === "critical" ? ` — ${advice}` : ""}`}
      className={`shrink-0 flex items-center gap-1 text-[11px] font-medium border rounded-full px-2 py-0.5 ${LEVEL_CLASSES[level]}`}
    >
      {level === "critical" && (
        <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="4" r="4" />
        </svg>
      )}
      {percent}% storage
    </span>
  );
}
