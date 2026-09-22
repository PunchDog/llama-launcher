// =============================================================================
// useParam — 单个参数的订阅粒度收口
//   每个字段控件只 select 自己那条点路径（原语值按值比较），
//   因此改一个参数只重渲染一个控件，而不是整张卡片 / 整页。
//   参数元数据直接从 shared 里读，不经过 IPC。
// =============================================================================

import { useCallback } from 'react';
import { getPath, paramDef } from '@/shared/params';
import type { AnyParamDef } from '@/shared/params/schema';
import { useConfigStore } from '@/renderer/stores/configStore';
import { defaultOf, isDeviated } from '@/renderer/utils/paramDiff';

export interface ParamBinding {
  def: AnyParamDef | undefined;
  /** config 里的当前值；null/undefined 表示 inherit */
  value: unknown;
  setValue: (value: unknown) => void;
  /** 与启动器默认值不同（界面高亮 + 「只看已改」过滤） */
  deviated: boolean;
  /** 恢复为启动器默认值（多数参数的默认就是 inherit） */
  reset: () => void;
}

export function useParam(key: string): ParamBinding {
  const def = paramDef(key);
  const value = useConfigStore((s) => (s.config ? getPath(s.config, key) : null));
  const deviated = useConfigStore((s) => (s.config ? isDeviated(s.config, key) : false));
  const setParam = useConfigStore((s) => s.setParam);

  const setValue = useCallback((v: unknown) => setParam(key, v), [key, setParam]);
  const reset = useCallback(() => setParam(key, defaultOf(key)), [key, setParam]);

  return { def, value, setValue, deviated, reset };
}

/** 元数据派生的展示信息：不订阅 config，纯函数 */
export function useParamMeta(def: AnyParamDef | undefined): {
  tooltip: string;
  inheritLabel: string;
} {
  if (!def) return { tooltip: '', inheritLabel: '跟随默认' };
  const tooltip = [def.desc, def.flag ? `${def.flag}${def.short ? ` / ${def.short}` : ''}` : '']
    .filter(Boolean)
    .join('　');
  return { tooltip, inheritLabel: `跟随默认 (${def.llamaDefault ?? '未设置'})` };
}
