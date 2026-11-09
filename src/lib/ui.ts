import type { BalanceInfo, ProviderSnapshot } from "../providers/types.js";

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "¥",
};

export function formatAmount(currency: string, amount: number): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatMoney(balance: BalanceInfo): string {
  return formatAmount(balance.currency, balance.total);
}

export function balanceColor(total: number): "green" | "yellow" | "red" {
  if (total <= 0) return "red";
  if (total < 5) return "yellow";
  return "green";
}

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
