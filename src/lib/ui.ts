import type { ProviderSnapshot } from "../providers/types.js";

/** 已用比例的颜色阈值：低于 WARN 为绿，WARN~CRIT 为黄，达到 CRIT 为红。 */
export const USED_WARN_PCT = 60;
export const USED_CRIT_PCT = 85;

export function barColor(usedPct: number): "green" | "yellow" | "red" {
  if (usedPct >= USED_CRIT_PCT) return "red";
  if (usedPct >= USED_WARN_PCT) return "yellow";
  return "green";
}

export function statusDot(snapshot: ProviderSnapshot | undefined): { symbol: string; color: string } {
  if (!snapshot) return { symbol: "○", color: "gray" };
  switch (snapshot.status) {
    case "ok":
      return { symbol: "●", color: "green" };
    case "warn":
      return { symbol: "●", color: "yellow" };
    case "auth":
      return { symbol: "○", color: "red" };
    default:
      return { symbol: "●", color: "red" };
  }
}

export function progressBar(usedPct: number, width: number): string {
  const safeWidth = Math.max(8, width);
  const clamped = Math.min(100, Math.max(0, usedPct));
  const filled = Math.round((clamped / 100) * safeWidth);
  return `${"█".repeat(filled)}${"░".repeat(safeWidth - filled)}`;
}
