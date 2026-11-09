#!/usr/bin/env node
// 安装脚本：把 mihomo-party-mcp 注册到支持的客户端配置文件。
// 用法：node install.mjs [--codex] [--claude] [--force]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const SERVER = path.join(process.cwd(), "server.mjs");
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

const args = process.argv.slice(2);
const force = args.includes("--force");
if (args.includes("--codex") || force) ensureCodex();
if (args.includes("--claude") || force) ensureClaude();
if (!args.some((a) => a.startsWith("--"))) {
  console.log("用法: node install.mjs [--codex] [--claude] [--force]");
  console.log("默认不做任何事。--force 同时注册 codex 与 claude。");
}
