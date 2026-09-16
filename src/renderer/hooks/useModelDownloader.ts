// =============================================================================
// useModelDownloader — ModelScope 模型下载状态管理 Hook
//   管理环境检测 / 模型搜索 / 文件列表 / 下载进度，500ms 轮询 model:get-progress
// =============================================================================

import { useState, useCallback, useEffect } from 'react';
import {
  ModelScopeEnvState,
  ModelInfo,
  ModelFile,
  ModelDownloadState,
} from '@/shared/types';
import { invoke } from './api';

interface UseModelDownloaderReturn {
  state: ModelDownloadState;
  env: ModelScopeEnvState | null;
  models: ModelInfo[];
  files: ModelFile[];
  error: string | null;
  checkEnv: () => Promise<void>;
  installModelscope: () => Promise<void>;
  searchModels: (keyword: string) => Promise<void>;
  listFiles: (modelId: string) => Promise<void>;
  download: (req: { modelId: string; localDir: string; files?: string[]; mode: 'http' | 'cli' }) => Promise<void>;
  cancel: () => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;
  refreshProgress: () => Promise<void>;
  clearError: () => void;
}

const initialState: ModelDownloadState = {
  progress: 0,
  status: '空闲',
  error: '',
  isDownloading: false,
  mode: '',
  modelId: '',
  localDir: '',
  currentFile: '',
  downloadedBytes: 0,
  downloadSize: 0,
  httpFailed: false,
  files: [],
  selectedFiles: [],
};

export function useModelDownloader(): UseModelDownloaderReturn {
  const [state, setState] = useState<ModelDownloadState>(initialState);
  const [env, setEnv] = useState<ModelScopeEnvState | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshProgress = useCallback(async () => {
    try {
      const progress = await invoke('model:get-progress');
      setState(progress);
    } catch {
      // 静默失败，下载器可能在空闲状态
    }
  }, []);

  // 挂载即检测环境
  const checkEnv = useCallback(async () => {
    setError(null);
    try {
      const result = await invoke('model:check-env');
      setEnv(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, []);

  useEffect(() => {
    checkEnv();
  }, [checkEnv]);

  const installModelscope = useCallback(async () => {
    setError(null);
    try {
      await invoke('model:install-modelscope');
      await checkEnv();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [checkEnv]);

  const searchModels = useCallback(async (keyword: string) => {
    setError(null);
    try {
      const result = await invoke('model:search-models', { keyword });
      setModels(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setModels([]);
    }
  }, []);

  const listFiles = useCallback(async (modelId: string) => {
    setError(null);
    try {
      const result = await invoke('model:list-files', { modelId });
      setFiles(result);
      setState((prev) => ({ ...prev, files: result, selectedFiles: [] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setFiles([]);
    }
  }, []);

  const download = useCallback(
    async (req: { modelId: string; localDir: string; files?: string[]; mode: 'http' | 'cli' }) => {
      setError(null);
      setState((prev) => ({
        ...prev,
        isDownloading: true,
        mode: req.mode,
        modelId: req.modelId,
        localDir: req.localDir,
        status: req.mode === 'cli' ? 'Python 工具下载中...' : 'HTTPS 下载中...',
        progress: 0,
        error: '',
        httpFailed: false,
      }));
      try {
        await invoke('model:download', req);
        await refreshProgress();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        // 拉取主进程最新状态（含 httpFailed 标记）
        await refreshProgress();
        setState((prev) => ({ ...prev, isDownloading: false, error: msg }));
      }
    },
    [refreshProgress],
  );

  const cancel = useCallback(async () => {
    try {
      await invoke('model:cancel');
      // 立即同步主进程已复位的状态（进度条隐藏 / 按钮文案复原）
      await refreshProgress();
      setState((prev) => ({ ...prev, isDownloading: false }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [refreshProgress]);

  const setProxy = useCallback(async (proxy: string) => {
    await invoke('model:set-proxy', { proxy });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setState((prev) => ({ ...prev, error: '' }));
  }, []);

  // 轮询下载进度
  useEffect(() => {
    if (!state.isDownloading) return;
    const interval = setInterval(refreshProgress, 500);
    return () => clearInterval(interval);
  }, [state.isDownloading, refreshProgress]);

  // 挂载时恢复进度状态（避免切换 Tab 后状态丢失）
  useEffect(() => {
    refreshProgress();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    env,
    models,
    files,
    error,
    checkEnv,
    installModelscope,
    searchModels,
    listFiles,
    download,
    cancel,
    setProxy,
    refreshProgress,
    clearError,
  };
}
