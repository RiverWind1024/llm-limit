import path from "node:path";

import { envValue, home, opencodeAccountKey, opencodeAuthKey, readJson } from "../lib/credentials.js";
import { bearer, describeError, getJSON, HttpError } from "../lib/http.js";
import { parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

const GLOBAL_BASE = "https://api.minimax.io";
const CN_BASE = "https://api.minimax.cn";

interface MiniMaxBucket {
  model_name?: string;
  start_time?: number;
  end_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  current_interval_remaining_percent?: number;
  current_interval_status?: number;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  current_weekly_remaining_percent?: number;
  current_weekly_status?: number;
  weekly_start_time?: number;
  weekly_end_time?: number;
}

interface MiniMaxResponse {
  model_remains?: MiniMaxBucket[];
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MiniMaxAuth {
  key: string;
  baseUrl: string;
  account: string;
  source: string;
}

async function resolveAuth(): Promise<MiniMaxAuth | null> {
  const cnKey = envValue("MINIMAX_CN_API_KEY");
  if (cnKey) {
    return { key: cnKey, baseUrl: CN_BASE, account: "minimax-cn", source: "MINIMAX_CN_API_KEY" };
  }

  const globalKey = envValue("MINIMAX_API_KEY");
  if (globalKey) {
    return { key: globalKey, baseUrl: GLOBAL_BASE, account: "minimax", source: "MINIMAX_API_KEY" };
  }

  const mmx = await readJson<{ api_key?: string; region?: string }>(path.join(home(), ".mmx/config.json"));
  if (mmx?.api_key) {
    const region = (mmx.region ?? "global").toLowerCase();
    return {
      key: mmx.api_key,
      baseUrl: region === "cn" ? CN_BASE : GLOBAL_BASE,
      account: `minimax-${region}`,
      source: "~/.mmx/config.json",
    };
  }

  const opencodeCN =
    (await opencodeAuthKey("minimax-cn-coding-plan")) ?? (await opencodeAccountKey("minimax-cn-coding-plan"));
  if (opencodeCN) {
    return { key: opencodeCN, baseUrl: CN_BASE, account: "minimax-cn", source: "opencode 凭据" };
  }

  const opencodeGlobal =
    (await opencodeAuthKey("minimax-coding-plan")) ?? (await opencodeAccountKey("minimax-coding-plan"));
  if (opencodeGlobal) {
    return { key: opencodeGlobal, baseUrl: GLOBAL_BASE, account: "minimax", source: "opencode 凭据" };
  }

  return null;
}

/** MiniMax 的 usage_count 字段在不同版本里可能是"已用"也可能是"剩余"，优先用百分比字段。 */
function windowPct(remainingPercent: number | undefined, total: number | undefined, reported: number | undefined, status: number | undefined): number | null {
  if (status === 2) return 100;
  if (remainingPercent != null && Number.isFinite(remainingPercent)) {
    return clampPct(100 - remainingPercent);
  }
  if (total && total > 0 && reported != null && reported >= 0 && reported <= total) {
    return clampPct((reported / total) * 100);
  }
  return null;
}

function bucketNotInPlan(bucket: MiniMaxBucket): boolean {
  return (
    (bucket.current_interval_total_count ?? 0) === 0 &&
    (bucket.current_weekly_total_count ?? 0) === 0 &&
    (bucket.current_interval_status ?? 0) === 3 &&
    (bucket.current_weekly_status ?? 0) === 3
  );
}

async function fetchMiniMax(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const auth = await resolveAuth();
  if (!auth) {
    return emptySnapshot(
      "minimax",
      "MiniMax",
      "auth",
      "未找到 MiniMax 凭据。设置 MINIMAX_API_KEY，或先登录 mmx CLI。",
    );
  }

  try {
    const data = await getJSON<MiniMaxResponse>(
      `${auth.baseUrl}/v1/token_plan/remains`,
      { headers: bearer(auth.key) },
      signal,
    );

    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw new HttpError(data.base_resp.status_msg ?? `MiniMax 返回错误码 ${data.base_resp.status_code}`, 0);
    }

    const buckets = (data.model_remains ?? []).filter((bucket) => !bucketNotInPlan(bucket));
    if (buckets.length === 0) {
      return {
        ...emptySnapshot("minimax", "MiniMax", "warn", "账户没有可用的 M Plan 配额"),
        account: auth.account,
      };
    }

    const bucket = buckets.find((item) => item.model_name?.toLowerCase() === "general") ?? buckets[0];
    const fiveHour = windowPct(
      bucket.current_interval_remaining_percent,
      bucket.current_interval_total_count,
      bucket.current_interval_usage_count,
      bucket.current_interval_status,
    );
    const weekly = windowPct(
      bucket.current_weekly_remaining_percent,
      bucket.current_weekly_total_count,
      bucket.current_weekly_usage_count,
      bucket.current_weekly_status,
    );

    const windowed = [fiveHour, weekly].filter((pct): pct is number => pct != null);
    const status = windowed.some((pct) => pct >= 100) ? "warn" : "ok";

    return {
      providerId: "minimax",
      providerName: "MiniMax",
      account: auth.account,
      windows: buildWindows({
        "5h": {
          usedPct: fiveHour,
          resetAt: parseTime(bucket.end_time),
          detail: bucket.model_name,
        },
        weekly: {
          usedPct: weekly,
          resetAt: parseTime(bucket.weekly_end_time),
        },
      }),
      status,
      message: windowed.some((pct) => pct >= 100) ? "配额已用尽" : undefined,
      fetchedAt: new Date(),
    };
  } catch (err) {
    return {
      ...emptySnapshot("minimax", "MiniMax", "error", describeError(err)),
      account: auth.account,
    };
  }
}

async function detectMiniMax(): Promise<CredentialStatus> {
  const auth = await resolveAuth();
  if (!auth) {
    return {
      available: false,
      hint: "设置 MINIMAX_API_KEY / MINIMAX_CN_API_KEY，或登录 mmx CLI",
    };
  }
  return { available: true, source: auth.source, detail: auth.account };
}

export const minimaxProvider: ProviderDef = {
  id: "minimax",
  name: "MiniMax",
  authHint: "设置 MINIMAX_API_KEY / MINIMAX_CN_API_KEY，或登录 mmx CLI",
  detect: detectMiniMax,
  fetch: fetchMiniMax,
};
