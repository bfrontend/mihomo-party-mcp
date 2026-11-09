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
node install.mjs --force        # 注册到 ~/.codex 与 ~/.claude
```

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
