// 探测本机 clash/mihomo 前端，定位数据目录、控制端口、secret。
// 支持：mihomo-party、clash-verge-rev / clash-verge(clash meta)、clash-verge(clash meta) (linux)、
// OpenClash(路由器, 需手动指定)、Stash(macOS)。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

function exists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function readIf(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

// 从配置文本中解析 external-controller 与 secret
function parseController(cfg) {
  const port = (cfg.match(/external-controller:\s*([^\s#]+)/) || [])[1];
  const unix = (cfg.match(/external-controller-unix:\s*([^\s#]+)/) || [])[1];
  const secret = (cfg.match(/^\s*secret:\s*(.+)$/m) || [])[1];
  return {
    host: port || "127.0.0.1:9090",
    unix,
    secret: secret && secret !== "set-your-secret" ? secret.trim() : "",
  };
}

const CANDIDATES = [
  {
    id: "mihomo-party",
    dir: path.join(HOME, "Library/Application Support/mihomo-party"),
    config: "config.yaml",
    detect: (d) => exists(d),
  },
  {
    id: "clash-verge-rev",
    dir: path.join(HOME, "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"),
    config: "config.yaml",
    detect: (d) => exists(d),
  },
  {
    id: "clash-verge-rev-linux",
    dir: path.join(HOME, ".config/clash-verge-rev"),
    config: "config.yaml",
    detect: (d) => exists(d),
  },
  {
    id: "clash-verge",
    dir: path.join(HOME, ".config/clash-verge"),
    config: "config.yaml",
    detect: (d) => exists(d),
  },
  {
    id: "clash-meta",
    dir: path.join(HOME, ".config/clash-meta"),
    config: "config.yaml",
    detect: (d) => exists(d),
  },
  {
    id: "clash",
    dir: path.join(HOME, ".config/clash"),
    config: "config.yaml",
    detect: (d) => exists(d),
  },
];

export function detect(env = {}) {
  // 允许环境变量覆盖
  if (env.MIHOMO_PARTY_DIR && exists(env.MIHOMO_PARTY_DIR)) {
    const cfg = parseController(readIf(path.join(env.MIHOMO_PARTY_DIR, env.MIHOMO_CONFIG || "config.yaml")) || "");
    return {
      id: "custom",
      dir: env.MIHOMO_PARTY_DIR,
      controller: env.MIHOMO_CONTROLLER ? { host: env.MIHOMO_CONTROLLER, unix: undefined, secret: env.MIHOMO_SECRET || "" } : cfg,
    };
  }
  for (const c of CANDIDATES) {
    if (c.detect(c.dir)) {
      const cfg = parseController(readIf(path.join(c.dir, c.config)) || "");
      return {
        id: c.id,
        dir: c.dir,
        controller: env.MIHOMO_CONTROLLER
          ? { host: env.MIHOMO_CONTROLLER, unix: undefined, secret: env.MIHOMO_SECRET || "" }
          : cfg,
      };
    }
  }
  return null;
}

// 根据前端类型返回规则来源文件的探测函数
export function ruleSource(frontend) {
  const { dir, id } = frontend;
  if (id.startsWith("mihomo-party")) {
    const ov = path.join(dir, "override");
    return {
      overrideDir: ov,
      // 全局 override 文件名（mihomo-party 固定）
      globalOverride: path.join(ov, "1930f207b66.yaml"),
      listOverrideFiles: () =>
        fs.existsSync(ov) ? fs.readdirSync(ov).filter((f) => f.endsWith(".yaml")) : [],
      runningConfig: path.join(dir, "work/config.yaml"),
    };
  }
  if (id.startsWith("clash-verge")) {
    const profiles = path.join(dir, "profiles");
    return {
      // clash-verge 没有固定全局 override，规则写在当前激活 profile 的 yaml
      listOverrideFiles: () =>
        fs.existsSync(profiles) ? fs.readdirSync(profiles).filter((f) => f.endsWith(".yaml") && f !== "Merge.yaml") : [],
      profilesDir: profiles,
      runningConfig: null, // clash-verse 直接用 /configs API 读运行配置
    };
  }
  return { listOverrideFiles: () => [], runningConfig: null };
}
