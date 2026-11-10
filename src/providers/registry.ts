import { codexProvider } from "./codex.js";
import { deepseekProvider } from "./deepseek.js";
import { kimiProvider } from "./kimi.js";
import { minimaxProvider } from "./minimax.js";
import { opencodeProvider } from "./opencode.js";
import { zaiProvider } from "./zai.js";
import type { ProviderDef } from "./types.js";

/** 展示顺序与快捷键 1-6 对应。 */
export const providers: ProviderDef[] = [
  minimaxProvider,
  zaiProvider,
  kimiProvider,
  codexProvider,
  opencodeProvider,
  deepseekProvider,
];

export function findProvider(idOrName: string): ProviderDef | undefined {
  const needle = idOrName.trim().toLowerCase();
  return providers.find(
    (provider) => provider.id === needle || provider.name.toLowerCase() === needle,
  );
}

/**
 * 按凭据可用性排序：有凭据的 provider 排在前面，组内保持原顺序。
 * 用于交互界面让能出数据的 provider 优先展示，减少切换次数。
 */
export function sortProvidersByAvailability(
  list: ProviderDef[],
  available: ReadonlySet<string>,
): ProviderDef[] {
  return [...list].sort((a, b) => {
    const aRank = available.has(a.id) ? 0 : 1;
    const bRank = available.has(b.id) ? 0 : 1;
    return aRank - bRank;
  });
}

export { type ProviderDef, type ProviderSnapshot, type UsageWindow } from "./types.js";
