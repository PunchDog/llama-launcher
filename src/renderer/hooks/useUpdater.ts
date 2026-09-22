// =============================================================================
// useUpdater — updaterStore 的薄适配层（P4 兼容旧调用点，P5 拆到 features/core 时删除）
// =============================================================================

import type { UpdaterState } from '@/shared/types';
import { useUpdaterStore, type LatestRelease } from '@/renderer/stores/updaterStore';

interface UseUpdaterReturn {
  updater: UpdaterState;
  error: string | null;
  checkLatest: () => Promise<LatestRelease | null>;
  checkCoreExists: () => Promise<boolean>;
  getLocalVersion: () => Promise<string>;
  downloadAndExtract: () => Promise<void>;
  extractSpecific: (filename: string) => Promise<void>;
  listDownloadedFiles: () => Promise<string[]>;
  refreshProgress: () => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;
  setBackend: (backend: string) => Promise<void>;
  clearError: () => void;
}

export function useUpdater(): UseUpdaterReturn {
  const updater = useUpdaterStore((s) => s.updater);
  const error = useUpdaterStore((s) => s.error);
  const checkLatest = useUpdaterStore((s) => s.checkLatest);
  const checkCoreExists = useUpdaterStore((s) => s.checkCoreExists);
  const getLocalVersion = useUpdaterStore((s) => s.getLocalVersion);
  const downloadAndExtract = useUpdaterStore((s) => s.downloadAndExtract);
  const extractSpecific = useUpdaterStore((s) => s.extractSpecific);
  const listDownloadedFiles = useUpdaterStore((s) => s.listDownloadedFiles);
  const refresh = useUpdaterStore((s) => s.refresh);
  const setProxy = useUpdaterStore((s) => s.setProxy);
  const setBackend = useUpdaterStore((s) => s.setBackend);
  const clearError = useUpdaterStore((s) => s.clearError);

  return {
    updater,
    error,
    checkLatest,
    checkCoreExists,
    getLocalVersion,
    downloadAndExtract,
    extractSpecific,
    listDownloadedFiles,
    refreshProgress: refresh,
    setProxy,
    setBackend,
    clearError,
  };
}
