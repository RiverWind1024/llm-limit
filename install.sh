#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node 20+（推荐 22+）。" >&2
  exit 1
fi

major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$major" -lt 20 ]; then
  echo "需要 Node.js 20+，当前是 $(node -v)。" >&2
  exit 1
fi

echo "==> 安装依赖"
npm install

echo "==> 全局安装"
npm install -g .

echo "==> 扫描本机凭据"
node --no-warnings dist/cli.js --init

echo
echo "完成。现在在任意目录运行 llm-limit 即可。"
