# Provider 接口备忘

本文件固定每个 provider 的请求方式、认证、响应字段和映射规则。接口变动时先改这里，再改 `src/providers/`。

> `llm-limit auth <provider> <key>` 会把 key 写入 `~/.config/llm-limit/.env`，启动时加载为环境变量。下面各 provider 的“环境变量”来源都包含这个文件。

所有 `percent` 统一按 **已用百分比**（0-100）展示；`resetsAt` 统一换算成本地时间。

---

## MiniMax

订阅套餐（M Plan）配额，实测可用。

- **端点**
  - 国际：`GET https://api.minimax.io/v1/token_plan/remains`
  - 中国：`GET https://api.minimax.cn/v1/token_plan/remains`
- **认证**：`Authorization: Bearer <API key>`
- **凭据读取顺序**
  1. `MINIMAX_CN_API_KEY` → 中国区
  2. `MINIMAX_API_KEY` → 国际区
  3. `~/.mmx/config.json` 的 `api_key` + `region`
  4. `~/.local/share/opencode/auth.json` / `account.json` 里 `minimax-cn-coding-plan` 的 key

**响应（实测，2026-11）**

```json
{
  "model_remains": [
    {
      "model_name": "general",
      "start_time": 1794208350184,
      "end_time": 1794226350184,
      "current_interval_remaining_percent": 92,
      "current_interval_status": 1,
      "current_weekly_remaining_percent": 33,
      "current_weekly_status": 1,
      "weekly_end_time": 1794478088329
    }
  ],
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

**映射**

| 窗口 | 字段 | 重置 |
| --- | --- | --- |
| 5 小时 | `100 - current_interval_remaining_percent` | `end_time`（毫秒） |
| 本周 | `100 - current_weekly_remaining_percent` | `weekly_end_time`（毫秒） |

- 优先取 `model_name == "general"` 的 bucket，否则取第一个。
- `*_status == 2` 表示已用尽，强制按 100% 处理。
- 没有百分比时用 `*_usage_count / *_total_count` 兜底。

---

## Z.AI GLM

GLM Coding Plan 配额。接口是订阅管理页内部使用的，没有公开文档。

- **端点**
  - 国际：`GET https://api.z.ai/api/monitor/usage/quota/limit`
  - 中国：`GET https://bigmodel.cn/api/monitor/usage/quota/limit`
- **认证**：`Authorization: <API key>`（**裸 key，没有 Bearer 前缀**）
- **凭据**：`ZAI_API_KEY` / `ZHIPU_API_KEY` / `Z_AI_API_KEY` / `GLM_API_KEY`
- **区域**：`ZAI_REGION=cn` 或 `ZAI_BASE_URL` 覆盖

**响应**

```json
{
  "success": true,
  "code": 200,
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "number": 5,
        "usage": 800000000,
        "currentValue": 127694464,
        "percentage": 15,
        "nextResetTime": 1770648402389
      }
    ]
  }
}
```

**映射**

| 窗口 | 判断 | 已用 |
| --- | --- | --- |
| 5 小时 | `unit == 3` | `percentage`，缺省用 `currentValue / usage * 100` |
| 本周 | `unit == 6` | 同上 |

- `nextResetTime` 是毫秒时间戳。
- 兼容 `data.limits`、顶层 `limits` 两种信封。
- `TIME_LIMIT` 是 Web 搜索次数（月度），首版忽略。

---

## Kimi Code

Kimi Code CLI 的订阅配额，用 OAuth access token 查询。

- **端点**：`GET https://api.kimi.com/coding/v1/usages`
- **认证**：`Authorization: Bearer <access token>`
- **凭据**：`~/.kimi-code/credentials/*.json`（取 mtime 最新；可用 `KIMI_CREDENTIALS_PATH` 覆盖）
- **字段**：`access_token`、`expires_at`（秒）

**响应（新旧两种形状都在用）**

```json
{
  "limits": [
    {
      "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
      "detail": { "limit": "100", "used": "88", "remaining": "12", "resetTime": "2026-10-01T01:58:51Z" }
    }
  ],
  "usage": { "limit": "100", "used": "29", "remaining": "71", "resetTime": "2026-10-02T12:58:51Z" },
  "usages": {
    "limit_5h": { "used_ratio": 0, "reset_time": "2026-10-01T01:58:50Z" },
    "limit_7d": { "used_ratio": 0, "reset_time": "2026-10-02T12:58:50Z" }
  }
}
```

**映射**

| 窗口 | 首选 | 兜底 |
| --- | --- | --- |
| 5 小时 | `limits[duration=300].detail` 的 `used / limit` | `usages.limit_5h.used_ratio` |
| 本周 | `usage` 的 `used / limit` | `usages.limit_7d.used_ratio` |
| 本月 | — | `usages.limit_month_total` / `limit_month_code` |

> 已知问题：部分账号的 `usages.*.used_ratio` 恒为 0，但同一响应里的 counts 是准确的，所以优先用 counts。

---

## Codex / ChatGPT

Codex CLI 的 rate limit，用 OAuth token 查询。接口是 CLI 内部使用的非公开接口。

- **端点**：`GET https://chatgpt.com/backend-api/wham/usage`
- **认证**
  - `Authorization: Bearer <access token>`
  - `ChatGPT-Account-Id: <account id>`（有就带）
- **凭据**：`~/.codex/auth.json`（`CODEX_HOME` 可覆盖）
  - `tokens.access_token`、`tokens.account_id` / `account_id`
- **Base URL**：`CODEX_CHATGPT_BASE_URL` 可覆盖

**响应**

```json
{
  "plan_type": "pro",
  "rate_limit": {
    "primary_window": {
      "used_percent": 34,
      "limit_window_seconds": 18000,
      "reset_at": 1789805712
    },
    "secondary_window": {
      "used_percent": 12,
      "limit_window_seconds": 604800,
      "reset_at": 1790400000
    }
  }
}
```

**映射**

| 窗口 | `limit_window_seconds` |
| --- | --- |
| 5 小时 | `18000` |
| 本周 | `604800` |

- `reset_at` / `resets_at` 是 unix 秒；没有时用 `reset_after_seconds` 相对当前时间计算。
- `used_percent` 缺失时用 `100 - remaining_percent`。

---

## OpenCode Go

OpenCode Go 订阅配额，官方支持用 API Key 查询（实测可用）。

- **端点**：`GET https://opencode.ai/zen/go/v1/usage`
- **认证**：`Authorization: Bearer <API key>`
- **凭据读取顺序**
  1. `OPENCODE_API_KEY`
  2. `~/.local/share/opencode/opencode.db` → `credential` 表，`integration_id = 'opencode-go' AND active = 1`，`json(value).key`
  3. `~/.config/opencode/auth.json` / `~/.local/share/opencode/auth.json` 的 `opencode-go.key`
  4. `~/.config/opencode/opencode.json` 的 `provider.opencode-go.options.apiKey`

**响应（实测，2026-11）**

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 0, "resetsAt": "2026-11-09T12:14:08.000Z" },
    "weekly":  { "status": "ok", "percent": 8, "resetsAt": "2026-11-16T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 9, "resetsAt": "2026-12-05T13:01:01.000Z" }
  }
}
```

**映射**

| 窗口 | 字段 |
| --- | --- |
| 5 小时 | `usage.rolling.percent` |
| 本周 | `usage.weekly.percent` |
| 本月 | `usage.monthly.percent` |

- `percent` 是已用百分比。
- `status == "rate-limited"` 时按 100% 处理。
- `resetsAt` 是 ISO 8601 字符串。

---

## DeepSeek

余额型 provider，没有 5 小时 / 周 / 月窗口，展示账户余额。

- **端点**：`GET https://api.deepseek.com/user/balance`
- **认证**：`Authorization: Bearer <API key>`，`Accept: application/json`
- **凭据读取顺序**
  1. `DEEPSEEK_API_KEY`
  2. `~/.local/share/opencode/auth.json` 的 `deepseek.key`
  3. `~/.local/share/opencode/account.json` 里 `serviceID = "deepseek"` 的 credential
- **Base URL**：`DEEPSEEK_BASE_URL` 可覆盖

**响应（实测，2026-11）**

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "45.04",
      "granted_balance": "0.00",
      "topped_up_balance": "45.04"
    }
  ]
}
```

**映射**

| 展示 | 字段 |
| --- | --- |
| 总余额 | `total_balance` |
| 赠送 | `granted_balance` |
| 充值 | `topped_up_balance` |

- `balance_infos` 可能有多个币种，逐个展示。
- `is_available == false` 时状态为 `warn`。

---

## 备注

- 除 MiniMax 和 OpenCode Go 外，其余接口都来自对应 CLI 的内部实现，厂商可能随时调整。
- 所有请求都走 `fetch`，没有额外 HTTP 依赖；单次请求超时由调用方的 `AbortSignal` 控制。
- 凭据只读，不会写回任何本地文件。
