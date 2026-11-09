import { codexProvider } from "./codex.js";
import { kimiProvider } from "./kimi.js";
import { minimaxProvider } from "./minimax.js";
import { opencodeProvider } from "./opencode.js";
import { zaiProvider } from "./zai.js";
import type { ProviderDef } from "./types.js";

/** 展示顺序与快捷键 1-5 对应。 */
export const providers: ProviderDef[] = [
  minimaxProvider,
  zaiProvider,
  kimiProvider,
  codexProvider,
  opencodeProvider,
];

export function findProvider(idOrName: string): ProviderDef | undefined {
  const needle = idOrName.trim().toLowerCase();
  return providers.find(
    (provider) => provider.id === needle || provider.name.toLowerCase() === needle,
  );
}

export { type ProviderDef, type ProviderSnapshot, type UsageWindow } from "./types.js";
