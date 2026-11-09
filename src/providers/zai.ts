import { envEntry, envValue } from "../lib/credentials.js";
import { describeError, getJSON } from "../lib/http.js";
import { firstNumber, parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

const ZAI_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const ZHIPU_URL = "https://bigmodel.cn/api/monitor/usage/quota/limit";

/**
 * Z.AI 的 quota 接口不在公开 API 文档里，是订阅管理页内部使用的。
 * 认证方式是把 API Key 原样放进 Authorization（不是 Bearer）。
 * limits[].unit: 3 = 5 小时窗口，6 = 周窗口。
 */
interface ZaiLimit {
  type?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  percentage?: number;
  nextResetTime?: number | string;
}

interface ZaiEnvelope {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: { limits?: ZaiLimit[] } | null;
  limits?: ZaiLimit[];
}

function resolveAuth(): { key: string; url: string; account: string; source: string } | null {
  const entry = envEntry("ZAI_API_KEY", "ZHIPU_API_KEY", "Z_AI_API_KEY", "GLM_API_KEY");
  if (!entry) return null;
  const key = entry.value;
  const source = `环境变量 ${entry.name}`;

  const explicit = envValue("ZAI_BASE_URL");
  if (explicit) {
    return { key, url: `${explicit.replace(/\/+$/, "")}/api/monitor/usage/quota/limit`, account: "custom", source };
  }

  const region = (envValue("ZAI_REGION") ?? "").toLowerCase();
  if (region === "cn" || region === "zhipu" || region === "bigmodel") {
    return { key, url: ZHIPU_URL, account: "bigmodel", source };
  }
  return { key, url: ZAI_URL, account: "z.ai", source };
}

function pickLimits(body: ZaiEnvelope): ZaiLimit[] {
  const limits = body.data?.limits ?? body.limits;
  return Array.isArray(limits) ? limits : [];
}

async function fetchZai(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const auth = resolveAuth();
  if (!auth) {
    return emptySnapshot("zai", "Z.AI", "auth", "未找到 Z.AI 凭据。设置 ZAI_API_KEY（中国区加 ZAI_REGION=cn）。");
  }

  try {
    const body = await getJSON<ZaiEnvelope>(
      auth.url,
      { headers: { Authorization: auth.key, Accept: "application/json", "Content-Type": "application/json" } },
      signal,
    );

    if (body.success === false || (typeof body.code === "number" && body.code >= 400)) {
      throw new Error(body.msg ?? `Z.AI 返回错误码 ${body.code}`);
    }

    let fiveHour: number | null = null;
    let weekly: number | null = null;
    let fiveReset: Date | undefined;
    let weeklyReset: Date | undefined;
    let detail: string | undefined;

    for (const limit of pickLimits(body)) {
      const kind = String(limit.type ?? "").toUpperCase();
      if (kind !== "TOKENS_LIMIT" && kind !== "CREDIT_LIMIT") continue;

      const unit = firstNumber(limit.unit);
      const used =
        typeof limit.percentage === "number"
          ? clampPct(limit.percentage)
          : typeof limit.usage === "number" && limit.usage > 0 && typeof limit.currentValue === "number"
            ? clampPct((limit.currentValue / limit.usage) * 100)
            : null;
      if (used == null) continue;

      const reset = parseTime(limit.nextResetTime);
      if (unit === 3) {
        fiveHour = used;
        fiveReset = reset;
        detail = kind === "CREDIT_LIMIT" ? "credits" : "tokens";
      } else if (unit === 6) {
        weekly = used;
        weeklyReset = reset;
      }
    }

    if (fiveHour == null && weekly == null) {
      return {
        ...emptySnapshot("zai", "Z.AI", "warn", "接口没有返回 5h / 周限额窗口"),
        account: auth.account,
      };
    }

    const windowed = [fiveHour, weekly].filter((pct): pct is number => pct != null);
    const status = windowed.some((pct) => pct >= 100) ? "warn" : "ok";

    return {
      providerId: "zai",
      providerName: "Z.AI GLM",
      account: auth.account,
      windows: buildWindows({
        "5h": { usedPct: fiveHour, resetAt: fiveReset, detail },
        weekly: { usedPct: weekly, resetAt: weeklyReset },
      }),
      status,
      message: windowed.some((pct) => pct >= 100) ? "配额已用尽" : undefined,
      fetchedAt: new Date(),
    };
  } catch (err) {
    return {
      ...emptySnapshot("zai", "Z.AI GLM", "error", describeError(err)),
      account: auth.account,
    };
  }
}

async function detectZai(): Promise<CredentialStatus> {
  const auth = resolveAuth();
  if (!auth) {
    return { available: false, hint: "设置 ZAI_API_KEY（中国区加 ZAI_REGION=cn）" };
  }
  return { available: true, source: auth.source, detail: auth.account };
}

export const zaiProvider: ProviderDef = {
  id: "zai",
  name: "Z.AI GLM",
  authHint: "设置 ZAI_API_KEY（中国区另设 ZAI_REGION=cn）",
  detect: detectZai,
  fetch: fetchZai,
};
