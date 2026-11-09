/** 把一个时间跨度格式化成中文短文本。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "已重置";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} 天 ${restHours} 小时` : `${days} 天`;
}

export function formatUntil(at: Date | undefined, now = Date.now()): string {
  if (!at) return "—";
  return formatDuration(at.getTime() - now);
}

export function formatAgo(at: Date, now = Date.now()): string {
  const diff = now - at.getTime();
  if (diff < 60_000) return "刚刚";
  return `${formatDuration(diff)}前`;
}

export function formatClock(at: Date): string {
  return at.toLocaleTimeString("zh-CN", { hour12: false });
}
