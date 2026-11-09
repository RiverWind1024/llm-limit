import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { providers } from "./providers/registry.js";
import type { CredentialStatus } from "./providers/types.js";

/** 源码运行时是项目根，全局安装后是全局包目录。 */
function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

async function installGlobally(): Promise<void> {
  const root = projectRoot();
  const fromSource = existsSync(path.join(root, "src")) && existsSync(path.join(root, "package.json"));

  console.log("全局安装");
  if (!fromSource) {
    console.log("  ✓ 已是全局安装，跳过");
    return;
  }

  console.log(`  → npm install -g ${root}`);
  try {
    await run("npm", ["install", "-g", root]);
    console.log("  ✓ 安装完成");
  } catch (err) {
    console.log(`  ! 安装失败：${err instanceof Error ? err.message : String(err)}`);
    console.log("    可以手动执行 npm install -g .");
  }
}

async function detectSafely(provider: (typeof providers)[number]): Promise<CredentialStatus> {
  try {
    return await provider.detect();
  } catch (err) {
    return { available: false, hint: err instanceof Error ? err.message : String(err) };
  }
}

async function scan(): Promise<number> {
  console.log("\nProvider 凭据扫描");
  let available = 0;

  for (const provider of providers) {
    const status = await detectSafely(provider);
    if (status.available) {
      available++;
      const detail = [status.source, status.detail].filter(Boolean).join(" · ");
      console.log(`  ✓ ${provider.name.padEnd(12)} ${detail || "已配置"}`);
    } else {
      console.log(`  ✗ ${provider.name.padEnd(12)} ${status.hint ?? provider.authHint}`);
    }
  }

  return available;
}

export async function runInit(): Promise<void> {
  console.log("llm-limit 初始化\n");
  await installGlobally();

  const available = await scan();
  console.log(`\n可用 ${available}/${providers.length} 个 provider。`);

  if (available === 0) {
    console.log("先配置至少一个凭据，然后运行 llm-limit。");
    return;
  }
  console.log("运行 llm-limit 开始使用；用 llm-limit <provider> --once 验证单个 provider。");
}
