// =============================================================================
// 参数元数据层入口 — 各参数组在此按「命令行发射顺序」聚合
//   加/改参数只改 groups/*.ts 与 types.ts 的对应接口，本文件通常不需要动
// =============================================================================

import type { ConfigKey, ParamsConfig } from '../types';
import type { AnyParamDef, ParamDef, ParamGroupId } from './schema';
import { isInherit, getPath, ruleMet } from './emit';

import { PARAMS_SERVER } from './groups/server';
import { PARAMS_MODEL } from './groups/model';
import { PARAMS_MEMORY } from './groups/memory';
import { PARAMS_COMPUTE } from './groups/compute';
import { PARAMS_SAMPLING } from './groups/sampling';
import { PARAMS_SPECULATIVE } from './groups/speculative';
import { PARAMS_REASONING } from './groups/reasoning';
import { PARAMS_MULTIMODAL } from './groups/multimodal';
import { PARAMS_LORA } from './groups/lora';
import { PARAMS_RPC } from './groups/rpc';
import { PARAMS_ADVANCED } from './groups/advanced';
import { PARAMS_EXTRA } from './groups/extra';

/** 组顺序 = 命令行发射顺序；extra 必须最后（raw 参数要能压住界面上的值） */
export const PARAM_GROUPS = [
  PARAMS_SERVER,
  PARAMS_MODEL,
  PARAMS_MEMORY,
  PARAMS_COMPUTE,
  PARAMS_SAMPLING,
  PARAMS_SPECULATIVE,
  PARAMS_REASONING,
  PARAMS_MULTIMODAL,
  PARAMS_LORA,
  PARAMS_RPC,
  PARAMS_ADVANCED,
  PARAMS_EXTRA,
] as const;

export const PARAMS_BY_GROUP: Record<ParamGroupId, readonly AnyParamDef[]> = {
  server: PARAMS_SERVER,
  model: PARAMS_MODEL,
  memory: PARAMS_MEMORY,
  compute: PARAMS_COMPUTE,
  sampling: PARAMS_SAMPLING,
  speculative: PARAMS_SPECULATIVE,
  reasoning: PARAMS_REASONING,
  multimodal: PARAMS_MULTIMODAL,
  lora: PARAMS_LORA,
  rpc: PARAMS_RPC,
  advanced: PARAMS_ADVANCED,
  extra: PARAMS_EXTRA,
};

/** UI 卡片标题（组顺序沿用 PARAM_GROUPS） */
export const GROUP_META: Record<ParamGroupId, { title: string; desc: string }> = {
  server: { title: '服务与网络', desc: '监听地址、接口端点与模型路由' },
  model: { title: '模型与上下文', desc: '模型文件、上下文规模、位置编码扩展、对话模板' },
  memory: { title: '显存与缓存', desc: '层卸载、KV/提示缓存、--fit 自适应' },
  compute: { title: '计算与线程', desc: 'CPU 线程、亲和性、NUMA、MoE 权重驻留' },
  sampling: { title: '采样', desc: '生成随机性、重复惩罚与结构化输出' },
  speculative: { title: '投机解码', desc: '草稿模型与 n-gram 加速' },
  reasoning: { title: '思考链', desc: '推理模型的思考输出与保留策略' },
  multimodal: { title: '多模态', desc: '视觉投影器与图像/视频输入' },
  lora: { title: 'LoRA 与控制向量', desc: '适配器加载与缩放' },
  rpc: { title: 'RPC 分布式', desc: '把层卸载到其他机器' },
  advanced: { title: '日志与高级覆写', desc: '日志行为、元数据覆写、实验特性' },
  extra: { title: '追加原始参数', desc: '不校验，直接拼到命令行末尾' },
};

export const ALL_PARAMS: readonly AnyParamDef[] = PARAM_GROUPS.flat();

/**
 * 编译期穷尽性检查：ParamsConfig 的每个点路径都必须被某张参数表声明。
 * 少一条就会有一个界面字段永远发不到命令行（或反过来：类型里有、表里没有）。
 */
type CoveredKey = (typeof PARAM_GROUPS)[number][number]['key'];
type AssertNever<C extends never> = C;
export type UncoveredConfigKeys = AssertNever<Exclude<ConfigKey, CoveredKey>>;

export const PARAM_INDEX: ReadonlyMap<string, AnyParamDef> = new Map(
  ALL_PARAMS.map((def) => [def.key, def]),
);

/** v1 字段路径 → v2 点路径，供配置迁移与旧预设重映射使用 */
export const KEY_ALIASES: ReadonlyMap<string, string> = new Map(
  ALL_PARAMS.filter((def) => def.legacy).map((def) => [def.legacy!.path, def.key]),
);

/** 元数据派生的参数默认值：除启动器必须知道的值外全部 inherit */
export const DEFAULT_PARAMS: ParamsConfig = buildDefaults();

function buildDefaults(): ParamsConfig {
  const root = {} as Record<string, Record<string, unknown>>;
  for (const def of ALL_PARAMS) {
    const [group, field] = def.key.split('.');
    if (!root[group]) root[group] = {};
    root[group][field] = def.default ?? null;
  }
  return root as unknown as ParamsConfig;
}

export function paramDef(key: string): AnyParamDef | undefined {
  return PARAM_INDEX.get(key);
}

/**
 * 三态取实际生效值：inherit 时回落到参数表 default，再回落 llamaDefault。
 * 只用于启动器自己也要读的值（监听地址/端口）与界面展示，不用于命令行发射。
 */
export function effectiveValue(cfg: unknown, key: string): string | number | boolean {
  const current = getPath(cfg, key);
  if (!isInherit(current)) return current as string | number | boolean;
  const def = PARAM_INDEX.get(key);
  const fallback = def?.default ?? def?.llamaDefault ?? '';
  if (typeof fallback === 'number' || typeof fallback === 'boolean') return fallback;
  return Array.isArray(fallback) ? fallback.join(',') : String(fallback);
}

export type { ParamDef, AnyParamDef, ConfigKey };
export { getPath, setPath, setDeep, isInherit, buildArgs, ruleMet, unmetRequires } from './emit';

/** 展平成「点路径 → 当前值」映射，供界面的 requires / visibleWhen 判定 */
export function flatParams(cfg: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of ALL_PARAMS) out[def.key] = getPath(cfg, def.key);
  return out;
}

/**
 * 界面是否渲染该参数：与命令行发射条件保持一致，
 * 避免出现「界面上能填、填了却永远不发」的死控件。
 */
export function paramVisible(def: AnyParamDef, flat: Record<string, unknown>): boolean {
  if (def.requires && !def.requires.every((rule) => ruleMet(rule, flat[rule.key]))) return false;
  return def.visibleWhen ? def.visibleWhen(flat) : true;
}
