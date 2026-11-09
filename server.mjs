#!/usr/bin/env node
// mihomo-party / clash-verge MCP server (stdio)
// 让 agent 用自然语言管理 clash/mihomo 前端的代理规则、订阅、节点组与 reload。
// 纯 Node 内置模块，无第三方依赖。跨平台自动探测前端与控制器。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { detect, ruleSource } from "./detect.mjs";

const FRONTEND = detect(process.env);
if (!FRONTEND) {
  console.error("[mihomo-mcp] 未探测到支持的 clash/mihomo 前端；可用 MIHOMO_PARTY_DIR / MIHOMO_CONTROLLER 手动指定。");
}

function api(method, endpoint, body) {
  if (!FRONTEND) throw new Error("未探测到前端");
  const { host, unix, secret } = FRONTEND.controller;
  const args = ["-s", "-X", method, "--max-time", "3", "-H", "Content-Type: application/json"];
  if (secret) args.push("-H", `Authorization: Bearer ${secret}`);
  if (unix && fs.existsSync(unix)) args.push("--unix-socket", unix);
  if (body) args.push("-d", JSON.stringify(body));
  args.push(`http://${host}${endpoint}`);
  const r = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`curl failed: ${r.stderr || r.error}`);
  const out = (r.stdout || "").trim();
  if (method === "PUT" && !out) return {};
  try { return JSON.parse(out); } catch { return { raw: out }; }
}

function readYaml(file) { return fs.readFileSync(file, "utf8"); }
function writeYaml(file, content) { fs.writeFileSync(file, content, "utf8"); }

// 在 override 文件的 +rules: 段最前面插入规则（保证早于通用后缀规则）
function prependRules(file, rules) {
  const lines = readYaml(file).split(/\r?\n/);
  const idx = lines.indexOf("+rules:");
  if (idx === -1) throw new Error(`override 文件 ${file} 没有 +rules: 段`);
  const existing = lines.slice(idx + 1)
    .filter((l) => /^  - /.test(l))
    .map((l) => l.trim().slice(2).trim());
  const add = rules.filter((r) => !existing.includes(r));
  if (add.length === 0) return { added: [], skipped: rules };
  lines.splice(idx + 1, 0, ...add.map((r) => `  - ${r}`));
  writeYaml(file, lines.join("\n"));
  return { added: add, skipped: [] };
}

function extractRules(raw) {
  const allLines = raw.split(/\r?\n/);
  const start = allLines.findIndex((l) => l === "rules:");
  if (start === -1) return [];
  return allLines.slice(start)
    .filter((l) => /^  - /.test(l))
    .map((l) => l.trim().slice(2).trim());
}

async function handleTool(name, args) {
  const src = FRONTEND ? ruleSource(FRONTEND) : null;
  switch (name) {
    case "list_profiles": {
      // 优先读运行配置里的代理组；profile 列表随前端而异
      const proxies = api("GET", "/proxies");
      const groups = Object.values(proxies.proxies || {})
        .filter((p) => p.type === "Selector" || p.all)
        .map((p) => ({ name: p.name, now: p.now, options: p.all || [] }));
      return { frontend: FRONTEND?.id, proxyGroups: groups };
    }
    case "get_active_config": {
      const cfg = api("GET", "/configs");
      return {
        frontend: FRONTEND?.id,
        mode: cfg.mode,
        controller: FRONTEND?.controller?.host,
      };
    }
    case "list_rules": {
      let rules;
      if (src?.runningConfig && fs.existsSync(src.runningConfig)) {
        rules = extractRules(readYaml(src.runningConfig));
      } else {
        const cfg = api("GET", "/configs");
        rules = cfg.rules || [];
      }
      return { frontend: FRONTEND?.id, rules };
    }
    case "add_rules": {
      if (!src) throw new Error("当前前端不支持文件式 override");
      let file = args.override_file;
      if (!file) {
        // 默认选第一个可用的 override 文件
        const files = src.listOverrideFiles();
        if (files.length === 0) throw new Error("未找到可写的 override 文件");
        file = src.overrideDir
          ? path_join(src.overrideDir, files[0])
          : (src.profilesDir ? path_join(src.profilesDir, files[0]) : files[0]);
      } else if (src.profilesDir && !file.includes("/")) {
        file = path_join(src.profilesDir, file);
      } else if (src.overrideDir && !file.includes("/")) {
        file = path_join(src.overrideDir, file);
      }
      const res = prependRules(file, args.rules);
      return { file, ...res };
    }
    case "reload_config": {
      if (src?.runningConfig) {
        api("PUT", `/configs?force=true`, { path: src.runningConfig });
        return { ok: true, reloaded: src.runningConfig };
      }
      // clash-verge 没有独立运行 yaml；reload 通过切换 profile 触发，或提示手动
      return { ok: false, note: "该前端请通过 switch_profile 或 UI 重载；/configs PUT 不接收 rules" };
    }
    case "switch_profile": {
      api("POST", "/configs/switch", { name: args.profile });
      return { switchedTo: args.profile };
    }
    case "select_proxy": {
      api("PUT", `/proxies/${encodeURIComponent(args.group)}`, { name: args.proxy });
      return { group: args.group, now: args.proxy };
    }
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

function path_join(...parts) { return parts.join("/"); }

const tools = [
  { name: "list_profiles", description: "列出当前代理组及每个组可选节点（运行配置）。", inputSchema: { type: "object", properties: {} } },
  { name: "get_active_config", description: "读取当前运行配置摘要（前端、mode、控制器地址）。", inputSchema: { type: "object", properties: {} } },
  { name: "list_rules", description: "列出当前运行配置的全部 rules（按命中优先级顺序）。", inputSchema: { type: "object", properties: {} } },
  { name: "add_rules", description: "向 override 文件的 +rules: 段最前面插入规则（先于通用后缀规则生效），自动去重。rules 为 clash 规则字符串数组。override_file 可选，默认第一个可用 override。", inputSchema: { type: "object", properties: { rules: { type: "array", items: { type: "string" } }, override_file: { type: "string" } }, required: ["rules"] } },
  { name: "reload_config", description: "让核心重载运行配置（mihomo-party 支持；clash-verge 请改用 switch_profile/UI）。", inputSchema: { type: "object", properties: {} } },
  { name: "switch_profile", description: "切换当前活动订阅/profile（按名称）。", inputSchema: { type: "object", properties: { profile: { type: "string" } }, required: ["profile"] } },
  { name: "select_proxy", description: "切换某代理组当前选中节点（如切到直连/DIRECT）。", inputSchema: { type: "object", properties: { group: { type: "string" }, proxy: { type: "string" } }, required: ["group", "proxy"] } },
];

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buf = "";
rl.on("line", async (line) => {
  if (!line.trim()) return;
  buf += line;
  let msg;
  try { msg = JSON.parse(buf); } catch { return; }
  buf = "";
  const id = msg.id;
  try {
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mihomo-mcp", version: "1.0.0" } } }) + "\n");
      return;
    }
    if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }) + "\n");
      return;
    }
    if (msg.method === "tools/call") {
      const out = await handleTool(msg.params.name, msg.params.arguments || {});
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } }) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e.message || e) } }) + "\n");
  }
});

process.on("SIGINT", () => process.exit(0));
