// =============================================================================
// downloaderStore — ModelScope 模型下载
//   下载进度来自主进程 model:progress 推送；
//   文件列表按 modelId 缓存（同一模型多次浏览不重复请求，也不会串台），
//   勾选状态同样按 modelId 存，切换模型时不会把上一个模型的勾选带过去。
// =============================================================================

import { create } from 'zustand';
import type { ModelDownloadState, ModelFile, ModelInfo, ModelScopeEnvState } from '@/shared/types';
import { invoke } from '@/renderer/hooks/api';
import { showToast } from './uiStore';

interface DownloadRequest {
  modelId: string;
  localDir: string;
  files?: string[];
  mode: 'http' | 'cli';
}

interface DownloaderStore {
  state: ModelDownloadState;
  env: ModelScopeEnvState | null;
  models: ModelInfo[];
  error: string | null;
  searching: boolean;
  /** modelId → 文件清单 */
  filesByModel: Record<string, ModelFile[]>;
  /** modelId → 勾选的文件路径 */
  selectedByModel: Record<string, string[]>;
  /** 当前展开文件列表的模型 */
  browsed: string;
  /** 下载目标模型（界面上可直接编辑的输入框）；state.modelId 是主进程正在下的模型 */
  target: string;
  setTarget: (id: string) => void;
  checkEnv: () => Promise<void>;
  installModelscope: () => Promise<void>;
  searchModels: (keyword: string) => Promise<void>;
  listFiles: (modelId: string) => Promise<void>;
  toggleFile: (path: string, on: boolean) => void;
  clearSelection: () => void;
  download: (req: DownloadRequest) => Promise<void>;
  cancel: () => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;
  applyState: (state: ModelDownloadState) => void;
  refresh: () => Promise<void>;
  clearError: () => void;
}

const IDLE_STATE: ModelDownloadState = {
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
  downloadSpeed: 0,
  httpFailed: false,
  files: [],
  selectedFiles: [],
};

export const useDownloaderStore = create<DownloaderStore>((set, get) => ({
  state: IDLE_STATE,
  env: null,
  models: [],
  error: null,
  searching: false,
  filesByModel: {},
  selectedByModel: {},
  browsed: '',
  target: '',

  setTarget: (target) => set({ target }),

  applyState: (state) => set({ state }),

  checkEnv: async () => {
    try {
      set({ env: await invoke('model:check-env') });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  installModelscope: async () => {
    set({ error: null });
    try {
      await invoke('model:install-modelscope');
      await get().checkEnv();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      showToast('error', `安装 modelscope 失败：${msg}`);
    }
  },

  searchModels: async (keyword) => {
    set({ error: null, searching: true });
    try {
      set({ models: await invoke('model:search-models', { keyword }) });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), models: [] });
    } finally {
      set({ searching: false });
    }
  },

  listFiles: async (modelId) => {
    set({ error: null, browsed: modelId });
    if (get().filesByModel[modelId]) return;
    try {
      const files = await invoke('model:list-files', { modelId });
      set({
        filesByModel: { ...get().filesByModel, [modelId]: files },
        selectedByModel: { ...get().selectedByModel, [modelId]: [] },
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  toggleFile: (path, on) => {
    const modelId = get().target;
    const cur = get().selectedByModel[modelId] ?? [];
    const next = on ? (cur.includes(path) ? cur : [...cur, path]) : cur.filter((p) => p !== path);
    set({ selectedByModel: { ...get().selectedByModel, [modelId]: next } });
  },

  clearSelection: () => {
    const modelId = get().target;
    set({ selectedByModel: { ...get().selectedByModel, [modelId]: [] } });
  },

  download: async (req) => {
    set({ error: null });
    set({
      state: {
        ...get().state,
        isDownloading: true,
        mode: req.mode,
        modelId: req.modelId,
        localDir: req.localDir,
        status: req.mode === 'cli' ? 'Python 工具下载中...' : 'HTTPS 下载中...',
        progress: 0,
        error: '',
        httpFailed: false,
      },
    });
    try {
      await invoke('model:download', req);
      showToast('success', '模型下载完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      showToast('error', `模型下载失败：${msg}`);
    } finally {
      // 主进程已把终态推进推送里，这里再补一次拉取，避免推送正好落在请求边界外
      await get().refresh();
      if (get().state.isDownloading) set({ state: { ...get().state, isDownloading: false } });
    }
  },

  cancel: async () => {
    try {
      await invoke('model:cancel');
      await get().refresh();
      set({ state: { ...get().state, isDownloading: false } });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setProxy: async (proxy) => {
    await invoke('model:set-proxy', { proxy });
  },

  refresh: async () => {
    try {
      set({ state: await invoke('model:get-progress') });
    } catch {
      // 下载器空闲时可能尚未初始化，静默
    }
  },

  clearError: () => {
    set({ error: null, state: { ...get().state, error: '' } });
  },
}));
