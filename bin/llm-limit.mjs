#!/usr/bin/env node
// 用 --no-warnings 启动真正的 CLI，避免 node:sqlite 的 ExperimentalWarning 污染 TUI。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(major) || major < 20) {
  console.error(`llm-limit 需要 Node.js 20+，当前是 ${process.versions.node}。`);
  console.error("升级 Node 后重新执行 npm install -g .");
  process.exit(1);
}

const entry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const child = spawn(process.execPath, ["--no-warnings", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
