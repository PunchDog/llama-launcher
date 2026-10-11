// =============================================================================
// useServer — serverStore 的薄适配层（P4 兼容旧调用点，P5 布局重构时删除）
//   日志已搬到 logsStore，本 hook 不再转发，避免每个订阅者各自持有副本。
// =============================================================================

import { useCallback } from 'react';
import type { Config, ServerState } from '@/shared/types';
import { ServerStateLabel } from '@/shared/types';
import { useServerStore } from '@/renderer/stores/serverStore';

interface UseServerReturn {
  state: ServerState;
  stateLabel: string;
  error: string | null;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  previewCommand: (cfg?: Config) => Promise<string>;
}

export function useServer(): UseServerReturn {
  const state = useServerStore((s) => s.state);
  const error = useServerStore((s) => s.error);
  const start = useServerStore((s) => s.start);
  const stop = useServerStore((s) => s.stop);
  const preview = useServerStore((s) => s.previewCommand);

  const safe = useCallback(
    (fn: () => Promise<void>): (() => Promise<void>) => () => fn().catch(() => undefined),
    [],
  );

  return {
    state,
    stateLabel: ServerStateLabel[state] ?? '未知',
    error,
    startServer: safe(start),
    stopServer: safe(stop),
    previewCommand: preview,
  };
}
