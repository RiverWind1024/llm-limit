export type WindowKey = "5h" | "weekly" | "monthly";

/** 一个限额窗口的展示数据。usedPct 为 null 表示该 provider 没有返回这个窗口。 */
export interface UsageWindow {
  key: WindowKey;
  label: string;
  usedPct: number | null;
  resetAt?: Date;
  /** 附加说明，例如模型名、请求数、套餐类型 */
  detail?: string;
}

export type ProviderStatus = "ok" | "warn" | "auth" | "error";

/** `--init` 扫描到的凭据状态，只检查本地凭据，不发网络请求。 */
export interface CredentialStatus {
  available: boolean;
  /** 凭据来源，例如 "~/.mmx/config.json" */
  source?: string;
  /** 附加信息，例如区域或账号 */
  detail?: string;
  /** 不可用时的处理建议 */
  hint?: string;
}

export interface ProviderSnapshot {
  providerId: string;
  providerName: string;
  account?: string;
  windows: UsageWindow[];
  status: ProviderStatus;
  message?: string;
  fetchedAt: Date;
}

export interface ProviderDef {
  id: string;
  name: string;
  /** 未配置凭据时的引导文案 */
  authHint: string;
  /** 只检查本地凭据是否存在，供 `--init` 扫描使用 */
  detect(): Promise<CredentialStatus>;
  fetch(signal?: AbortSignal): Promise<ProviderSnapshot>;
}

/** 统一生成固定顺序的窗口列表，provider 只需覆盖自己返回的部分。 */
export function buildWindows(partial: Partial<Record<WindowKey, Omit<UsageWindow, "key" | "label">>>): UsageWindow[] {
  const labels: Record<WindowKey, string> = {
    "5h": "5 小时",
    weekly: "本周",
    monthly: "本月",
  };
  return (["5h", "weekly", "monthly"] as WindowKey[]).map((key) => ({
    key,
    label: labels[key],
    usedPct: partial[key]?.usedPct ?? null,
    resetAt: partial[key]?.resetAt,
    detail: partial[key]?.detail,
  }));
}

export function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function emptySnapshot(id: string, name: string, status: ProviderStatus, message: string): ProviderSnapshot {
  return {
    providerId: id,
    providerName: name,
    windows: buildWindows({}),
    status,
    message,
    fetchedAt: new Date(),
  };
}
