# llm-limit

查看 AI 编程工具订阅额度的终端小工具：一个界面里切换 provider，直接看 **5 小时** 和 **周** 限额，附带重置倒计时。

灵感来自 [openusage](https://github.com/janekbaraniewski/openusage) 和 `mmx quota show`，但只做额度展示，不做历史统计。

```
 llm-limit                                                          刚刚

  1 ● MiniMax   2 ○ Z.AI GLM   3 ○ Kimi Code   4 ○ Codex   5 ● OpenCode Go

 ╭──────────────────────────────────────────────────────────────────────╮
 │ MiniMax                                          minimax-cn · 刚刚    │
 │                                                                      │
 │ 5 小时   ██░░░░░░░░░░░░░░░░░░░░░░  已用   8%  剩  92%  重置 4 小时 33 分
 │ 本周     ████████████░░░░░░░░░░░░  已用  67%  剩  33%  重置 3 天 2 小时
 ╰──────────────────────────────────────────────────────────────────────╯

 ←/→ 切换   r 刷新   1-6 直达   q 退出   自动刷新 60s
```

## 快速开始

```bash
git clone https://github.com/RiverWind1024/llm-limit.git
cd llm-limit
./install.sh
```

脚本会安装依赖、全局安装并扫描本机凭据。完成后在任意目录运行 `llm-limit`。

不想用脚本，就手动执行：

```bash
npm install
npm run dev -- --init
```

`--init` 会自动完成全局安装并检测各 provider 的凭据。首次配置 Key：

```bash
llm-limit auth minimax sk-...
```

## 支持情况

| # | Provider | 类型 | 5 小时 | 周 | 月 | 凭据来源 | 验证状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | MiniMax | 窗口 | ✅ | ✅ | — | `MINIMAX_*_API_KEY`、`~/.mmx/config.json`、opencode 凭据 | ✅ 已验证 |
| 2 | Z.AI GLM | 窗口 | ✅ | ✅ | — | `ZAI_API_KEY` | ⏳ 未验证 |
| 3 | Kimi Code | 窗口 | ✅ | ✅ | ✅ | `~/.kimi-code/credentials` | ⏳ 未验证 |
| 4 | Codex | 窗口 | ✅ | ✅ | — | `~/.codex/auth.json` | ✅ 已验证 |
| 5 | OpenCode Go | 窗口 | ✅ | ✅ | ✅ | `OPENCODE_API_KEY`、`opencode.db` | ✅ 已验证 |
| 6 | DeepSeek | 余额 | — | — | — | `DEEPSEEK_API_KEY`、opencode 凭据 | ✅ 已验证 |

窗口型 provider 展示 5 小时 / 周 / 月配额；余额型 provider（DeepSeek）展示账户余额，没有窗口概念。

“✅ 已验证”表示用真实账号跑通了请求和解析；“⏳ 未验证”表示已按接口实现，但还没有真实账号验证，实际响应有出入时可能需要微调。

月度窗口只有 provider 返回时才显示，后续再扩展。

## 安装

需要 Node.js 20+（推荐 22+）。`node:sqlite` 读取 OpenCode 凭据需要 Node 22+，低版本会退回到 `auth.json` 或环境变量；Node 版本低于 20 时命令会直接提示升级。

### 全局安装（推荐）

首次在项目目录执行：

```bash
cd ~/Project/llm-limit
npm install
npm run dev -- --init
```

`--init` 会做两件事：全局安装（`npm install -g`）和扫描本机各 provider 的凭据。完成后在任意目录都能直接使用 `llm-limit`。

已经安装后，想重新扫描凭据或更新全局链接：

```bash
llm-limit --init
```

`prepare` 脚本会在安装时自动编译 `dist/`，不需要手动 build。

### 不安装

```bash
npm run dev -- minimax        # 开发模式
# 或
node bin/llm-limit.mjs        # 使用已编译产物
```

程序里的凭据和配置都走绝对路径（`~/.mmx`、`~/.codex`、`~/.local/share/opencode` 等），所以在哪个目录运行结果都一样。

## 使用

```bash
llm-limit                    # 交互界面
llm-limit minimax            # 直接打开 MiniMax
llm-limit minimax --once     # 打印一次文本
llm-limit --init             # 全局安装 + 扫描各 provider 凭据
llm-limit --json             # 输出所有 provider 的 JSON
llm-limit auth minimax sk-...  # 保存 API Key
```

快捷键：

| 按键 | 作用 |
| --- | --- |
| `←` / `→`（或 `h` / `l`、`Tab`） | 切换 provider |
| `1`-`5` | 直达对应 provider |
| `r` | 立即刷新当前 provider |
| `q` / `Esc` / `Ctrl-C` | 退出 |

切换 provider 时有 30 秒缓存；当前 provider 每 60 秒自动刷新。

## 保存 API Key

用 `auth` 子命令把 key 存到 `~/.config/llm-limit/.env`（权限 0600），启动时自动加载：

```bash
llm-limit auth minimax sk-...                # 国际区
llm-limit auth minimax sk-... --region cn    # 中国区
llm-limit auth zai sk-...
llm-limit auth opencode sk-...
llm-limit auth deepseek sk-...

llm-limit auth list                          # 查看已保存的 key（打码）
llm-limit auth remove minimax                # 删除
```

真实环境变量优先级高于这个文件。Kimi / Codex 使用 OAuth，请执行各自的登录命令。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `MINIMAX_CN_API_KEY` / `MINIMAX_API_KEY` | MiniMax 中国区 / 国际区 key |
| `ZAI_API_KEY` | Z.AI key；中国区加 `ZAI_REGION=cn` |
| `ZAI_BASE_URL` | 覆盖 Z.AI 接口域名 |
| `OPENCODE_API_KEY` | OpenCode Go key |
| `KIMI_CREDENTIALS_PATH` | 指定 Kimi 凭据文件 |
| `KIMI_BASE_URL` | 覆盖 Kimi 接口域名 |
| `CODEX_HOME` | Codex 配置目录 |
| `CODEX_CHATGPT_BASE_URL` | 覆盖 Codex 接口域名 |

各接口的请求、响应和字段映射固定在 [`docs/providers.md`](docs/providers.md)。

### 配置 MiniMax

除了 `llm-limit auth minimax <key>`，也可以直接设置环境变量：

```bash
# 中国区（platform.minimaxi.com）
export MINIMAX_CN_API_KEY="sk-..."

# 国际区（platform.minimax.io）
export MINIMAX_API_KEY="sk-..."
```

也可以先登录 mmx CLI，程序会自动读取 `~/.mmx/config.json`：

```bash
mmx auth login
```

注意：只有 M Plan 订阅 key 才能查到 5 小时/周配额；两个区的 key 不通用。

## 开发

```bash
npm run dev       # tsx 直接跑源码
npm run build     # tsc 编译到 dist/
npm run typecheck # 只做类型检查
npm run test      # 类型检查 + 单元测试
npm run start     # 运行编译产物
```

结构：

```
src/
  cli.tsx                 参数解析、交互/一次性两种入口
  app.tsx                 Ink 界面
  lib/
    credentials.ts        本地凭据读取
    http.ts               fetch 封装
    parse.ts              时间/数字字段解析
    time.ts               倒计时格式化
    ui.ts                 进度条、颜色
  providers/
    types.ts              统一快照模型
    registry.ts           provider 列表
    minimax.ts / zai.ts / kimi.ts / codex.ts / opencode.ts / deepseek.ts
test/
  core.test.mjs           解析、格式化、颜色阈值等单元测试
```

## 颜色规则

进度条按**已用比例**上色：

| 已用 | 颜色 |
| --- | --- |
| < 60% | 绿 |
| 60% ~ 84% | 黄 |
| ≥ 85% | 红 |

顶部 provider 标签的状态点：

| 图标 | 含义 |
| --- | --- |
| `●` 绿 | 正常 |
| `●` 黄 | 配额接近/已经用尽 |
| `●` 红 | 请求失败 |
| `○` 红 | 未配置凭据 / 凭据失效 |
| `○` 灰 | 还没加载 |

阈值定义在 `src/lib/ui.ts` 的 `USED_WARN_PCT` / `USED_CRIT_PCT`，想调直接改这两个常量。

## 扩展 provider

新增一个 provider 只需要“新建一个文件 + 注册”，不用改界面。完整步骤和模板见 [`docs/adding-provider.md`](docs/adding-provider.md)。

简版：

1. 在 `docs/providers.md` 固定接口（端点、认证、响应字段）。
2. 新建 `src/providers/<id>.ts`，实现 `ProviderDef`。
3. 在 `src/providers/registry.ts` 的 `providers` 数组里加入。
4. `npm run dev -- <id> --once` 验证。

## 说明

- 只读取凭据，不写回、不打印 key。
- 除 MiniMax 和 OpenCode Go 外的额度接口来自各 CLI 的内部实现，厂商调整后可能需要更新解析逻辑。
- 本项目只做额度展示，不做 token / 费用统计。

## License

MIT
