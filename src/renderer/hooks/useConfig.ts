// =============================================================================
// useConfig — 配置状态管理 Hook
//   通过 IPC 与主进程通信，管理 Config 的加载/保存/更新
// =============================================================================

import { useState, useCallback, useEffect } from 'react';
import { Config } from '@/shared/types';
import { invoke } from './api';

interface UseConfigReturn {
  config: Config | null;
  loading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: Config) => Promise<void>;
  updateField: (key: string, value: unknown) => Promise<void>;
}

export function useConfig(): UseConfigReturn {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await invoke('config:load');
      setConfig(cfg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[useConfig] 加载配置失败:', msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (cfg: Config) => {
    setError(null);
    try {
      await invoke('config:save', cfg);
      setConfig(cfg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[useConfig] 保存配置失败:', msg);
      throw err;
    }
  }, []);

  const updateField = useCallback(async (key: string, value: unknown) => {
    setError(null);
    try {
      await invoke('config:update', { key, value });
      // 乐观更新本地状态
      setConfig((prev) => {
        if (!prev) return prev;
        const updated = JSON.parse(JSON.stringify(prev)) as Config;
        const parts = key.split('.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let target: any = updated;
        for (let i = 0; i < parts.length - 1; i++) {
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
        return updated;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[useConfig] 更新配置失败:', msg);
      throw err;
    }
  }, []);

  // 初始化加载配置
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return {
    config,
    loading,
    error,
    loadConfig,
    saveConfig,
    updateField,
  };
}
