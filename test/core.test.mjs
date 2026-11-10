import test from "node:test";
import assert from "node:assert/strict";

import { firstNumber, parseTime } from "../dist/lib/parse.js";
import { formatDuration, formatUntil } from "../dist/lib/time.js";
import { barColor, balanceColor, formatAmount, formatMoney, progressBar, statusDot } from "../dist/lib/ui.js";
import { buildWindows, clampPct } from "../dist/providers/types.js";
import { maskSecret, parseEnvLine } from "../dist/config.js";
import { opencodeConfigDirs, opencodeDataDirs, stripJsonc } from "../dist/lib/credentials.js";
import { sortProvidersByAvailability } from "../dist/providers/registry.js";

test("parseTime 解析 unix 秒", () => {
  assert.equal(parseTime(1_700_000_000)?.toISOString(), "2023-11-14T22:13:20.000Z");
});

test("parseTime 解析 unix 毫秒", () => {
  assert.equal(parseTime(1_700_000_000_000)?.toISOString(), "2023-11-14T22:13:20.000Z");
});

test("parseTime 解析 ISO 字符串", () => {
  assert.equal(parseTime("2026-11-16T00:00:00.000Z")?.toISOString(), "2026-11-16T00:00:00.000Z");
});

test("parseTime 无效输入返回 undefined", () => {
  assert.equal(parseTime(undefined), undefined);
  assert.equal(parseTime(""), undefined);
  assert.equal(parseTime("not-a-date"), undefined);
});

test("firstNumber 跳过非数字", () => {
  assert.equal(firstNumber(undefined, "12", "x"), 12);
  assert.equal(firstNumber("abc"), undefined);
});

test("clampPct 限制在 0-100", () => {
  assert.equal(clampPct(-5), 0);
  assert.equal(clampPct(42), 42);
  assert.equal(clampPct(120), 100);
  assert.equal(clampPct(Number.NaN), 0);
});

test("formatDuration 输出中文时长", () => {
  assert.equal(formatDuration(30_000), "不到 1 分钟");
  assert.equal(formatDuration(5 * 60_000), "5 分钟");
  assert.equal(formatDuration(90 * 60_000), "1 小时 30 分");
  assert.equal(formatDuration(26 * 3_600_000), "1 天 2 小时");
  assert.equal(formatDuration(0), "已重置");
});

test("formatUntil 无时间返回占位符", () => {
  assert.equal(formatUntil(undefined), "—");
});

test("progressBar 按比例填充", () => {
  assert.equal(progressBar(0, 10), "░░░░░░░░░░");
  assert.equal(progressBar(50, 10), "█████░░░░░");
  assert.equal(progressBar(100, 10), "██████████");
  assert.equal(progressBar(150, 10), "██████████");
});

test("barColor 使用 60/85 阈值", () => {
  assert.equal(barColor(0), "green");
  assert.equal(barColor(59.9), "green");
  assert.equal(barColor(60), "yellow");
  assert.equal(barColor(84.9), "yellow");
  assert.equal(barColor(85), "red");
});

test("statusDot 区分状态", () => {
  assert.deepEqual(statusDot(undefined), { symbol: "○", color: "gray" });
  assert.deepEqual(statusDot({ status: "ok" }), { symbol: "●", color: "green" });
  assert.deepEqual(statusDot({ status: "auth" }), { symbol: "○", color: "red" });
  assert.deepEqual(statusDot({ status: "error" }), { symbol: "●", color: "red" });
});

test("buildWindows 固定顺序并补齐缺失窗口", () => {
  const windows = buildWindows({ "5h": { usedPct: 10 } });
  assert.deepEqual(
    windows.map((win) => win.key),
    ["5h", "weekly", "monthly"],
  );
  assert.equal(windows[0].usedPct, 10);
  assert.equal(windows[0].label, "5 小时");
  assert.equal(windows[1].usedPct, null);
  assert.equal(windows[2].label, "本月");
});

test("formatMoney 按币种显示金额", () => {
  assert.equal(formatMoney({ currency: "CNY", total: 45.04 }), "¥45.04");
  assert.equal(formatMoney({ currency: "USD", total: 1.5 }), "$1.50");
  assert.equal(formatMoney({ currency: "JPY", total: 100 }), "¥100.00");
  assert.equal(formatMoney({ currency: "ABC", total: 2 }), "ABC 2.00");
});

test("formatAmount 格式化赠送/充值金额", () => {
  assert.equal(formatAmount("CNY", 0), "¥0.00");
  assert.equal(formatAmount("USD", 10.5), "$10.50");
});

test("balanceColor 按余额高低变色", () => {
  assert.equal(balanceColor(0), "red");
  assert.equal(balanceColor(-1), "red");
  assert.equal(balanceColor(0.01), "yellow");
  assert.equal(balanceColor(4.99), "yellow");
  assert.equal(balanceColor(5), "green");
  assert.equal(balanceColor(100), "green");
});

test("parseEnvLine 解析 KEY=VALUE", () => {
  assert.deepEqual(parseEnvLine("MINIMAX_API_KEY=sk-123"), { key: "MINIMAX_API_KEY", value: "sk-123" });
  assert.deepEqual(parseEnvLine('export ZAI_API_KEY="sk-456"'), { key: "ZAI_API_KEY", value: "sk-456" });
  assert.deepEqual(parseEnvLine("DEEPSEEK_API_KEY='sk-789'"), { key: "DEEPSEEK_API_KEY", value: "sk-789" });
  assert.equal(parseEnvLine("# comment"), null);
  assert.equal(parseEnvLine(""), null);
  assert.equal(parseEnvLine("BAD LINE"), null);
  assert.equal(parseEnvLine("1INVALID=x"), null);
});

test("maskSecret 保留首尾并打码中间", () => {
  assert.equal(maskSecret("sk-1234567890"), "sk-1...7890");
  assert.equal(maskSecret("short"), "****");
});

test("stripJsonc 去除注释和尾逗号", () => {
  const input = `{
    // 行注释
    "url": "https://example.com/a//b",
    /* 块注释 */
    "list": [1, 2, 3,],
  }`;
  assert.deepEqual(JSON.parse(stripJsonc(input)), {
    url: "https://example.com/a//b",
    list: [1, 2, 3],
  });
});

test("sortProvidersByAvailability 有凭据的排前面且组内顺序稳定", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(
    sortProvidersByAvailability(list, new Set(["c", "a"])).map((item) => item.id),
    ["a", "c", "b", "d"],
  );
  assert.deepEqual(
    sortProvidersByAvailability(list, new Set()).map((item) => item.id),
    ["a", "b", "c", "d"],
  );
});

test("opencode 目录候选优先使用 XDG", () => {
  const savedConfig = process.env.XDG_CONFIG_HOME;
  const savedData = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = "/tmp/llm-limit-xdg-config";
  process.env.XDG_DATA_HOME = "/tmp/llm-limit-xdg-data";
  try {
    assert.equal(opencodeConfigDirs()[0], "/tmp/llm-limit-xdg-config/opencode");
    assert.equal(opencodeDataDirs()[0], "/tmp/llm-limit-xdg-data/opencode");
  } finally {
    if (savedConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedConfig;
    if (savedData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedData;
  }
});
