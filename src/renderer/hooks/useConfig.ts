// =============================================================================
// useConfig — configStore 的薄适配层（P4 兼容旧调用点，P5 布局重构时删除）
//   新代码请直接 useConfigStore / useParam。
// =============================================================================

import { useCallback, useEffect } from 'react';
import type { Config } from '@/shared/types';
import { useConfigStore } from '@/renderer/stores/configStore';

interface UseConfigReturn {
  config: Config | null;
  loading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: Config) => Promise<void>;
  updateField: (key: string, value: unknown) => Promise<void>;
  /** 立即把防抖窗口内的修改落盘（启动前调用） */
  flushNow: () => Promise<boolean>;
}

export function useConfig(): UseConfigReturn {
  const config = useConfigStore((s) => s.config);
  const loading = useConfigStore((s) => s.loading);
  const error = useConfigStore((s) => s.error);
  const load = useConfigStore((s) => s.load);
  const replace = useConfigStore((s) => s.replace);
  const setParam = useConfigStore((s) => s.setParam);
  const flush = useConfigStore((s) => s.flushNow);

  const saveConfig = useCallback(
    async (cfg: Config) => {
      await replace(cfg);
    },
    [replace],
  );

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

  return { config, loading, error, loadConfig: load, saveConfig, updateField, flushNow: flush };
}
