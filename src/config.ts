import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { xdgConfigHome } from "./lib/credentials.js";

/** 配置目录：XDG_CONFIG_HOME/llm-limit，回退到 ~/.config/llm-limit。 */
export function configDir(): string {
  return path.join(xdgConfigHome(), "llm-limit");
}

export function envFile(): string {
  return path.join(configDir(), ".env");
}

/** 解析一行 KEY=VALUE，支持 export 前缀、引号和注释。 */
export function parseEnvLine(line: string): { key: string; value: string } | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/** 启动时加载保存的 key；真实环境变量优先，不会被覆盖。 */
export async function loadEnvFile(): Promise<void> {
  let text: string;
  try {
    text = await readFile(envFile(), "utf8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

async function readEntries(): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  try {
    const text = await readFile(envFile(), "utf8");
    for (const line of text.split("\n")) {
      const parsed = parseEnvLine(line);
      if (parsed) entries.set(parsed.key, parsed.value);
    }
  } catch {
    // 文件不存在时返回空集合
  }
  return entries;
}

async function writeEntries(entries: Map<string, string>): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const lines = ["# llm-limit credentials (generated)", ...Array.from(entries, ([key, value]) => `${key}=${value}`), ""];
  await writeFile(envFile(), lines.join("\n"), { mode: 0o600 });
  await chmod(envFile(), 0o600);
}

export async function setEnvValue(key: string, value: string): Promise<void> {
  const entries = await readEntries();
  entries.set(key, value);
  await writeEntries(entries);
}

export async function removeEnvValue(key: string): Promise<boolean> {
  const entries = await readEntries();
  const existed = entries.delete(key);
  if (existed) await writeEntries(entries);
  return existed;
}

export async function listEnvValues(): Promise<Array<{ key: string; value: string }>> {
  const entries = await readEntries();
  return Array.from(entries, ([key, value]) => ({ key, value }));
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
