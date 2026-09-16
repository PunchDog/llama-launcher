// =============================================================================
// useUpdater — Core 更新器状态管理 Hook
//   管理 llama.cpp core 二进制文件的版本检查和下载更新
// =============================================================================

import { useState, useCallback, useEffect } from 'react';
import { UpdaterState } from '@/shared/types';
import { invoke } from './api';

interface UseUpdaterReturn {
  updater: UpdaterState;
  error: string | null;
  checkLatest: () => Promise<{ tag: string; releaseTag: string; size: number } | null>;
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

const initialState: UpdaterState = {
  progress: 0,
  status: '空闲',
  error: '',
  latestTag: '',
  latestReleaseTag: '',
  downloadURL: '',
  assetName: '',
  downloadedBytes: 0,
  downloadSize: 0,
  downloadSpeed: 0,
  isDownloading: false,
  selectedOS: '',
  selectedBackend: 'vulkan',
};

export function useUpdater(): UseUpdaterReturn {
  const [updater, setUpdater] = useState<UpdaterState>(initialState);
  const [error, setError] = useState<string | null>(null);

  const checkLatest = useCallback(async () => {
    setError(null);
    try {
      const result = await invoke('updater:check-latest');
      setUpdater((prev) => ({
        ...prev,
        latestTag: result.tag,
        latestReleaseTag: result.releaseTag,
        downloadSize: result.size,
        status:
          result.releaseTag && result.releaseTag !== result.tag
            ? `最新版本: ${result.releaseTag} (nightly ${result.tag})`
            : `最新版本: ${result.tag}`,
      }));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setUpdater((prev) => ({
        ...prev,
        status: `检查失败: ${msg}`,
        error: msg,
      }));
      return null;
    }
  }, []);

  const checkCoreExists = useCallback(async () => {
    try {
      return await invoke('updater:check-core-exists');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return false;
    }
  }, []);

  const getLocalVersion = useCallback(async () => {
    try {
      return await invoke('updater:get-local-version');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return '';
    }
  }, []);

  const downloadAndExtract = useCallback(async () => {
    setError(null);
    setUpdater((prev) => ({
      ...prev,
      isDownloading: true,
      status: '下载中...',
      progress: 0,
      error: '',
    }));
    try {
      await invoke('updater:download-and-extract');
      setUpdater((prev) => ({
        ...prev,
        isDownloading: false,
        status: '下载完成',
        progress: 100,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setUpdater((prev) => ({
        ...prev,
        isDownloading: false,
        status: `下载失败: ${msg}`,
        error: msg,
      }));
      throw err;
    }
  }, []);

  const extractSpecific = useCallback(async (filename: string) => {
    setError(null);
    setUpdater((prev) => ({
      ...prev,
      status: `解压中: ${filename}`,
      error: '',
    }));
    try {
      await invoke('updater:extract-specific', { filename });
      setUpdater((prev) => ({
        ...prev,
        status: `解压完成: ${filename}`,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setUpdater((prev) => ({
        ...prev,
        status: `解压失败: ${msg}`,
        error: msg,
      }));
      throw err;
    }
  }, []);

  const listDownloadedFiles = useCallback(async () => {
    try {
      return await invoke('updater:list-downloaded-files');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return [];
    }
  }, []);

  const refreshProgress = useCallback(async () => {
    try {
      const progress = await invoke('updater:get-progress');
      setUpdater(progress);
    } catch (err) {
      // 静默失败，更新器可能在空闲状态
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setUpdater((prev) => ({ ...prev, error: '' }));
  }, []);

  // 轮询下载进度
  useEffect(() => {
    if (!updater.isDownloading) return;
    const interval = setInterval(refreshProgress, 500);
    return () => clearInterval(interval);
  }, [updater.isDownloading, refreshProgress]);

  // 挂载时恢复进度状态（解决切换 Tab 后状态丢失）
  useEffect(() => {
    refreshProgress();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setProxy = useCallback(async (proxy: string) => {
    await invoke('updater:set-proxy', { proxy });
  }, []);

  const setBackend = useCallback(async (backend: string) => {
    const state = await invoke('updater:set-backend', { backend });
    setUpdater(state);
  }, []);

  return {
    updater,
    error,
    checkLatest,
    checkCoreExists,
    getLocalVersion,
    downloadAndExtract,
    extractSpecific,
    listDownloadedFiles,
    refreshProgress,
    setProxy,
    setBackend,
    clearError,
  };
}
