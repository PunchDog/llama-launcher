// =============================================================================
// migrate — config.json v1 → v2
//   原则：迁移前后发射出的命令行必须逐字一致（tests/params.migration.mjs 强断言），
//   例外只有两处刻意的行为变更，见 INTENTIONAL_DIFFS。
//   取值规则来自 ParamDef.legacy：旧版无条件发射 → 显式值；旧版按谓词跳过 → inherit。
// =============================================================================

import type { Config, ConfigPreset, ConfigKey } from '../types';
import { ALL_PARAMS, DEFAULT_PARAMS, KEY_ALIASES } from './index';
import { getPath, setPath } from './emit';

/** v1 里存在、但从未参与命令行发射也未被任何参数认领的键 — 迁移后原样保留并提示 */
const V1_APP_KEYS = new Set(['config_version', 'presets', 'proxy_enabled', 'proxy_url', 'rpc_server']);

export interface MigrationResult {
  config: Config;
  warnings: string[];
}

function toParamValue(key: ConfigKey, raw: unknown): unknown {
  const def = ALL_PARAMS.find((d) => d.key === key);
  if (!def) return raw;
  if (def.type === 'int' || def.type === 'float') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : null;
  }
  if (def.type === 'string' || def.type === 'secret' || def.type === 'path' || def.type === 'enum') {
    return typeof raw === 'string' ? raw : String(raw);
  }
  return raw;
}

/** ngram/mod 类不需要草稿模型，但 v1 会带上 spec_draft_ngl 的默认值，迁移时按 legacy 谓词处理 */
function migrateReasoningKwargs(v1: Record<string, unknown>, out: Config, warnings: string[]): void {
  const raw = getPath(v1, 'optional.chatTemplateKwargs');
  if (typeof raw !== 'string' || !raw.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    setPath(out as unknown as Record<string, unknown>, 'reasoning.chat_template_kwargs', raw);
    warnings.push('optional.chatTemplateKwargs 不是合法 JSON，已原样保留，请手工修正');
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    setPath(out as unknown as Record<string, unknown>, 'reasoning.chat_template_kwargs', raw);
    warnings.push('optional.chatTemplateKwargs 不是 JSON 对象，已原样保留');
    return;
  }
  const rest = { ...(parsed as Record<string, unknown>) };
  const preserve = rest.preserve_thinking;
  if (typeof preserve === 'boolean') {
    // 旧版靠 chat-template-kwargs 变通实现，v2 有官方 --reasoning-preserve
    setPath(out as unknown as Record<string, unknown>, 'reasoning.reasoning_preserve', preserve);
    delete rest.preserve_thinking;
  }
  const leftover = Object.keys(rest).length ? JSON.stringify(rest) : null;
  setPath(out as unknown as Record<string, unknown>, 'reasoning.chat_template_kwargs', leftover);
}

/** v1 早期把 --numa 当布尔用，v2 必须带值；预设里同样要做这步清洗 */
const LEGACY_BOOL_NUMA = new Set(['numa', 'optional.numa']);

function migratePresets(v1: Record<string, unknown>, warnings: string[]): ConfigPreset[] {
  const raw = getPath(v1, 'presets');
  if (!Array.isArray(raw)) return [];
  const out: ConfigPreset[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    // changes 是「点路径 → 值」的扁平表，不能按路径展开成嵌套对象
    const changes: Record<string, unknown> = {};

    const take = (legacyPath: string, raw: unknown): void => {
      const value =
        LEGACY_BOOL_NUMA.has(legacyPath) && typeof raw === 'boolean' ? (raw ? 'distribute' : 'none') : raw;
      const key = KEY_ALIASES.get(legacyPath);
      if (!key) {
        warnings.push(`预设 ${String(item.id ?? '?')} 里的 ${legacyPath} 已不存在，迁移时丢弃`);
        return;
      }
      const converted = toParamValue(key as ConfigKey, value);
      if (converted === null) {
        warnings.push(`预设 ${String(item.id ?? '?')} 里的 ${legacyPath} 取值无法识别，迁移时丢弃`);
        return;
      }
      changes[key] = converted;
    };
    for (const group of [item.config, item.optional] as Record<string, unknown>[]) {
      if (!group || typeof group !== 'object') continue;
      const prefix = group === item.optional ? 'optional.' : '';
      for (const [name, value] of Object.entries(group)) {
        // 手改过的 v1 预设会把可选参数嵌在 config.optional 里
        if (!prefix && name === 'optional' && value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
            take(`optional.${sub}`, subValue);
          }
          continue;
        }
        take(`${prefix}${name}`, value);
      }
    }
    out.push({
      id: String(item.id ?? `migrated-${out.length + 1}`),
      name: String(item.name ?? '未命名预设'),
      desc: String(item.desc ?? ''),
      hint: String(item.hint ?? ''),
      changes: changes as Partial<Record<ConfigKey, number | string | boolean | string[]>>,
    });
  }
  return out;
}

export function migrateV1ToV2(v1: Record<string, unknown>): MigrationResult {
  const warnings: string[] = [];
  const config = structuredClone(DEFAULT_PARAMS) as unknown as Record<string, unknown>;

  for (const def of ALL_PARAMS) {
    if (!def.legacy) continue;
    const raw = getPath(v1, def.legacy.path);
    if (raw === undefined || raw === null) continue;
    if (def.legacy.emits && !def.legacy.emits(raw)) continue;
    const value = toParamValue(def.key as ConfigKey, raw);
    if (value === null) {
      warnings.push(`${def.legacy.path} 取值无法识别，迁移后改为跟随 llama.cpp 默认`);
      continue;
    }
    setPath(config, def.key, value);
  }

  // 应用层字段
  const proxyEnabled = getPath(v1, 'proxy_enabled');
  const proxyUrl = getPath(v1, 'proxy_url');
  const rpc = getPath(v1, 'rpc_server') as Record<string, unknown> | undefined;
  const rpcEnabled = rpc?.enabled === true;
  const rpcHost = typeof rpc?.host === 'string' ? rpc.host : '127.0.0.1';
  const rpcPort = Number.isFinite(Number(rpc?.port)) ? Number(rpc?.port) : 50052;
  config.proxy = {
    enabled: typeof proxyEnabled === 'boolean' ? proxyEnabled : false,
    url: typeof proxyUrl === 'string' ? proxyUrl : '',
  };
  config.rpc = {
    server: { enabled: rpcEnabled, host: rpcHost, port: rpcPort },
    // v1 只有一个端点，迁移成 v2 的列表；未开启时保持 inherit
    endpoints: rpcEnabled ? [`${rpcHost}:${rpcPort}`] : [],
  };
  config.presets = migratePresets(v1, warnings);
  migrateReasoningKwargs(v1, config as unknown as Config, warnings);

  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v1)) {
    if (V1_APP_KEYS.has(key)) continue;
    if (KEY_ALIASES.has(key)) continue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        const legacyPath = `${key}.${sub}`;
        if (!KEY_ALIASES.has(legacyPath)) unknown[legacyPath] = subValue;
      }
      continue;
    }
    unknown[key] = value;
  }
  if (Object.keys(unknown).length) {
    config.unknown_v1 = unknown;
    warnings.push(`发现 ${Object.keys(unknown).length} 个未被参数表认领的旧字段，已原样存入 unknown_v1（不会发射到命令行）`);
  }

  config.config_version = 2;
  return { config: config as unknown as Config, warnings };
}

/**
 * 刻意与旧版命令行不一致的 flag — golden 迁移测试按此表放行，其余差异一律视为回归。
 * 键用命令行 flag（测试比对的是发射结果，不是配置字段）。
 */
export const INTENTIONAL_DIFFS: readonly { readonly flag: string; readonly reason: string }[] = [
  {
    flag: '--chat-template-kwargs',
    reason: '旧版靠 --chat-template-kwargs {"preserve_thinking":true} 变通保留思考内容',
  },
  {
    flag: '--reasoning-preserve',
    reason: 'v2 改用官方 --reasoning-preserve 实现同一意图',
  },
];
