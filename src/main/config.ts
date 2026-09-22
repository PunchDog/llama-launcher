import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config, ConfigKey, ConfigPreset } from '../shared/types';
import { DEFAULT_CONFIG, DEFAULT_PRESETS, CONFIG_VERSION } from '../shared/constants';
import { ALL_PARAMS, PARAM_INDEX, getPath, setPath } from '../shared/params';
import type { AnyParamDef } from '../shared/params/schema';
import { migrateV1ToV2 } from '../shared/params/migrate';
import { writeFileAtomic } from '../shared/fs-safe';
import { getConfigPath } from './paths';

// =============================================================================
// Config 管理模块
//   - normalizeConfig：以参数元数据表为白名单逐键清洗（未知键、原型污染键、
//     类型不符的值一律丢弃）
//   - config_version 阶梯式幂等迁移：v0→v1 在原始 JSON 上补齐旧字段，v1→v2 走
//     migrateV1ToV2，只在版本落后时执行
//   - 原子写入 + 首次落盘前备份 .bak
//   - JSON 解析失败：坏文件改名 .bad-<ts>.json 保留现场并上报，绝不静默覆盖
// =============================================================================

let cachedConfig: Config | null = null;
let backupDone = false;

// ---------------------------------------------------------------------------
// getConfigPath — 返回 config.json 的完整路径
//   开发模式：{项目根}/config.json
//   打包模式：{exeDir}/resources/config.json
// ---------------------------------------------------------------------------
export { getConfigPath };

// ---------------------------------------------------------------------------
// defaultConfig — 默认配置快照（深拷贝，可安全修改）
//   参数部分全部来自元数据表（除启动器必填项外一律 inherit），
//   非 Windows 平台的首轮模型目录改到 ~/models
// ---------------------------------------------------------------------------

export function defaultConfig(): Config {
  const cfg = structuredClone(DEFAULT_CONFIG);
  if (process.platform !== 'win32') {
    setPath(cfg as unknown as Record<string, unknown>, 'server.models_dir', path.join(os.homedir(), 'models'));
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// 值清洗 — 按 ParamDef.type 判定；undefined 表示丢弃该值（回落默认/inherit）
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 应用层字段（不参与命令行发射）也可经 config:update 修改 */
const APP_FIELDS: Readonly<Record<string, 'bool' | 'string' | 'int'>> = {
  'proxy.enabled': 'bool',
  'proxy.url': 'string',
  'rpc.server.enabled': 'bool',
  'rpc.server.host': 'string',
  'rpc.server.port': 'int',
};

function cleanStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function cleanParam(def: AnyParamDef, value: unknown): unknown {
  if (value === null) return def.default === undefined ? null : def.default;
  switch (def.type) {
    case 'int': {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? Math.trunc(num) : undefined;
    }
    case 'float': {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : undefined;
    }
    case 'bool':
      return typeof value === 'boolean' ? value : undefined;
    case 'string[]':
      return cleanStringList(value);
    default:
      return typeof value === 'string' ? value : undefined;
  }
}

function cleanAppField(kind: 'bool' | 'string' | 'int', value: unknown): unknown {
  if (kind === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (kind === 'string') return typeof value === 'string' ? value : undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : undefined;
}

// ---------------------------------------------------------------------------
// normalizePresets — 逐条校验预设结构，changes 只保留参数表认识的点路径
// ---------------------------------------------------------------------------

function normalizePresets(raw: unknown): ConfigPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfigPreset[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !item.id || !item.name) continue;
    const changes: Record<string, unknown> = {};
    if (isPlainObject(item.changes)) {
      for (const [key, value] of Object.entries(item.changes)) {
        const def = PARAM_INDEX.get(key);
        if (!def || key === 'extra.args') continue;
        const cleaned = cleanParam(def, value);
        if (cleaned !== undefined) changes[key] = cleaned;
      }
    }
    out.push({
      id: item.id,
      name: item.name,
      desc: typeof item.desc === 'string' ? item.desc : '',
      hint: typeof item.hint === 'string' ? item.hint : '',
      changes: changes as ConfigPreset['changes'],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// normalizeConfig — 白名单归一化：默认结构 + 逐键清洗
// ---------------------------------------------------------------------------

export function normalizeConfig(raw: unknown): Config {
  const out = defaultConfig();
  if (!isPlainObject(raw)) return out;

  for (const def of ALL_PARAMS) {
    const value = getPath(raw, def.key);
    if (value === undefined) continue;
    const cleaned = cleanParam(def, value);
    if (cleaned !== undefined) setPath(out as unknown as Record<string, unknown>, def.key, cleaned);
  }

  for (const [key, kind] of Object.entries(APP_FIELDS)) {
    const value = getPath(raw, key);
    if (value === undefined) continue;
    const cleaned = cleanAppField(kind, value);
    if (cleaned !== undefined) setPath(out as unknown as Record<string, unknown>, key, cleaned);
  }

  const presets = normalizePresets(raw.presets);
  out.presets = presets.length > 0 ? presets : structuredClone(DEFAULT_PRESETS) as ConfigPreset[];

  // v1 迁移留下的未认领字段：原样保留供用户自查，不发射到命令行
  if (isPlainObject(raw.unknown_v1)) out.unknown_v1 = raw.unknown_v1;

  return out;
}

// ---------------------------------------------------------------------------
// loadConfig — 读取 → 版本迁移 → 归一化 → （迁移后）原子回写
//   解析失败时坏文件改名保留，返回默认配置并落一份干净的
// ---------------------------------------------------------------------------

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    const defaults = defaultConfig();
    persistConfig(defaults, configPath);
    cachedConfig = defaults;
    return structuredClone(defaults);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const badPath = `${configPath}.bad-${stamp}.json`;
    let moved = false;
    try {
      fs.renameSync(configPath, badPath);
      moved = true;
    } catch {
      // 文件可能被占用无法改名，此时绝不覆盖原文件
    }
    console.error(
      `[Config] config.json 解析失败${moved ? `，坏文件已保留到 ${badPath}` : '（坏文件无法改名，跳过覆盖）'}:`,
      err,
    );
    const fallback = defaultConfig();
    if (!moved) {
      // 无法保留现场时绝不写默认配置覆盖用户文件，仅内存回退
      cachedConfig = fallback;
      return structuredClone(fallback);
    }
    persistConfig(fallback, configPath);
    cachedConfig = fallback;
    return structuredClone(fallback);
  }

  const { config: merged, migrated, warnings } = migrateAndNormalize(parsed);
  for (const warning of warnings) console.warn(`[Config] ${warning}`);
  if (migrated) {
    persistConfig(merged, configPath);
    console.log(`[Config] 已迁移到 config_version=${CONFIG_VERSION} 并回写`);
  }

  cachedConfig = merged;
  return structuredClone(merged);
}

// ---------------------------------------------------------------------------
// migrateAndNormalize — 版本判定 → v0 补字段 → v1→v2 迁移 → 白名单归一化
//   纯函数（除平台相关的模型目录修正），便于脱离 electron 单测迁移行为
// ---------------------------------------------------------------------------

export function migrateAndNormalize(parsed: unknown): {
  config: Config;
  migrated: boolean;
  warnings: string[];
} {
  const raw = isPlainObject(parsed) ? parsed : {};
  const version = typeof raw.config_version === 'number' && Number.isFinite(raw.config_version)
    ? Math.trunc(raw.config_version)
    : 0;

  let merged: Config;
  let migrated = false;
  let warnings: string[] = [];

  if (version < CONFIG_VERSION) {
    if (version < 1) migrateV0Fields(raw);
    const result = migrateV1ToV2(raw);
    merged = normalizeConfig(result.config);
    warnings = result.warnings;
    migrated = true; // 低于当前版本一律回写一次，避免每次启动重复迁移
    merged.config_version = CONFIG_VERSION;
  } else {
    if (version > CONFIG_VERSION) {
      warnings = [`config_version=${version} 高于本程序支持的 ${CONFIG_VERSION}，按当前版本使用`];
    }
    merged = normalizeConfig(raw);
    merged.config_version = version;
  }

  // 非 Windows 平台：Windows 风格模型目录自动替换为 ~/models
  const modelsDir = getPath(merged, 'server.models_dir');
  if (process.platform !== 'win32' && typeof modelsDir === 'string' && /^[A-Za-z]:[\\/]/.test(modelsDir)) {
    warnings = [
      ...warnings,
      `models_dir "${modelsDir}" 在 ${process.platform} 下无效，已替换为 ~/models`,
    ];
    setPath(merged as unknown as Record<string, unknown>, 'server.models_dir', path.join(os.homedir(), 'models'));
  }

  return { config: merged, migrated, warnings };
}

// ---------------------------------------------------------------------------
// saveConfig — 归一化后原子写入（供 IPC 调用）
// ---------------------------------------------------------------------------

export function saveConfig(config: unknown): Config {
  const cfg = normalizeConfig(config);
  cfg.config_version = CONFIG_VERSION;
  persistConfig(cfg, getConfigPath());
  cachedConfig = cfg;
  return structuredClone(cfg);
}

// ---------------------------------------------------------------------------
// updateConfigField — 点分隔路径更新单个字段
//   示例: 'server.port', 'model.ctx_size', 'rpc.server.port'
//   路径必须存在于参数表或应用层字段白名单里（原型键一律拒绝）
// ---------------------------------------------------------------------------

export function updateConfigField(key: ConfigKey | string, value: unknown): Config {
  const config = getCachedConfig() ?? loadConfig();
  const root = config as unknown as Record<string, unknown>;
  const blocked = ['__proto__', 'constructor', 'prototype'];
  if (!key || key.split('.').some((part) => blocked.includes(part))) {
    throw new Error(`非法配置键: ${JSON.stringify(key)}`);
  }

  const def = PARAM_INDEX.get(key);
  const appKind = APP_FIELDS[key];
  if (!def && !appKind) throw new Error(`未知配置键: ${key}`);

  const cleaned = def ? cleanParam(def, value) : cleanAppField(appKind as 'bool' | 'string' | 'int', value);
  if (cleaned === undefined) {
    const expected = def ? def.type : appKind;
    throw new Error(`配置键 ${key} 类型不符：期望 ${expected}，收到 ${JSON.stringify(value)}`);
  }
  setPath(root, key, cleaned);
  return saveConfig(config);
}

// ---------------------------------------------------------------------------
// getCachedConfig — 获取缓存的配置副本（避免重复读文件）
// ---------------------------------------------------------------------------

export function getCachedConfig(): Config | null {
  return cachedConfig ? structuredClone(cachedConfig) : null;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 落盘前必备份一次（同一进程只备份首轮，避免 .bak 被后续写覆盖丢失原始数据） */
function ensureBackupOnce(configPath: string): void {
  if (backupDone) return;
  backupDone = true;
  if (!fs.existsSync(configPath)) return;
  try {
    fs.copyFileSync(configPath, `${configPath}.bak`);
  } catch (err) {
    console.error('[Config] 备份 config.json → .bak 失败:', err);
  }
}

function persistConfig(config: Config, configPath: string): void {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    ensureBackupOnce(configPath);
    writeFileAtomic(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[Config] 写入 config.json 失败:', err);
    throw err;
  }
}

/**
 * v0 → v1 补齐（llama.cpp build 10964 参数对齐），在原始 JSON 上就地改写后再交给 v1→v2：
 *   mlock/no_mmap → load_mode；numa 布尔 → 带值字符串；
 *   tensor_batch 删除并补 threads_batch；隐式 draft-mtp 由 mtp 推断。
 *   v1 里被删除的 rpc_server.workers/timeout 无需处理（v1→v2 只读 enabled/host/port）。
 */
function migrateV0Fields(user: Record<string, unknown>): void {
  const optional = isPlainObject(user.optional) ? user.optional : {};
  user.optional = optional;

  if (optional.load_mode === undefined) {
    optional.load_mode =
      optional.mlock === true ? 'mlock' : optional.no_mmap === true ? 'none' : 'auto';
    // 旧版「关闭 cont_batching」实际从不传参（即始终开启），迁移时保持 true 以不改变行为
    if (optional.cont_batching === false) optional.cont_batching = true;
  }
  if (typeof optional.numa === 'boolean') {
    optional.numa = optional.numa ? 'distribute' : 'none';
  }
  delete optional.mlock;
  delete optional.no_mmap;

  if ('tensor_batch' in user) {
    user.threads_batch = typeof user.threads_batch === 'number' ? user.threads_batch : 0;
    delete user.tensor_batch;
  }
  if (user.spec_type === undefined && typeof user.mtp === 'number' && user.mtp > 0) {
    user.spec_type = 'draft-mtp';
  }
}
