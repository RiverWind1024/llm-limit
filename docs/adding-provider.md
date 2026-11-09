# 新增一个 provider

整个工具的分层很简单：`providers/` 只负责“取数 + 解析”，UI 只消费统一的 `ProviderSnapshot`。新增 provider 不需要动界面。

## 0. 先固定接口

在 [`docs/providers.md`](providers.md) 里补一节，写清楚：

- 端点 URL
- 认证方式（Bearer / 裸 key / OAuth token）
- 凭据从哪读
- 一份真实响应示例
- 字段到「5 小时 / 周 / 月」的映射
- 重置时间字段和单位（秒 / 毫秒 / ISO）

接口没固定之前不要写解析代码，否则后面会反复改。

## 1. 新建 provider 文件

在 `src/providers/` 下建 `<id>.ts`，实现 `ProviderDef`：

```ts
import { envValue } from "../lib/credentials.js";
import { bearer, describeError, getJSON } from "../lib/http.js";
import { firstNumber, parseTime } from "../lib/parse.js";
import { buildWindows, clampPct, emptySnapshot, type CredentialStatus, type ProviderDef, type ProviderSnapshot } from "./types.js";

interface Resp {
  five_hour?: { used: number; reset_at?: string };
  weekly?: { used: number; reset_at?: string };
}

async function fetchExample(signal?: AbortSignal): Promise<ProviderSnapshot> {
  const key = envValue("EXAMPLE_API_KEY");
  if (!key) {
    return emptySnapshot("example", "Example", "auth", "未找到 EXAMPLE_API_KEY");
  }

  try {
    const body = await getJSON<Resp>(
      "https://api.example.com/usage",
      { headers: bearer(key) },
      signal,
    );

    const fiveHour = firstNumber(body.five_hour?.used);
    const weekly = firstNumber(body.weekly?.used);

    return {
      providerId: "example",
      providerName: "Example",
      account: "default",
      windows: buildWindows({
        "5h": { usedPct: fiveHour == null ? null : clampPct(fiveHour), resetAt: parseTime(body.five_hour?.reset_at) },
        weekly: { usedPct: weekly == null ? null : clampPct(weekly), resetAt: parseTime(body.weekly?.reset_at) },
      }),
      status: "ok",
      fetchedAt: new Date(),
    };
  } catch (err) {
    return emptySnapshot("example", "Example", "error", describeError(err));
  }
}

```ts
async function detectExample(): Promise<CredentialStatus> {
  const key = envValue("EXAMPLE_API_KEY");
  return key
    ? { available: true, source: "环境变量 EXAMPLE_API_KEY" }
    : { available: false, hint: "设置 EXAMPLE_API_KEY" };
}

export const exampleProvider: ProviderDef = {
  id: "example",
  name: "Example",
  authHint: "设置 EXAMPLE_API_KEY",
  detect: detectExample,
  fetch: fetchExample,
};
```

## 2. 注册

在 `src/providers/registry.ts` 里 import 并加入 `providers` 数组：

```ts
import { exampleProvider } from "./example.js";

export const providers: ProviderDef[] = [
  minimaxProvider,
  zaiProvider,
  kimiProvider,
  codexProvider,
  opencodeProvider,
  exampleProvider, // 新 provider 放最后，快捷键按顺序自动分配
];
```

数组顺序就是界面里的顺序和 `1-9` 快捷键顺序。

## 3. 约定

- **百分比统一是「已用」**：`usedPct` 取 0-100。接口给的是“剩余”就自己转成 `100 - remaining`。
- **缺失窗口用 `null`**：`buildWindows` 会自动补 `5h / weekly / monthly`，没返回的传 `null`，UI 会显示“未返回该窗口”。
- **重置时间用 `Date`**：`parseTime()` 兼容 unix 秒、unix 毫秒和 ISO 字符串。
- **不要抛异常**：网络错误、鉴权失败都要 catch 住，返回 `status: "auth" | "error"` 的快照，UI 才能继续切换其他 provider。
- **`detect()` 只查本地凭据**：不发网络请求，返回 `available` / `source` / `hint`。`--init` 的扫描结果就来自它。
- **支持 API Key 的 provider**：在 `src/auth.ts` 的 `AUTH_TARGETS` 里加一行映射（provider id → 环境变量名），这样 `llm-limit auth <id> <key>` 才能保存。OAuth 型 provider 不要加。
- **余额型 provider**：如果接口返回的是金额而不是窗口配额（例如 DeepSeek），返回 `windows: []`，把金额放进 `balances`：
  ```ts
  balances: [{ currency: "CNY", total: 45.04, granted: 0, toppedUp: 45.04 }]
  ```
  UI 会自动渲染余额行，不需要窗口。
- **不要打印凭据**：只读取，不写回，不进日志。
- **状态语义**：
  - `ok`：正常
  - `warn`：配额接近或已经用尽
  - `auth`：没有凭据或凭据失效（界面会显示 `authHint`）
  - `error`：接口失败

## 4. 验证

```bash
npm run dev -- example --once       # 文本输出
npm run dev -- example --json       # 检查字段
npm run dev -- --init               # 确认扫描结果
npm run dev                         # 界面里确认切换和颜色
npm run build                       # 类型检查 + 编译
```

## 5. 顺手更新文档

- `docs/providers.md`：接口细节
- `README.md`：支持情况表格
