import path from "node:path";

import { envValue, home, newestJsonFile, readJson, tildify } from "../lib/credentials.js";
import { bearer, describeError, getJSON } from "../lib/http.js";
import { asRecord, firstNumber, parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

const DEFAULT_BASE = "https://api.kimi.com/coding/v1";

interface KimiCredentials {
  access_token?: string;
  expires_at?: number;
}

interface KimiLegacyDetail {
  limit?: number | string;
  used?: number | string;
  remaining?: number | string;
  resetTime?: string;
}

interface KimiWindow {
  window?: { duration?: number; timeUnit?: string };
  detail?: KimiLegacyDetail;
}

interface KimiRatioWindow {
  used_ratio?: number;
  reset_time?: string;
}

interface KimiResponse {
  code?: number;
  msg?: string;
  data?: {
    kind?: string;
    quota?: {
      usages?: Record<string, KimiRatioWindow>;
    };
    usages?: Record<string, KimiRatioWindow>;
  };
  usage?: KimiLegacyDetail;
  limits?: KimiWindow[];
  usages?: Record<string, KimiRatioWindow>;
}

async function findCredentials(): Promise<{ creds: KimiCredentials; file: string } | null> {
  const explicit = envValue("KIMI_CREDENTIALS_PATH");
  const file = explicit ?? (await newestJsonFile(path.join(home(), ".kimi-code/credentials")));
  if (!file) return null;
  const creds = await readJson<KimiCredentials>(file);
  return creds ? { creds, file } : null;
}

async function detectKimi(): Promise<CredentialStatus> {
  const found = await findCredentials();
  if (!found?.creds.access_token) {
    return { available: false, hint: "未找到凭据，先登录 kimi CLI（~/.kimi-code/credentials）" };
  }
  const expired = found.creds.expires_at != null && Date.now() / 1000 >= found.creds.expires_at;
  if (expired) {
    return { available: false, source: tildify(found.file), hint: "access token 已过期，请重新登录 kimi CLI" };
  }
  return { available: true, source: tildify(found.file) };
}

/** 优先用 300 分钟窗口的 counts；usages.limit_5h 的 used_ratio 在部分账号上恒为 0。 */
function pctFromCounts(detail: KimiLegacyDetail | undefined): number | null {
  if (!detail) return null;
  const used = firstNumber(detail.used);
  const limit = firstNumber(detail.limit);
  if (used != null && limit != null && limit > 0) return clampPct((used / limit) * 100);
  const remaining = firstNumber(detail.remaining);
  if (remaining != null && limit != null && limit > 0) return clampPct(100 - (remaining / limit) * 100);
  return null;
}

function pctFromRatio(win: KimiRatioWindow | undefined): number | null {
  const ratio = firstNumber(win?.used_ratio);
  return ratio == null ? null : clampPct(ratio * 100);
}

async function fetchKimi(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const found = await findCredentials();
  const token = found?.creds.access_token;
  if (!token) {
    return emptySnapshot(
      "kimi",
      "Kimi Code",
      "auth",
      "未找到 Kimi Code 凭据。先登录 kimi CLI（~/.kimi-code/credentials）。",
    );
  }
  const credentials = found.creds;
  if (credentials.expires_at && Date.now() / 1000 >= credentials.expires_at) {
    return emptySnapshot("kimi", "Kimi Code", "auth", "Kimi Code access token 已过期，请重新登录 kimi CLI。");
  }

  const baseUrl = (envValue("KIMI_BASE_URL") ?? DEFAULT_BASE).replace(/\/+$/, "");

  try {
    const body = await getJSON<KimiResponse>(
      `${baseUrl}/usages`,
      { headers: bearer(token) },
      signal,
    );

    const fiveHourLimit = (body.limits ?? []).find((item) =>
      firstNumber(item.window?.duration) === 300,
    )?.detail;

    // usages 字段可能在顶层，也可能在 data.quota 下。
    const ratioWindows =
      body.usages ?? body.data?.usages ?? body.data?.quota?.usages ?? {};

    let fiveHour = pctFromCounts(fiveHourLimit);
    if (fiveHour == null) fiveHour = pctFromRatio(ratioWindows["limit_5h"]);

    let weekly = pctFromCounts(body.usage);
    if (weekly == null) weekly = pctFromRatio(ratioWindows["limit_7d"]);

    let monthly = pctFromRatio(ratioWindows["limit_month_total"]);
    if (monthly == null) monthly = pctFromRatio(ratioWindows["limit_month_code"]);

    const fiveReset = parseTime(fiveHourLimit?.resetTime) ?? parseTime(ratioWindows["limit_5h"]?.reset_time);
    const weeklyReset = parseTime(body.usage?.resetTime) ?? parseTime(ratioWindows["limit_7d"]?.reset_time);
    const monthlyReset = parseTime(ratioWindows["limit_month_total"]?.reset_time);

    const windowed = [fiveHour, weekly, monthly].filter((pct): pct is number => pct != null);
    if (windowed.length === 0) {
      return emptySnapshot("kimi", "Kimi Code", "warn", "接口没有返回配额窗口");
    }

    const status = windowed.some((pct) => pct >= 100) ? "warn" : "ok";

    return {
      providerId: "kimi",
      providerName: "Kimi Code",
      account: fiveHourLimit ? "code" : undefined,
      windows: buildWindows({
        "5h": { usedPct: fiveHour, resetAt: fiveReset },
        weekly: { usedPct: weekly, resetAt: weeklyReset },
        monthly: { usedPct: monthly, resetAt: monthlyReset },
      }),
      status,
      message: windowed.some((pct) => pct >= 100) ? "配额已用尽" : undefined,
      fetchedAt: new Date(),
    };
  } catch (err) {
    return emptySnapshot("kimi", "Kimi Code", "error", describeError(err));
  }
}

export const kimiProvider: ProviderDef = {
  id: "kimi",
  name: "Kimi Code",
  authHint: "先登录 kimi CLI，或设置 KIMI_CREDENTIALS_PATH",
  detect: detectKimi,
  fetch: fetchKimi,
};
