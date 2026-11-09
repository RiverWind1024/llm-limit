import { envValue, opencodeAccountKey, opencodeAuthKey } from "../lib/credentials.js";
import { bearer, describeError, getJSON } from "../lib/http.js";
import { firstNumber } from "../lib/parse.js";
import type { BalanceInfo, CredentialStatus, ProviderDef, ProviderSnapshot } from "./types.js";

const DEFAULT_BASE = "https://api.deepseek.com";
const AUTH_HINT = "未找到 DeepSeek API Key。执行 llm-limit auth deepseek <key>，或设置 DEEPSEEK_API_KEY";

interface BalanceResponse {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string | number;
    granted_balance?: string | number;
    topped_up_balance?: string | number;
  }>;
}

async function resolveKey(): Promise<{ key: string; source: string } | undefined> {
  const env = envValue("DEEPSEEK_API_KEY");
  if (env) return { key: env, source: "环境变量 DEEPSEEK_API_KEY" };

  const auth = await opencodeAuthKey("deepseek");
  if (auth) return { key: auth.key, source: auth.source };

  const account = await opencodeAccountKey("deepseek");
  if (account) return { key: account.key, source: account.source };

  return undefined;
}

async function detectDeepSeek(): Promise<CredentialStatus> {
  const found = await resolveKey();
  return found
    ? { available: true, source: found.source }
    : { available: false, hint: AUTH_HINT };
}

function parseBalances(body: BalanceResponse): BalanceInfo[] {
  const balances: BalanceInfo[] = [];
  for (const info of body.balance_infos ?? []) {
    const total = firstNumber(info.total_balance);
    if (total == null) continue;
    balances.push({
      currency: (info.currency ?? "CNY").toUpperCase(),
      total,
      granted: firstNumber(info.granted_balance),
      toppedUp: firstNumber(info.topped_up_balance),
    });
  }
  return balances;
}

async function fetchDeepSeek(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const found = await resolveKey();
  if (!found) {
    return {
      providerId: "deepseek",
      providerName: "DeepSeek",
      windows: [],
      status: "auth",
      message: AUTH_HINT,
      fetchedAt: new Date(),
    };
  }

  const baseUrl = (envValue("DEEPSEEK_BASE_URL") ?? DEFAULT_BASE).replace(/\/+$/, "");

  try {
    const body = await getJSON<BalanceResponse>(
      `${baseUrl}/user/balance`,
      { headers: { ...bearer(found.key), Accept: "application/json" } },
      signal,
    );

    const balances = parseBalances(body);
    const available = body.is_available !== false;

    return {
      providerId: "deepseek",
      providerName: "DeepSeek",
      account: found.source,
      windows: [],
      balances,
      status: available ? "ok" : "warn",
      message: available ? undefined : "账户余额不可用",
      fetchedAt: new Date(),
    };
  } catch (err) {
    return {
      providerId: "deepseek",
      providerName: "DeepSeek",
      windows: [],
      status: "error",
      message: describeError(err),
      fetchedAt: new Date(),
    };
  }
}

export const deepseekProvider: ProviderDef = {
  id: "deepseek",
  name: "DeepSeek",
  authHint: AUTH_HINT,
  detect: detectDeepSeek,
  fetch: fetchDeepSeek,
};
