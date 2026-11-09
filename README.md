# mihomo-party-mcp

一个 [MCP](https://modelcontextprotocol.io) server，让 AI 客户端（Codex、Claude Code 等）用自然语言管理本机的 clash / mihomo 代理前端：

- 增删**分流规则**（某域名走代理还是直连）
- 列出/切换**订阅 profile**
- 切换**代理节点组**的选中节点
- **reload** 使改动生效

纯 Node 内置模块，**无第三方依赖**，跨平台自动探测前端。

## 支持的前端

| 前端 | 数据目录（自动探测） |
|------|----------------------|
| mihomo-party (macOS) | `~/Library/Application Support/mihomo-party` |
| Clash Verge Rev (macOS) | `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev` |
| Clash Verge Rev (Linux) | `~/.config/clash-verge-rev` |
| Clash Verge | `~/.config/clash-verge` |
| Clash Meta / Clash | `~/.config/clash-meta` 或 `~/.config/clash` |

也支持环境变量覆盖：`MIHOMO_PARTY_DIR`、`MIHOMO_CONTROLLER`(host:port)、`MIHOMO_SECRET`。

控制面来自 mihomo 核心的 REST API（`external-controller`，默认 `127.0.0.1:9090`，secret 从前端配置自动读取）。

## 安装

```bash
git clone https://github.com/<you>/mihomo-party-mcp.git
cd mihomo-party-mcp
node install.mjs --force        # 注册 MCP 到 ~/.codex 与 ~/.claude，并注册 agent 角色
```

`--force` 会同时注册三件事：Codex/Claude 的 MCP server、以及 Codex 的 `mihomo_party` 多 agent 角色。
若只想注册 agent 角色，单独运行 `node install.mjs --agent`。

或手动在客户端配置里加（见下）。

## 客户端配置

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.mihomo_party]
command = "/usr/local/bin/node"
args = ["/absolute/path/to/mihomo-party-mcp/server.mjs"]
```

### Claude Code (`~/.claude.json`)

```json
{ "mcpServers": { "mihomo_party": { "command": "/usr/local/bin/node", "args": ["/absolute/path/to/mihomo-party-mcp/server.mjs"] } } }
```

## 作为 Codex agent 角色使用

仓库内置 `agents/mihomo-party.toml`，是一个 Codex 多 agent 角色（依赖上面的 `mihomo_party` MCP）。
注册后可在 Codex 里把代理管理任务委派给它（如 `/agent mihomo_party` 或在工作流中作为子 agent）。

安装脚本 `install.mjs --agent` 会：

1. 复制 `agents/mihomo-party.toml` 到 `~/.codex/agents/`；
2. 在 `~/.codex/config.toml` 开启 `[features] multi_agent = true`；
3. 追加 `[agents.mihomo_party]` 段指向该角色文件。

对应 `config.toml` 片段：

```toml
[features]
multi_agent = true

[agents]
max_threads = 6
max_depth = 1

[agents.mihomo_party]
description = "Clash Party / mihomo-party 代理管理 agent（依赖 mihomo_party MCP）。"
config_file = "agents/mihomo-party.toml"
```

## 规则拆分建议（全局 vs profile）

Clash Party 的覆写分为两类，别混淆：

- **profile override**：在 `profile.yaml` 里被某个 profile 的 `override:` 引用，只对那一个 profile 生效。
- **global override**：在 `override.yaml` 里 `global: true`，对所有 profile 生效。

典型拆分：

1. `90-global-rules.yaml`（`global: true`）：放所有 profile 共享的规则，如 Gmail 收发分流、微信直连、局域网直连、兜底 `MATCH`。
2. `1930f207b66.yaml`（`global: false`）：放当前激活 profile 的个性化分流，保留但应去重。

注意：

- 改 override 后**重启 app** 才会重新生成 `work/config.yaml`；`reload_config` 只重载内核当前配置，不一定重新合并 override。
- 具体域名规则（如 `DOMAIN,imap.gmail.com`）必须排在更宽泛规则（如 `DOMAIN-SUFFIX,google.com`）之前，否则被提前命中。
- 不要删除含 `+proxies` / `+proxy-groups` 的 override 段，规则可能依赖其中的 `代理出口` / `直连出口` 等出口名。

本仓库的 agent 角色内置上述经验，可直接把“规则去重 / 拆全局 / 调 Gmail 分流”等任务交给它。

## 工作原理

- **规则来源**：写入前端的 override / profile 文件（持久），而非只改运行配置。
- **规则顺序**：clash 规则**先匹配先生效**。新增具体域名规则会插到 override `+rules:` 段**最前面**，
  以免被订阅内的 `DOMAIN-SUFFIX,google.com` 等通用后缀规则抢先。
- **生效**：mihomo-party 改完调 `reload_config`（核心重载 `work/config.yaml`）；clash-verge 通过 `switch_profile` 或 UI 触发。

## 工具

| 工具 | 作用 |
|------|------|
| `list_profiles` | 列出代理组及每个组的可选节点 |
| `get_active_config` | 运行配置摘要（前端、mode、控制器地址） |
| `list_rules` | 当前运行配置的全部 rules（按优先级顺序） |
| `add_rules` | 向 override `+rules:` 最前插入规则，自动去重 |
| `reload_config` | 核心重载运行配置（mihomo-party） |
| `switch_profile` | 切换活动订阅/profile（按名称） |
| `select_proxy` | 切换某代理组选中节点 |

## 示例

> 让 Gmail 收发分流：imap 走代理、smtp 直连（避免 SMTP 被代理断开）。

让 agent 执行（或直接调用工具）：

```
add_rules rules=["DOMAIN,imap.gmail.com,代理出口","DOMAIN,smtp.gmail.com,DIRECT"]
reload_config
```

注意：因为订阅里通常有 `DOMAIN-SUFFIX,google.com,代理出口`，`smtp.gmail.com` 必须排在它**之前**才会直连——本 server 的 `add_rules` 已自动置顶。

## 安全

- 仅本地通信（`127.0.0.1`）。
- 所有改动写入你机器上的前端配置文件，建议改动前备份（server 不改订阅 URL、不改 secret）。
- 不联网、不收集数据。

## License

MIT
