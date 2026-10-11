// =============================================================================
// useModelDownloader — downloaderStore 的薄适配层
//   P4 兼容旧调用点；下载进度已改为主进程推送，500ms 轮询删除。
//   逐字段订阅：整体订阅会让「与本页无关」的 store 变动也触发整页重渲染。
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
  setTarget: (id: string) => void;
  installModelscope: () => Promise<void>;
  searchModels: (keyword: string) => Promise<void>;
  listFiles: (modelId: string) => Promise<void>;
  toggleFile: (path: string) => void;
  download: (req: { modelId: string; localDir: string; files?: string[]; mode: 'http' | 'cli' }) => Promise<void>;
  cancel: () => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;
}

/** 稳定空数组：缺 key 时选择器不至于每次都返回新引用 */
const NO_FILES: ModelFile[] = [];
const NO_SELECTED: string[] = [];

export function useModelDownloader(): UseModelDownloaderReturn {
  const state = useDownloaderStore((s) => s.state);
  const env = useDownloaderStore((s) => s.env);
  const models = useDownloaderStore((s) => s.models);
  const browsed = useDownloaderStore((s) => s.browsed);
  const target = useDownloaderStore((s) => s.target);
  const error = useDownloaderStore((s) => s.error);
  const files = useDownloaderStore((s) => s.filesByModel[browsed] ?? NO_FILES);
  const selectedFiles = useDownloaderStore((s) => s.selectedByModel[target] ?? NO_SELECTED);
  const setTarget = useDownloaderStore((s) => s.setTarget);
  const installModelscope = useDownloaderStore((s) => s.installModelscope);
  const searchModels = useDownloaderStore((s) => s.searchModels);
  const listFiles = useDownloaderStore((s) => s.listFiles);
  const toggleFileRaw = useDownloaderStore((s) => s.toggleFile);
  const download = useDownloaderStore((s) => s.download);
  const cancel = useDownloaderStore((s) => s.cancel);
  const setProxy = useDownloaderStore((s) => s.setProxy);

  const toggleFile = useCallback(
    (path: string) => {
      const { target: id, selectedByModel } = useDownloaderStore.getState();
      toggleFileRaw(path, !(selectedByModel[id] ?? NO_SELECTED).includes(path));
    },
    [toggleFileRaw],
  );

  return {
    state,
    env,
    models,
    files,
    browsed,
    selectedFiles,
    target,
    error,
    setTarget,
    installModelscope,
    searchModels,
    listFiles,
    toggleFile,
    download,
    cancel,
    setProxy,
  };
}
