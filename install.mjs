#!/usr/bin/env node
// 安装脚本：把 mihomo-party-mcp 注册到支持的客户端配置文件。
// 用法：node install.mjs [--codex] [--claude] [--force]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const SERVER = path.join(process.cwd(), "server.mjs");
const AGENT_SRC = path.join(process.cwd(), "agents", "mihomo-party.toml");
// 优先用运行本脚本的 node 真实路径（避免 mise/brew 包装器在子进程中出问题）
const NODE = process.execPath;

// 简单 TOML 追加：仅当 [mcp_servers.mihomo_party] 不存在时追加，绝不修改已有内容。
function ensureCodex() {
  const cfgs = [
    path.join(HOME, ".codex/config.toml"),
    path.join(HOME, ".claude/config.toml"),
  ];
  for (const cfg of cfgs) {
    if (!fs.existsSync(cfg)) {
      fs.mkdirSync(path.dirname(cfg), { recursive: true });
      fs.writeFileSync(cfg, "");
    }
    const content = fs.readFileSync(cfg, "utf8");
    if (/mihomo_party/.test(content)) {
      console.log(`skip (已注册): ${cfg}`);
      continue;
    }
    const block = `\n# mihomo-party / clash-verge 代理管理\n[mcp_servers.mihomo_party]\ncommand = "${NODE}"\nargs = ["${SERVER}"]\n`;
    fs.appendFileSync(cfg, block);
    console.log(`registered: ${cfg}`);
  }
}

function ensureClaude() {
  // Claude Code 用 JSON 配置 ~/.claude.json 的 mcpServers
  const f = path.join(HOME, ".claude.json");
  let data = {};
  if (fs.existsSync(f)) {
    try { data = JSON.parse(fs.readFileSync(f, "utf8")); } catch { data = {}; }
  }
  data.mcpServers = data.mcpServers || {};
  if (data.mcpServers.mihomo_party) {
    console.log(`skip (已注册): ${f}`);
    return;
  }
  data.mcpServers.mihomo_party = { command: NODE, args: [SERVER] };
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  console.log(`registered: ${f}`);
}

// 把 mihomo_party 注册为 Codex 多 agent 角色（需要 [features] multi_agent = true）。
function ensureCodexAgent() {
  const cfg = path.join(HOME, ".codex", "config.toml");
  if (!fs.existsSync(cfg)) {
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, "");
  }
  // 复制角色文件到 ~/.codex/agents/
  if (fs.existsSync(AGENT_SRC)) {
    const agentsDir = path.join(HOME, ".codex", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(AGENT_SRC, path.join(agentsDir, "mihomo-party.toml"));
    console.log("copied agent role -> ~/.codex/agents/mihomo-party.toml");
  }
  let content = fs.readFileSync(cfg, "utf8");
  if (/\[agents\.mihomo_party\]/.test(content)) {
    console.log("skip (agent 已注册): " + cfg);
    return;
  }
  // 确保 multi_agent 开启：有 [features] 则补一行，没有则新增段。
  if (/\[features\]/.test(content)) {
    if (!/multi_agent\s*=/.test(content)) {
      content = content.replace(/\[features\]/, "[features]\nmulti_agent = true");
    }
  } else {
    content += "\n[features]\nmulti_agent = true\n";
  }
  const block =
    "\n[agents]\nmax_threads = 6\nmax_depth = 1\n\n" +
    "[agents.mihomo_party]\n" +
    'description = "Clash Party / mihomo-party 代理管理 agent（依赖 mihomo_party MCP）。"\n' +
    'config_file = "agents/mihomo-party.toml"\n';
  fs.writeFileSync(cfg, content + block);
  console.log("registered agent role: " + cfg);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
if (args.includes("--codex") || force) ensureCodex();
if (args.includes("--claude") || force) ensureClaude();
if (args.includes("--agent") || force) ensureCodexAgent();
if (!args.some((a) => a.startsWith("--"))) {
  console.log("用法: node install.mjs [--codex] [--claude] [--agent] [--force]");
  console.log("默认不做任何事。--force 同时注册 codex、claude 与 agent。");
}
