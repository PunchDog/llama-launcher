// =============================================================================
// useServer — 服务器状态管理 Hook
//   管理 llama-server 进程状态、日志和启停操作
// =============================================================================

import { useState, useCallback, useEffect } from 'react';
import { Config, ServerState, ServerStateLabel } from '@/shared/types';
import { invoke, on, removeAllListeners } from './api';

interface UseServerReturn {
  state: ServerState;
  stateLabel: string;
  logs: string[];
  loading: boolean;
  error: string | null;
  startServer: (cfg: Config) => Promise<void>;
  stopServer: () => Promise<void>;
  refreshState: () => Promise<void>;
  clearLogs: () => void;
  getCommand: () => Promise<string>;
  previewCommand: (cfg: Config) => Promise<string>;
}

export function useServer(): UseServerReturn {
  const [state, setState] = useState<ServerState>(ServerState.Stopped);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 实时日志监听
  useEffect(() => {
    const unsubscribe = on('server:on-log', (log: string) => {
      setLogs((prev) => {
        const next = [...prev, log];
        // 环形缓冲区：最多 5000 条
        if (next.length > 5000) {
          return next.slice(-5000);
        }
        return next;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const currentState = await invoke('server:get-state');
      setState(currentState);
    } catch (err) {
      console.error('[useServer] 获取状态失败:', err);
    }
  }, []);

  useEffect(() => {
    refreshState();
    const interval = setInterval(refreshState, 2000);
    return () => clearInterval(interval);
  }, [refreshState]);

  const startServer = useCallback(
    async (cfg: Config) => {
      setLoading(true);
      setError(null);
      try {
        await invoke('server:start', { args: [] });
        setState(ServerState.Starting);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        console.error('[useServer] 启动失败:', msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const stopServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke('server:stop');
      setState(ServerState.Stopping);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[useServer] 停止失败:', msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getCommand = useCallback(async () => {
    return await invoke('server:get-command');
  }, []);

  const previewCommand = useCallback(async (cfg: Config) => {
    return await invoke('server:preview-command', cfg);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    state,
    stateLabel: ServerStateLabel[state] ?? '未知',
    logs,
    loading,
    error,
    startServer,
    stopServer,
    refreshState,
    clearLogs,
    getCommand,
    previewCommand,
  };
}
