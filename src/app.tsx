import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

import { providers } from "./providers/registry.js";
import type { ProviderSnapshot } from "./providers/types.js";
import { formatAgo, formatClock, formatUntil } from "./lib/time.js";
import { balanceColor, barColor, formatAmount, formatMoney, progressBar, statusDot } from "./lib/ui.js";

const CACHE_TTL_MS = 30_000;
const AUTO_REFRESH_MS = 60_000;

interface AppProps {
  initialProviderId?: string;
}

export function App({ initialProviderId }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = (stdout as unknown as { columns?: number })?.columns ?? process.stdout.columns ?? 80;

  const initialIndex = Math.max(
    0,
    providers.findIndex((provider) => provider.id === initialProviderId),
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [snapshots, setSnapshots] = useState<Record<string, ProviderSnapshot>>({});
  const [loading, setLoading] = useState(false);

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  const requestToken = useRef(0);

  const load = useCallback(async (providerId: string, force: boolean) => {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;

    const cached = snapshotsRef.current[providerId];
    if (!force && cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) return;

    const token = ++requestToken.current;
    setLoading(true);
    try {
      const snapshot = await provider.fetch();
      if (token !== requestToken.current) return;
      setSnapshots((prev) => ({ ...prev, [providerId]: snapshot }));
    } finally {
      if (token === requestToken.current) setLoading(false);
    }
  }, []);

  const active = providers[activeIndex];
  const snapshot = snapshots[active.id];

  // 切换 provider 时按需拉取
  useEffect(() => {
    void load(active.id, false);
  }, [active.id, load]);

  // 自动刷新当前 provider
  useEffect(() => {
    const timer = setInterval(() => {
      void load(active.id, true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active.id, load]);

  useInput((input, key) => {
    if (input === "q" || key.escape || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (key.leftArrow || (key.shift && key.tab) || input === "h") {
      setActiveIndex((index) => (index - 1 + providers.length) % providers.length);
      return;
    }
    if (key.rightArrow || key.tab || input === "l") {
      setActiveIndex((index) => (index + 1) % providers.length);
      return;
    }
    if (/^[1-9]$/.test(input)) {
      const index = Number(input) - 1;
      if (index < providers.length) setActiveIndex(index);
      return;
    }
    if (input === "r") {
      void load(active.id, true);
    }
  });

  const barWidth = Math.max(12, Math.min(40, columns - 62));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          llm-limit
        </Text>
        <Text dimColor>{loading ? "刷新中…" : snapshot ? `更新于 ${formatClock(snapshot.fetchedAt)}` : ""}</Text>
      </Box>

      <Box marginTop={1} flexWrap="wrap">
        {providers.map((provider, index) => {
          const dot = statusDot(snapshots[provider.id]);
          const selected = index === activeIndex;
          return (
            <Box key={provider.id} marginRight={1}>
              <Text color={selected ? "cyan" : "gray"} bold={selected} inverse={selected}>
                {" "}
                {index + 1} {dot.symbol} {provider.name}{" "}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="white">
            {active.name}
          </Text>
          <Text dimColor>
            {snapshot?.account ? `${snapshot.account} · ` : ""}
            {snapshot ? formatAgo(snapshot.fetchedAt) : ""}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {!snapshot ? <Text dimColor>加载中…</Text> : null}

          {snapshot?.balances?.map((balance) => (
            <Box key={balance.currency}>
              <Text>余额     </Text>
              <Text bold color={balanceColor(balance.total)}>
                {formatMoney(balance)}
              </Text>
              {balance.granted != null || balance.toppedUp != null ? (
                <Text dimColor>
                  {"  "}赠送 {formatAmount(balance.currency, balance.granted ?? 0)}
                  {"  "}充值 {formatAmount(balance.currency, balance.toppedUp ?? 0)}
                </Text>
              ) : null}
            </Box>
          ))}

          {snapshot && snapshot.status !== "auth" && snapshot.status !== "error"
            ? snapshot.windows
                .filter((win) => win.key !== "monthly" || win.usedPct != null)
                .map((win) => {
                  if (win.usedPct == null) {
                    return (
                      <Box key={win.key}>
                        <Text dimColor>{win.label.padEnd(6)} —  未返回该窗口</Text>
                      </Box>
                    );
                  }
                  return (
                    <Box key={win.key}>
                      <Text>
                        {win.label.padEnd(6)} <Text color={barColor(win.usedPct)}>{progressBar(win.usedPct, barWidth)}</Text>
                        {"  "}已用 {String(Math.round(win.usedPct)).padStart(3)}%{"  "}剩{" "}
                        {String(100 - Math.round(win.usedPct)).padStart(3)}%{"  "}
                      </Text>
                      <Text dimColor>{win.resetAt ? `重置 ${formatUntil(win.resetAt)}` : ""}</Text>
                    </Box>
                  );
                })
            : null}
        </Box>

        {snapshot && snapshot.status === "warn" && snapshot.message ? (
          <Box marginTop={1}>
            <Text color="yellow">! {snapshot.message}</Text>
          </Box>
        ) : null}

        {snapshot && snapshot.status === "error" && snapshot.message ? (
          <Box marginTop={1}>
            <Text color="red">! {snapshot.message}</Text>
          </Box>
        ) : null}

        {snapshot && (snapshot.status === "auth" || snapshot.status === "error") ? (
          <Box marginTop={snapshot.status === "auth" ? 1 : 0}>
            <Text dimColor>{active.authHint}</Text>
          </Box>
        ) : null}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>←/→ 切换   r 刷新   1-{providers.length} 直达   q 退出   自动刷新 60s</Text>
      </Box>
    </Box>
  );
}
