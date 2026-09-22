// =============================================================================
// paramDiff — 「偏离启动器默认」判定
//   界面的「已改」标记与「只看已改」过滤都以此为唯一口径：
//   与 DEFAULT_PARAMS 比（而不是与 lastSaved 比），语义是「这条参数会不会发射」。
//   v1 迁移会把老配置里的值全变成 explicit，因此这些参数会一律标为已改 —— 正是
//   想要提醒用户的地方（显式值会盖住 llama-server 的 --fit 自适应）。
// =============================================================================

import { DEFAULT_PARAMS, getPath, isInherit } from '@/shared/params';

function sameTri(a: unknown, b: unknown): boolean {
  if (isInherit(a) && isInherit(b)) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** 参数表里该 key 的启动器默认值 */
export function defaultOf(key: string): unknown {
  return getPath(DEFAULT_PARAMS, key);
}

export function isDeviated(config: unknown, key: string): boolean {
  return !sameTri(getPath(config, key), defaultOf(key));
}

/** 当前配置里所有偏离默认的 key（用于「已改 N 项」统计与过滤） */
export function deviatedKeys(config: unknown, keys: readonly string[]): string[] {
  return keys.filter((key) => isDeviated(config, key));
}
