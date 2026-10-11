// =============================================================================
// useConfig — configStore 的薄适配层（P4 兼容旧调用点，P5 布局重构时删除）
//   新代码请直接 useConfigStore / useParam。
// =============================================================================

import { useCallback, useEffect } from 'react';
import type { Config } from '@/shared/types';
import { useConfigStore } from '@/renderer/stores/configStore';

interface UseConfigReturn {
  config: Config | null;
  error: string | null;
  updateField: (key: string, value: unknown) => Promise<void>;
}

export function useConfig(): UseConfigReturn {
  const config = useConfigStore((s) => s.config);
  const error = useConfigStore((s) => s.error);
  const load = useConfigStore((s) => s.load);
  const setParam = useConfigStore((s) => s.setParam);

  const updateField = useCallback(
    async (key: string, value: unknown) => {
      setParam(key, value);
    },
    [setParam],
  );

  // bridge 已在启动时加载；这里兜住「bridge 尚未启动就渲染」的测试场景
  useEffect(() => {
    if (!useConfigStore.getState().config && !useConfigStore.getState().loading) void load();
  }, [load]);

  return { config, error, updateField };
}
