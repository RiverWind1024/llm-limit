import { envFile, listEnvValues, maskSecret, removeEnvValue, setEnvValue } from "./config.js";

interface AuthTarget {
  env: string;
  label: string;
}

/** 支持用 API Key 认证的 provider；OAuth 型（Kimi / Codex）走各自 CLI 登录。 */
const AUTH_TARGETS: Record<string, AuthTarget> = {
  minimax: { env: "MINIMAX_API_KEY", label: "MiniMax（国际区）" },
  "minimax-cn": { env: "MINIMAX_CN_API_KEY", label: "MiniMax（中国区）" },
  zai: { env: "ZAI_API_KEY", label: "Z.AI GLM" },
  opencode: { env: "OPENCODE_API_KEY", label: "OpenCode Go" },
  deepseek: { env: "DEEPSEEK_API_KEY", label: "DeepSeek" },
};

const OAUTH_ONLY = new Set(["kimi", "codex"]);

function usage(): string {
  return [
    "用法:",
    "  llm-quota auth <provider> <api-key>        保存 API Key",
    "  llm-quota auth minimax <api-key> --region cn",
    "  llm-quota auth list                       列出已保存的 Key",
    "  llm-quota auth remove <provider>          删除 Key",
    "",
    `provider: ${Object.keys(AUTH_TARGETS).join(", ")}`,
    `存储位置: ${envFile()}`,
    "",
    "Kimi / Codex 使用 OAuth，请分别执行 kimi / codex 的登录命令。",
  ].join("\n");
}

function resolveTarget(provider: string, region: string | undefined): AuthTarget | undefined {
  if (provider === "minimax" && (region === "cn" || region === "china")) {
    return AUTH_TARGETS["minimax-cn"];
  }
  return AUTH_TARGETS[provider];
}

async function listKeys(): Promise<void> {
  const entries = await listEnvValues();
  if (entries.length === 0) {
    console.log(`尚未保存任何 Key（${envFile()}）。`);
    return;
  }
  console.log(envFile());
  for (const { key, value } of entries) {
    console.log(`  ${key.padEnd(24)} ${maskSecret(value)}`);
  }
}

async function removeKey(provider: string, region: string | undefined): Promise<void> {
  const target = resolveTarget(provider, region);
  if (!target) {
    console.error(`未知 provider: ${provider}`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  const removed = await removeEnvValue(target.env);
  if (removed) {
    console.log(`✓ 已删除 ${target.label} 的 ${target.env}`);
  } else {
    console.log(`没有找到 ${target.env}，无需删除。`);
  }
}

async function saveKey(provider: string, key: string, region: string | undefined): Promise<void> {
  if (OAUTH_ONLY.has(provider)) {
    console.error(`${provider} 使用 OAuth，不能用 API Key 保存。`);
    console.error(`请执行 ${provider} 的登录命令后重试。`);
    process.exitCode = 1;
    return;
  }

  const target = resolveTarget(provider, region);
  if (!target) {
    console.error(`未知 provider: ${provider}`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  await setEnvValue(target.env, key);
  console.log(`✓ 已保存 ${target.label} 的 Key`);
  console.log(`  ${target.env} = ${maskSecret(key)}`);
  console.log(`  文件: ${envFile()}`);
  console.log("下次运行 llm-quota 时生效。");
}

export async function runAuth(args: string[]): Promise<void> {
  const positional: string[] = [];
  let region: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--region" || arg === "-r") {
      region = args[++i]?.toLowerCase();
    } else {
      positional.push(arg);
    }
  }

  const [first, second] = positional;

  if (!first || first === "list" || first === "ls") {
    await listKeys();
    return;
  }

  if (first === "remove" || first === "rm") {
    if (!second) {
      console.error("用法: llm-quota auth remove <provider>");
      process.exitCode = 1;
      return;
    }
    await removeKey(second, region);
    return;
  }

  if (!second) {
    console.error(`缺少 API Key。用法: llm-quota auth ${first} <api-key>`);
    process.exitCode = 1;
    return;
  }

  await saveKey(first, second, region);
}
