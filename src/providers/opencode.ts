import path from "node:path";

import { envEntry, home, readJson, tildify } from "../lib/credentials.js";
import { bearer, describeError, getJSON } from "../lib/http.js";
import { asRecord, firstNumber, parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

interface GoWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

interface GoUsageResponse {
  usage?: {
    rolling?: GoWindow;
    weekly?: GoWindow;
    monthly?: GoWindow;
  };
}

interface ResolvedKey {
  key: string;
  source: string;
}

/** 从 opencode.db 的 credential 表读取 opencode-go 的 API Key。 */
async function keyFromOpencodeDB(): Promise<ResolvedKey | undefined> {
  const dbPath = path.join(home(), ".local/share/opencode/opencode.db");
  try {
    // 动态导入，避免 Node 不支持时整个 CLI 启动失败。
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare("select value from credential where integration_id = 'opencode-go' and active = 1 limit 1")
        .get() as { value?: string } | undefined;
      if (!row?.value) return undefined;
      const parsed = JSON.parse(row.value) as { key?: string };
      return parsed.key ? { key: parsed.key, source: `${tildify(dbPath)} (credential)` } : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function keyFromConfigFiles(): Promise<ResolvedKey | undefined> {
  type AuthFile = Record<string, { key?: string }>;
  type ConfigFile = {
    provider?: Record<string, { options?: { apiKey?: string } }>;
  };

  for (const dir of [path.join(home(), ".config/opencode"), path.join(home(), ".local/share/opencode")]) {
    const file = path.join(dir, "auth.json");
    const auth = await readJson<AuthFile>(file);
    const key = auth?.["opencode-go"]?.key;
    if (key) return { key, source: tildify(file) };
  }

  for (const dir of [path.join(home(), ".config/opencode"), path.join(home(), ".local/share/opencode")]) {
    const file = path.join(dir, "opencode.json");
    const config = await readJson<ConfigFile>(file);
    const key =
      config?.provider?.["opencode-go"]?.options?.apiKey ?? config?.provider?.["opencode"]?.options?.apiKey;
    if (key) return { key, source: tildify(file) };
  }

  return undefined;
}

async function resolveKey(): Promise<ResolvedKey | undefined> {
  const env = envEntry("OPENCODE_API_KEY");
  if (env) return { key: env.value, source: `环境变量 ${env.name}` };
  return (await keyFromOpencodeDB()) ?? (await keyFromConfigFiles());
}

async function detectOpencode(): Promise<CredentialStatus> {
  const found = await resolveKey();
  if (!found) {
    return {
      available: false,
      hint: "未找到 opencode-go 的 API Key。设置 OPENCODE_API_KEY，或执行 opencode auth login opencode-go",
    };
  }
  return { available: true, source: found.source };
}

function windowFrom(raw: GoWindow | undefined): { usedPct: number | null; resetAt?: Date } {
  if (!raw) return { usedPct: null };
  const rateLimited = raw.status === "rate-limited" || raw.status === "limited";
  const used = rateLimited ? 100 : firstNumber(raw.percent);
  return {
    usedPct: used == null ? null : clampPct(used),
    resetAt: parseTime(raw.resetsAt),
  };
}

async function fetchOpencode(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const found = await resolveKey();
  if (!found) {
    return emptySnapshot(
      "opencode",
      "OpenCode Go",
      "auth",
      "未找到 opencode-go 的 API Key。设置 OPENCODE_API_KEY，或执行 opencode auth login opencode-go。",
    );
  }

  try {
    const body = await getJSON<GoUsageResponse>(USAGE_URL, { headers: bearer(found.key) }, signal);
    const usage = asRecord(body.usage);
    const rolling = windowFrom(usage?.rolling as GoWindow | undefined);
    const weekly = windowFrom(usage?.weekly as GoWindow | undefined);
    const monthly = windowFrom(usage?.monthly as GoWindow | undefined);

    const windowed = [rolling.usedPct, weekly.usedPct, monthly.usedPct].filter(
      (pct): pct is number => pct != null,
    );
    if (windowed.length === 0) {
      return emptySnapshot("opencode", "OpenCode Go", "warn", "接口没有返回配额窗口");
    }

    const status = windowed.some((pct) => pct >= 100) ? "warn" : "ok";

    return {
      providerId: "opencode",
      providerName: "OpenCode Go",
      account: "go",
      windows: buildWindows({
        "5h": rolling,
        weekly,
        monthly,
      }),
      status,
      message: windowed.some((pct) => pct >= 100) ? "配额已用尽" : undefined,
      fetchedAt: new Date(),
    };
  } catch (err) {
    return emptySnapshot("opencode", "OpenCode Go", "error", describeError(err));
  }
}

export const opencodeProvider: ProviderDef = {
  id: "opencode",
  name: "OpenCode Go",
  authHint: "设置 OPENCODE_API_KEY，或执行 opencode auth login opencode-go",
  detect: detectOpencode,
  fetch: fetchOpencode,
};
