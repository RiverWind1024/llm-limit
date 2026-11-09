import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function home(): string {
  return homedir();
}

/** XDG 配置根目录；Windows 回退到 APPDATA。 */
export function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME?.trim() || process.env.APPDATA?.trim() || path.join(home(), ".config");
}

/** XDG 数据根目录。 */
export function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME?.trim() || path.join(home(), ".local", "share");
}

function uniqueDirs(dirs: string[]): string[] {
  return Array.from(new Set(dirs));
}

/** OpenCode 全局配置目录候选：XDG 优先，兼容传统 ~/.config。 */
export function opencodeConfigDirs(): string[] {
  return uniqueDirs([path.join(xdgConfigHome(), "opencode"), path.join(home(), ".config", "opencode")]);
}

/** OpenCode 数据目录候选：XDG 优先，兼容传统 ~/.local/share。 */
export function opencodeDataDirs(): string[] {
  return uniqueDirs([path.join(xdgDataHome(), "opencode"), path.join(home(), ".local", "share", "opencode")]);
}

/** OpenCode auth.json 候选文件：数据目录优先，其次配置目录。 */
export function opencodeAuthFiles(): string[] {
  return [...opencodeDataDirs(), ...opencodeConfigDirs()].map((dir) => path.join(dir, "auth.json"));
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

/** 去掉 JSONC 的注释和尾逗号；字符串字面量内的内容保持不变。 */
export function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      } else if (ch === "\n") {
        out += ch;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        if (next !== undefined) out += next;
        i++;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      out = out.replace(/,\s*$/, "");
    }
    out += ch;
  }
  return out;
}

/** 读取 JSON 或 JSONC 文件。 */
export async function readJsonc<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(stripJsonc(await readFile(filePath, "utf8"))) as T;
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

export interface LocatedKey {
  key: string;
  /** 展示用的来源路径，例如 ~/.local/share/opencode/auth.json */
  source: string;
}

/** 从 opencode 的 account.json 读取某个 serviceID 的 key。 */
export async function opencodeAccountKey(serviceID: string): Promise<LocatedKey | undefined> {
  type AccountFile = {
    accounts?: Record<string, { serviceID?: string; credential?: { key?: string } }>;
  };
  for (const dir of opencodeDataDirs()) {
    const file = path.join(dir, "account.json");
    const data = await readJson<AccountFile>(file);
    if (!data?.accounts) continue;
    for (const account of Object.values(data.accounts)) {
      if (account.serviceID === serviceID && account.credential?.key) {
        return { key: account.credential.key, source: tildify(file) };
      }
    }
  }
  return undefined;
}

/** 从 opencode auth.json 读取某个 provider 的 key。 */
export async function opencodeAuthKey(providerID: string): Promise<LocatedKey | undefined> {
  type AuthFile = Record<string, { type?: string; key?: string }>;
  for (const file of opencodeAuthFiles()) {
    const auth = await readJson<AuthFile>(file);
    const key = auth?.[providerID]?.key;
    if (key) return { key, source: tildify(file) };
  }
  return undefined;
}
