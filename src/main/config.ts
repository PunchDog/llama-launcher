import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Config, ConfigPreset } from '../shared/types';
import { DEFAULT_CONFIG, DEFAULT_PRESETS } from '../shared/constants';
import { getConfigPath } from './paths';

// =============================================================================
// Config 管理模块 — 完全替代 Go 版 app/config.go
// =============================================================================

let cachedConfig: Config | null = null;

// ---------------------------------------------------------------------------
// getConfigPath — 返回 config.json 的完整路径
//   开发模式：{项目根}/config.json
//   打包模式：{exeDir}/resources/config.json
// ---------------------------------------------------------------------------
export { getConfigPath };

// ---------------------------------------------------------------------------
// defaultConfig — 返回默认配置的快照（导出供外部使用）
//   非 Windows 平台自动替换 models_dir 为 ~/models
// ---------------------------------------------------------------------------

export function defaultConfig(): Config {
  const cfg = deepCloneConfig(DEFAULT_CONFIG);
  if (process.platform !== 'win32' && cfg.models_dir.startsWith('D:\\')) {
    cfg.models_dir = path.join(os.homedir(), 'models');
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// loadConfig — 从 config.json 加载配置，缺失字段使用默认值
// ---------------------------------------------------------------------------

export function loadConfig(): Config {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      // 配置文件不存在，保存平台适配的默认配置并返回
      const defaults = defaultConfig();
      saveConfigSync(defaults, configPath);
      cachedConfig = defaults;
      return deepCloneConfig(defaults);
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(raw) as Partial<Config>;

    // 深度合并：用户配置优先，缺失字段回退平台适配默认值
    const merged = deepMergeConfig(defaultConfig(), userConfig);

    // 旧配置迁移：spec_type 字段引入前通过 mtp > 0 隐式启用 draft-mtp，
    // 升级后自动映射，避免老用户丢失 spec 参数
    if (userConfig.spec_type === undefined && merged.mtp > 0) {
      merged.spec_type = 'draft-mtp';
    }

    // presets 校验：手改 config.json 可能导致字段缺失/损坏，
    // 非数组或空数组时回落默认档位，避免预设区空白
    if (!Array.isArray(merged.presets) || merged.presets.length === 0) {
      merged.presets = [...DEFAULT_PRESETS] as ConfigPreset[];
    }

    // 新增字段补齐后回写文件：旧 config.json 缺少 presets / spec_type 等字段时，
    // 仅内存合并不会落盘，用户在文件中看不到也无法编辑预设
    if (userConfig.presets === undefined) {
      saveConfigSync(merged, configPath);
    }

    // 非 Windows 平台：若 models_dir 是 Windows 风格路径，自动替换为 ~/models
    if (process.platform !== 'win32' && merged.models_dir.match(/^[A-Za-z]:[\\/]/)) {
      console.warn(`[Config] models_dir "${merged.models_dir}" 在 Linux 下无效，已替换为 ~/models`);
      merged.models_dir = path.join(os.homedir(), 'models');
    }
    cachedConfig = merged;
    return deepCloneConfig(merged);
  } catch (err) {
    console.error('[Config] 加载 config.json 失败:', err);
    const fallback = defaultConfig();
    cachedConfig = fallback;
    return deepCloneConfig(fallback);
  }
}

// ---------------------------------------------------------------------------
// saveConfig — 将配置写入 config.json（异步版本，供 IPC 调用）
// ---------------------------------------------------------------------------

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();

  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 原子写入：先写临时文件，再 rename
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);

    cachedConfig = deepCloneConfig(config);
  } catch (err) {
    console.error('[Config] 保存 config.json 失败:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateConfigField — 通过点分隔路径更新单个字段
//   示例: 'models_dir', 'optional.temperature', 'rpc_server.port'
// ---------------------------------------------------------------------------

export function updateConfigField(key: string, value: unknown): Config {
  const config = loadConfig();
  const parts = key.split('.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (target[parts[i]] === undefined || target[parts[i]] === null) {
      target[parts[i]] = {};
    }
    target = target[parts[i]];
  }

  const lastKey = parts[parts.length - 1];
  target[lastKey] = value;

  saveConfig(config);
  cachedConfig = config;
  return deepCloneConfig(config);
}

// ---------------------------------------------------------------------------
// getCachedConfig — 获取缓存的配置（避免重复读文件）
// ---------------------------------------------------------------------------

export function getCachedConfig(): Config | null {
  return cachedConfig ? deepCloneConfig(cachedConfig) : null;
}

// ---------------------------------------------------------------------------
// 内部工具函数
// ---------------------------------------------------------------------------

function saveConfigSync(config: Config, configPath: string): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Config] 保存默认配置失败:', err);
  }
}

function deepCloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config;
}

function deepMergeConfig(defaults: Config, user: Partial<Config>): Config {
  const merged = deepCloneConfig(defaults);

  for (const key of Object.keys(user) as (keyof Config)[]) {
    const userVal = user[key];
    const defaultVal = merged[key];

    if (
      typeof userVal === 'object' &&
      userVal !== null &&
      !Array.isArray(userVal) &&
      typeof defaultVal === 'object' &&
      defaultVal !== null &&
      !Array.isArray(defaultVal)
    ) {
      // 嵌套对象递归合并
      (merged as unknown as Record<string, unknown>)[key] = { ...defaultVal, ...userVal };
    } else {
      (merged as unknown as Record<string, unknown>)[key] = userVal;
    }
  }

  return merged;
}
