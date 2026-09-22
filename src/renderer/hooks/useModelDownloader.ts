// =============================================================================
// useModelDownloader — downloaderStore 的薄适配层
//   P4 兼容旧调用点；下载进度已改为主进程推送，500ms 轮询删除。
// =============================================================================

import { useCallback } from 'react';
import type { ModelDownloadState, ModelFile, ModelInfo, ModelScopeEnvState } from '@/shared/types';
import { useDownloaderStore } from '@/renderer/stores/downloaderStore';

interface UseModelDownloaderReturn {
  state: ModelDownloadState;
  env: ModelScopeEnvState | null;
  models: ModelInfo[];
  /** 当前浏览模型的文件清单 */
  files: ModelFile[];
  /** 文件清单所属的模型 id */
  browsed: string;
  /** 当前输入模型的勾选文件 */
  selectedFiles: string[];
  /** 下载目标输入框 */
  target: string;
  error: string | null;
  searching: boolean;
  setTarget: (id: string) => void;
  checkEnv: () => Promise<void>;
  installModelscope: () => Promise<void>;
  searchModels: (keyword: string) => Promise<void>;
  listFiles: (modelId: string) => Promise<void>;
  toggleFile: (path: string) => void;
  clearSelection: () => void;
  download: (req: { modelId: string; localDir: string; files?: string[]; mode: 'http' | 'cli' }) => Promise<void>;
  cancel: () => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;
  refreshProgress: () => Promise<void>;
  clearError: () => void;
}

export function useModelDownloader(): UseModelDownloaderReturn {
  const s = useDownloaderStore();
  const files = s.filesByModel[s.browsed] ?? [];
  const selectedFiles = s.selectedByModel[s.target] ?? [];

  const toggleFile = useCallback(
    (path: string) => s.toggleFile(path, !(s.selectedByModel[s.target] ?? []).includes(path)),
    [s],
  );

  return {
    state: s.state,
    env: s.env,
    models: s.models,
    files,
    browsed: s.browsed,
    selectedFiles,
    target: s.target,
    error: s.error,
    searching: s.searching,
    setTarget: s.setTarget,
    checkEnv: s.checkEnv,
    installModelscope: s.installModelscope,
    searchModels: s.searchModels,
    listFiles: s.listFiles,
    toggleFile,
    clearSelection: s.clearSelection,
    download: s.download,
    cancel: s.cancel,
    setProxy: s.setProxy,
    refreshProgress: s.refresh,
    clearError: s.clearError,
  };
}
