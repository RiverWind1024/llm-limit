import path from "node:path";

import { envValue, home, readJson, tildify } from "../lib/credentials.js";
import { bearer, describeError, getJSON } from "../lib/http.js";
import { firstNumber, parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

const DEFAULT_BASE = "https://chatgpt.com/backend-api";
const AUTH_HINT = "Codex 使用 OAuth，请先执行 codex login（生成 ~/.codex/auth.json）";

interface CodexAuthFile {
  account_id?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface CodexWindow {
  used_percent?: number;
  remaining_percent?: number;
  limit_window_seconds?: number;
  window_minutes?: number;
  reset_at?: number;
  resets_at?: number;
  reset_after_seconds?: number;
}

interface CodexLimitDetails {
  primary_window?: CodexWindow;
  secondary_window?: CodexWindow;
  primary?: CodexWindow;
  secondary?: CodexWindow;
}

interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: CodexLimitDetails;
  rate_limit_status?: { rate_limit?: CodexLimitDetails };
}

function codexHome(): string {
  return envValue("CODEX_HOME") ?? path.join(home(), ".codex");
}

async function findAuth(): Promise<{ auth: CodexAuthFile; file: string } | null> {
  const file = path.join(codexHome(), "auth.json");
  const auth = await readJson<CodexAuthFile>(file);
  return auth ? { auth, file } : null;
}

async function detectCodex(): Promise<CredentialStatus> {
  const found = await findAuth();
  const token = found?.auth.tokens?.access_token;
  if (!found || !token) {
    return { available: false, hint: AUTH_HINT };
  }
  return {
    available: true,
    source: tildify(found.file),
    detail: found.auth.tokens?.account_id ?? found.auth.account_id,
  };
}

/** 窗口时长（秒）-> 展示用的 key。 */
function windowKey(seconds: number | undefined): "5h" | "weekly" | null {
  if (!seconds || seconds <= 0) return null;
  if (Math.abs(seconds - 18_000) <= 60) return "5h";
  if (Math.abs(seconds - 604_800) <= 3600) return "weekly";
  return null;
}

function windowDurationSeconds(win: CodexWindow): number | undefined {
  if (win.limit_window_seconds && win.limit_window_seconds > 0) return win.limit_window_seconds;
  if (win.window_minutes && win.window_minutes > 0) return win.window_minutes * 60;
  return undefined;
}

function resolveReset(win: CodexWindow, now: number): Date | undefined {
  const abs = parseTime(win.reset_at ?? win.resets_at);
  if (abs) return abs;
  const after = firstNumber(win.reset_after_seconds);
  return after != null ? new Date(now + after * 1000) : undefined;
}

async function fetchCodex(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const found = await findAuth();
  const auth = found?.auth;
  const token = auth?.tokens?.access_token;
  if (!token) {
    return emptySnapshot("codex", "Codex", "auth", AUTH_HINT);
  }

  const baseUrl = (envValue("CODEX_CHATGPT_BASE_URL") ?? DEFAULT_BASE).replace(/\/+$/, "");
  const now = Date.now();
  const headers: Record<string, string> = {
    ...bearer(token),
    Accept: "application/json",
    "User-Agent": "codex-cli",
  };
  const accountId = auth?.tokens?.account_id ?? auth?.account_id;
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  try {
    const body = await getJSON<CodexUsageResponse>(`${baseUrl}/wham/usage`, { headers }, signal);
    const limits = body.rate_limit ?? body.rate_limit_status?.rate_limit;
    const windows = [limits?.primary_window ?? limits?.primary, limits?.secondary_window ?? limits?.secondary];

    let fiveHour: number | null = null;
    let weekly: number | null = null;
    let fiveReset: Date | undefined;
    let weeklyReset: Date | undefined;

    for (const win of windows) {
      if (!win) continue;
      const seconds = windowDurationSeconds(win);
      const key = windowKey(seconds);
      if (!key) continue;

      const used =
        typeof win.used_percent === "number"
          ? clampPct(win.used_percent)
          : typeof win.remaining_percent === "number"
            ? clampPct(100 - win.remaining_percent)
            : null;
      if (used == null) continue;

      if (key === "5h") {
        fiveHour = used;
        fiveReset = resolveReset(win, now);
      } else {
        weekly = used;
        weeklyReset = resolveReset(win, now);
      }
    }

    if (fiveHour == null && weekly == null) {
      return emptySnapshot("codex", "Codex", "warn", "接口没有返回 5h / 周限额窗口");
    }

    const windowed = [fiveHour, weekly].filter((pct): pct is number => pct != null);
    const status = windowed.some((pct) => pct >= 100) ? "warn" : "ok";

    return {
      providerId: "codex",
      providerName: "Codex",
      account: body.plan_type,
      windows: buildWindows({
        "5h": { usedPct: fiveHour, resetAt: fiveReset },
        weekly: { usedPct: weekly, resetAt: weeklyReset },
      }),
      status,
      message: windowed.some((pct) => pct >= 100) ? "配额已用尽" : undefined,
      fetchedAt: new Date(),
    };
  } catch (err) {
    return emptySnapshot("codex", "Codex", "error", describeError(err));
  }
}

export const codexProvider: ProviderDef = {
  id: "codex",
  name: "Codex",
  authHint: AUTH_HINT,
  detect: detectCodex,
  fetch: fetchCodex,
};
