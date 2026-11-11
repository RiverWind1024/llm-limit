import "./lib/check-node.js";
import { render } from "ink";
import { App } from "./app.js";
import { runAuth } from "./auth.js";
import { loadEnvFile } from "./config.js";
import { runInit } from "./init.js";
import { findProvider, providers } from "./providers/registry.js";
import type { ProviderSnapshot } from "./providers/types.js";
import { formatAmount, formatMoney, progressBar } from "./lib/ui.js";
import { formatUntil } from "./lib/time.js";

const VERSION = "0.1.0";

interface Options {
  providerId?: string;
  json: boolean;
  once: boolean;
  help: boolean;
  version: boolean;
  init: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { json: false, once: false, help: false, version: false, init: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--provider":
      case "-p":
        options.providerId = argv[++i];
        break;
      case "--json":
        options.json = true;
        options.once = true;
        break;
      case "--once":
      case "--text":
        options.once = true;
        break;
      case "--init":
        options.init = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      default:
        if (!arg.startsWith("-")) positional.push(arg);
        break;
    }
  }

  if (!options.providerId && positional.length > 0) {
    options.providerId = positional[0];
  }
  return options;
}

function helpText(): string {
  return [
    "llm-quota — 查看 AI 编程工具订阅的 5 小时 / 周限额",
    "",
    "用法:",
    "  llm-quota                    进入交互界面",
    "  llm-quota <provider>         直接打开指定 provider",
    "  llm-quota <provider> --once  打印一次文本后退出",
    "  llm-quota --init             全局安装并扫描各 provider 凭据",
    "  llm-quota --json             以 JSON 输出所有 provider 的配额",
    "",
    "认证:",
    "  llm-quota auth <provider> <api-key>   保存 API Key",
    "  llm-quota auth minimax <key> --region cn",
    "  llm-quota auth list                   列出已保存的 Key",
    "  llm-quota auth remove <provider>      删除 Key",
    "",
    `provider: ${providers.map((provider) => provider.id).join(", ")}`,
    "",
    "选项:",
    "  -p, --provider <id>  指定 provider",
    "      --init           全局安装并扫描凭据",
    "      --once           非交互模式，打印文本",
    "      --json           JSON 输出（隐含 --once）",
    "  -h, --help           帮助",
    "  -v, --version        版本",
    "",
    "环境变量:",
    "  MINIMAX_API_KEY / MINIMAX_CN_API_KEY",
    "  ZAI_API_KEY（中国区加 ZAI_REGION=cn）",
    "  OPENCODE_API_KEY",
    "  KIMI_CREDENTIALS_PATH、CODEX_HOME",
  ].join("\n");
}

function textBlock(snapshot: ProviderSnapshot): string {
  const head = `${snapshot.providerName}${snapshot.account ? ` (${snapshot.account})` : ""}`;
  const lines = [head];

  for (const balance of snapshot.balances ?? []) {
    const extras: string[] = [];
    if (balance.granted != null) extras.push(`赠送 ${formatAmount(balance.currency, balance.granted)}`);
    if (balance.toppedUp != null) extras.push(`充值 ${formatAmount(balance.currency, balance.toppedUp)}`);
    lines.push(`  余额     ${formatMoney(balance)}${extras.length > 0 ? `  ${extras.join("  ")}` : ""}`);
  }

  for (const win of snapshot.windows) {
    if (win.key === "monthly" && win.usedPct == null) continue;
    if (win.usedPct == null) {
      lines.push(`  ${win.label.padEnd(6)} —  未返回该窗口`);
      continue;
    }
    const used = Math.round(win.usedPct);
    const reset = win.resetAt ? `  重置 ${formatUntil(win.resetAt)}` : "";
    lines.push(
      `  ${win.label.padEnd(6)} ${progressBar(win.usedPct, 24)}  已用 ${String(used).padStart(3)}%  剩 ${String(100 - used).padStart(3)}%${reset}`,
    );
  }
  if (snapshot.status !== "ok" && snapshot.message) {
    lines.push(`  ! ${snapshot.message}`);
  }
  return lines.join("\n");
}

async function runOnce(options: Options): Promise<void> {
  const target = options.providerId ? findProvider(options.providerId) : undefined;
  const targets = options.providerId ? (target ? [target] : []) : providers;

  if (targets.length === 0) {
    console.error(`未知 provider: ${options.providerId}`);
    console.error(`可选值: ${providers.map((provider) => provider.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const snapshots = await Promise.all(targets.map((provider) => provider.fetch()));

  if (options.json) {
    const payload = options.providerId ? snapshots[0] : snapshots;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(snapshots.map(textBlock).join("\n\n"));
}

async function runTui(initialProviderId?: string): Promise<void> {
  if (!process.stdout.isTTY) {
    await runOnce({ providerId: initialProviderId, json: false, once: true, help: false, version: false, init: false });
    return;
  }

  process.stdout.write("\x1b[?1049h\x1b[?25l");
  const instance = render(<App initialProviderId={initialProviderId} />, { patchConsole: false });
  try {
    await instance.waitUntilExit();
  } finally {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs[0] === "auth") {
    await runAuth(rawArgs.slice(1));
    return;
  }

  await loadEnvFile();
  const options = parseArgs(rawArgs);

  if (options.help) {
    console.log(helpText());
    return;
  }
  if (options.version) {
    console.log(VERSION);
    return;
  }
  if (options.init) {
    await runInit();
    return;
  }

  if (options.providerId && !findProvider(options.providerId)) {
    console.error(`未知 provider: ${options.providerId}`);
    console.error(`可选值: ${providers.map((provider) => provider.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (options.once) {
    await runOnce(options);
    return;
  }

  await runTui(options.providerId);
}

await main();
