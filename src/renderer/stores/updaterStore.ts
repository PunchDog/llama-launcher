// =============================================================================
// updaterStore — llama.cpp core 版本检查与下载
//   进度由主进程 updater:progress 推送（bridge 唯一订阅点）；
//   这里只保留动作与「检查最新版本」的一次性结果。
// =============================================================================

import { create } from 'zustand';
import type { UpdaterState } from '@/shared/types';
import { invoke } from '@/renderer/hooks/api';
import { showToast } from './uiStore';

export interface LatestRelease {
  tag: string;
  releaseTag: string;
  size: number;
}

interface UpdaterStore {
  updater: UpdaterState;
  error: string | null;
  /** bridge 推送入口 */
  applyState: (state: UpdaterState) => void;
  checkLatest: () => Promise<LatestRelease | null>;
  checkCoreExists: () => Promise<boolean>;
  getLocalVersion: () => Promise<string>;
  downloadAndExtract: () => Promise<void>;
  extractSpecific: (filename: string) => Promise<void>;
  listDownloadedFiles: () => Promise<string[]>;
  refresh: () => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;
  setBackend: (backend: string) => Promise<void>;
  clearError: () => void;
}

const IDLE_STATE: UpdaterState = {
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

let localVersion: Promise<string> | null = null;

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  updater: IDLE_STATE,
  error: null,

  applyState: (state) => set({ updater: state }),

  checkLatest: async () => {
    set({ error: null });
    try {
      const result = await invoke('updater:check-latest');
      set({
        updater: {
          ...get().updater,
          latestTag: result.tag,
          latestReleaseTag: result.releaseTag,
          downloadSize: result.size,
          status:
            result.releaseTag && result.releaseTag !== result.tag
              ? `最新版本: ${result.releaseTag} (nightly ${result.tag})`
              : `最新版本: ${result.tag}`,
        },
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, updater: { ...get().updater, status: `检查失败: ${msg}`, error: msg } });
      return null;
    }
  },

  checkCoreExists: async () => {
    try {
      return await invoke('updater:check-core-exists');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return false;
    }
  },

  getLocalVersion: () => {
    // 本地 core 版本在一次会话内不变：缓存住，免得 StrictMode 双跑向主进程重复请求
    //（该通道每次调用都会往日志里写一行「本地版本:」）
    localVersion ??= invoke('updater:get-local-version').catch((err: unknown) => {
      localVersion = null; // 失败不缓存，允许下次重试
      set({ error: err instanceof Error ? err.message : String(err) });
      return '';
    });
    return localVersion;
  },

  downloadAndExtract: async () => {
    set({ error: null, updater: { ...get().updater, isDownloading: true, status: '下载中...', progress: 0, error: '' } });
    try {
      await invoke('updater:download-and-extract');
      set({ updater: { ...get().updater, isDownloading: false, status: '下载完成', progress: 100 } });
      showToast('success', 'Core 下载并解压完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, updater: { ...get().updater, isDownloading: false, status: `下载失败: ${msg}`, error: msg } });
      showToast('error', `Core 下载失败：${msg}`);
      throw err;
    }
  },

  extractSpecific: async (filename) => {
    set({ error: null, updater: { ...get().updater, status: `解压中: ${filename}`, error: '' } });
    try {
      await invoke('updater:extract-specific', { filename });
      set({ updater: { ...get().updater, status: `解压完成: ${filename}` } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, updater: { ...get().updater, status: `解压失败: ${msg}`, error: msg } });
      throw err;
    }
  },

  listDownloadedFiles: async () => {
    try {
      return await invoke('updater:list-downloaded-files');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return [];
    }
  },

  refresh: async () => {
    try {
      set({ updater: await invoke('updater:get-progress') });
    } catch {
      // 更新器空闲时主进程可能还没初始化，静默
    }
  },

  setProxy: async (proxy) => {
    await invoke('updater:set-proxy', { proxy });
  },

  setBackend: async (backend) => {
    set({ updater: await invoke('updater:set-backend', { backend }) });
  },

  clearError: () => set({ error: null, updater: { ...get().updater, error: '' } }),
}));
