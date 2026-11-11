import path from "node:path";

import {
  envEntry,
  fileExists,
  opencodeAuthFiles,
  opencodeConfigDirs,
  opencodeDataDirs,
  readJson,
  readJsonc,
  tildify,
} from "../lib/credentials.js";
import { bearer, describeError, getJSON } from "../lib/http.js";
import { asRecord, firstNumber, parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const AUTH_HINT =
  "未找到 opencode-go 的 API Key。执行 llm-quota auth opencode <key>，或设置 OPENCODE_API_KEY；也可以先 opencode auth login opencode-go";

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
  let sqlite: typeof import("node:sqlite");
  try {
    // 动态导入，避免 Node 不支持时整个 CLI 启动失败。
    sqlite = await import("node:sqlite");
  } catch {
    return undefined;
  }

  for (const dir of opencodeDataDirs()) {
    const dbPath = path.join(dir, "opencode.db");
    if (!(await fileExists(dbPath))) continue;

    let db: import("node:sqlite").DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
      const row = db
        .prepare("select value from credential where integration_id = 'opencode-go' and active = 1 limit 1")
        .get() as { value?: string } | undefined;
      if (!row?.value) continue;
      const parsed = JSON.parse(row.value) as { key?: string };
      if (parsed.key) return { key: parsed.key, source: `${tildify(dbPath)} (credential)` };
    } catch {
      // 打不开或查询失败时尝试下一个候选
    } finally {
      db?.close();
    }
  }
  return undefined;
}

/** OpenCode 配置里的 provider API Key：兼容 V2 的 providers[].settings 和 V1 的 provider[].options。 */
interface ConfigFile {
  provider?: Record<string, { options?: { apiKey?: string } }>;
  providers?: Record<string, { settings?: { apiKey?: string } }>;
}

function configApiKey(config: ConfigFile | null): string | undefined {
  for (const id of ["opencode-go", "opencode"]) {
    const key = config?.providers?.[id]?.settings?.apiKey ?? config?.provider?.[id]?.options?.apiKey;
    if (key) return key;
  }
  return undefined;
}

async function keyFromConfigFiles(): Promise<ResolvedKey | undefined> {
  type AuthFile = Record<string, { key?: string }>;

  for (const file of opencodeAuthFiles()) {
    const auth = await readJson<AuthFile>(file);
    const key = auth?.["opencode-go"]?.key;
    if (key) return { key, source: tildify(file) };
  }

  for (const dir of opencodeConfigDirs()) {
    for (const name of ["opencode.jsonc", "opencode.json"]) {
      const file = path.join(dir, name);
      const key = configApiKey(await readJsonc<ConfigFile>(file));
      if (key) return { key, source: tildify(file) };
    }
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
    return { available: false, hint: AUTH_HINT };
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
    return emptySnapshot("opencode", "OpenCode Go", "auth", AUTH_HINT);
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
  authHint: AUTH_HINT,
  detect: detectOpencode,
  fetch: fetchOpencode,
};
