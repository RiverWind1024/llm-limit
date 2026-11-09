import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function home(): string {
  return homedir();
}

export function envEntry(...names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

export function envValue(...names: string[]): string | undefined {
  return envEntry(...names)?.value;
}

/** 把绝对路径缩写成 ~/... 形式，便于展示。 */
export function tildify(filePath: string): string {
  const root = home();
  return filePath.startsWith(root) ? `~${filePath.slice(root.length)}` : filePath;
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 返回目录下最新的 .json 文件路径（按 mtime）。 */
export async function newestJsonFile(dir: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  let newest: { file: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (path.extname(entry) !== ".json") continue;
    const full = path.join(dir, entry);
    try {
      const info = await stat(full);
      if (!newest || info.mtimeMs > newest.mtime) {
        newest = { file: full, mtime: info.mtimeMs };
      }
    } catch {
      // 忽略无法读取的文件
    }
  }
  return newest?.file ?? null;
}

/** 从 opencode 的 account.json 读取某个 serviceID 的 key。 */
export async function opencodeAccountKey(serviceID: string): Promise<string | undefined> {
  type AccountFile = {
    accounts?: Record<string, { serviceID?: string; credential?: { key?: string } }>;
  };
  const file = await readJson<AccountFile>(path.join(home(), ".local/share/opencode/account.json"));
  if (!file?.accounts) return undefined;
  for (const account of Object.values(file.accounts)) {
    if (account.serviceID === serviceID && account.credential?.key) {
      return account.credential.key;
    }
  }
  return undefined;
}

/** 从 opencode auth.json 读取某个 provider 的 key。 */
export async function opencodeAuthKey(providerID: string): Promise<string | undefined> {
  type AuthFile = Record<string, { type?: string; key?: string }>;
  const file = await readJson<AuthFile>(path.join(home(), ".local/share/opencode/auth.json"));
  return file?.[providerID]?.key;
}
